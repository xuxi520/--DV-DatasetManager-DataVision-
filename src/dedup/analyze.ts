/**
 * 去重核心算法（双端统一）
 *
 * 借鉴 fastdup / ImageAtlas 思路：
 *  1. 多哈希（MD5 精确 + pHash/dHash/aHash 感知）描述每张图
 *  2. LSH 分桶（把 64bit 哈希切成若干 band）快速找到候选相似对，避免 O(N^2)
 *  3. 并查集（Union-Find）把候选对连通成「重复组」
 *  4. 三种强度：strict(精确) / standard(近似) / loose(模糊)
 *  5. train/val/test 不交叉去重：按拆分独立成组
 *  6. 脏数据同步过滤：与任何图都极不相似的离群图 -> 异常/卡通/无关；
 *     解码失败/纯色/尺寸无效的 -> 无效图
 *  7. 增量去重：复用已有哈希索引，仅计算新增文件，并能与已有索引比对
 */
import type { ImageFile } from '../types'
import type {
  DedupOptions,
  DedupResult,
  DuplicateGroup,
  DirtyImage,
  DirtyKind,
  HashIndex,
  HashIndexEntry,
  SplitKey,
  LeakagePair,
  FileHash,
} from './types'
import { STRENGTH_PRESETS } from './strength'
import { detectSplitAndCategory } from './splitDetect'
import { computeHashesForFiles } from './hashEngine'
import { getFileBytes, getFileBytesBatch } from './fileOps'

interface HashRecord {
  id: string
  path: string
  split: SplitKey
  category: string
  md5: string
  phash: string
  dhash: string
  ahash: string
  isCurrent: boolean
  failed?: boolean
  file?: ImageFile
}

function hamming(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let d = 0
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++
  if (a.length !== b.length) d += Math.abs(a.length - b.length)
  return d
}

/** 把 64bit 哈希切成 band，用于 LSH 分桶 */
function bandKeys(hash: string, bandSize = 4): string[] {
  const keys: string[] = []
  for (let i = 0; i < hash.length; i += bandSize) {
    keys.push(hash.substring(i, i + bandSize))
  }
  return keys
}

/** 纯色/空白图判定（aHash 全 0 或全 1） */
function isBlank(ahash: string): boolean {
  if (!ahash) return false
  return ahash.split('').every((c) => c === '1') || ahash.split('').every((c) => c === '0')
}

class UnionFind {
  parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]
      x = this.parent[x]
    }
    return x
  }
  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[rb] = ra
  }
}

export interface RunDedupHooks {
  onHashProgress?: (processed: number, total: number, cacheHits: number) => void
  onStatus?: (status: string) => void
  shouldCancel?: () => boolean
  /** 增量模式：已有哈希索引（path -> 条目），用于复用与新文件比对 */
  baseIndex?: HashIndex
}

/**
 * 执行去重分析
 * @returns 分析结果 + 本次（含复用）哈希索引，供增量模式导出
 */
export async function runDedup(
  files: ImageFile[],
  options: DedupOptions,
  hooks: RunDedupHooks = {}
): Promise<{ result: DedupResult; index: HashIndex }> {
  const preset = STRENGTH_PRESETS[options.strength]
  const failed: string[] = []
  const records: HashRecord[] = []

  // 索引（增量复用）：从 baseIndex 起步
  const index: HashIndex = options.incremental && hooks.baseIndex
    ? { ...hooks.baseIndex }
    : {}

  const idToFile = new Map<string, ImageFile>()
  for (const f of files) idToFile.set(f.id, f)

  // 权威 split 来源：优先用逻辑数据集提供的 splitOf，回退到路径推断
  const splitOfFile = (file: ImageFile): SplitKey =>
    options.splitOf ? options.splitOf(file) : detectSplitAndCategory(file.path).split

  // 1) 准备记录：可复用的直接取索引，否则加入待计算队列
  hooks.onStatus?.('正在准备文件清单...')
  const toCompute: Array<{
    id: string
    path: string
    file: ImageFile
    split: SplitKey
    category: string
  }> = []

  for (const file of files) {
    const meta = detectSplitAndCategory(file.path)
    const split = splitOfFile(file)
    const cached = options.incremental ? index[file.path] : undefined
    if (cached && cached.size === file.size) {
      // 复用缓存哈希
      records.push({
        id: file.id,
        path: file.path,
        split,
        category: meta.category,
        md5: cached.md5,
        phash: cached.phash,
        dhash: cached.dhash,
        ahash: cached.ahash,
        isCurrent: true,
        file,
      })
      file.hash = cached.md5
      file.phash = cached.phash
      file.dhash = cached.dhash
      file.ahash = cached.ahash
    } else {
      toCompute.push({ id: file.id, path: file.path, file, split, category: meta.category })
    }
  }

  // 2) 计算待算文件的哈希（环境分发读取）
  if (toCompute.length > 0) {
    hooks.onStatus?.(`正在计算哈希 (${toCompute.length} 张)...`)
    const jobMap = new Map(toCompute.map((t) => [t.id, t]))
    await computeHashesForFiles(
      toCompute.map((t) => ({
        id: t.id,
        path: t.path,
        size: t.file.size,
        getBytes: () => getFileBytes(t.file),
      })),
      (id, h: FileHash | null) => {
        const t = jobMap.get(id)!
        if (!h) {
          failed.push(t.path)
          records.push({
            id: t.id,
            path: t.path,
            split: t.split,
            category: t.category,
            md5: '',
            phash: '',
            dhash: '',
            ahash: '',
            isCurrent: true,
            failed: true,
            file: t.file,
          })
          return
        }
        records.push({
          id: t.id,
          path: t.path,
          split: t.split,
          category: t.category,
          md5: h.md5,
          phash: h.phash,
          dhash: h.dhash,
          ahash: h.ahash,
          isCurrent: true,
          file: t.file,
        })
        t.file.hash = h.md5
        t.file.phash = h.phash
        t.file.dhash = h.dhash
        t.file.ahash = h.ahash
        index[t.path] = {
          path: t.path,
          size: t.file.size,
          md5: h.md5,
          phash: h.phash,
          dhash: h.dhash,
          ahash: h.ahash,
        } as HashIndexEntry
      },
      (p, t, c) => hooks.onHashProgress?.(p, t, c),
      hooks.shouldCancel,
      async (jobs) => getFileBytesBatch(jobs.map((j) => jobMap.get(j.id)!.file)),
    )
  }

  // 3) 增量：把 baseIndex 中「当前未加载」的条目也并入比较池
  if (options.incremental && hooks.baseIndex) {
    const currentPaths = new Set(files.map((f) => f.path))
    for (const [p, e] of Object.entries(hooks.baseIndex)) {
      if (!currentPaths.has(p)) {
        const meta = detectSplitAndCategory(p)
        records.push({
          id: 'base:' + p,
          path: p,
          split: meta.split,
          category: meta.category,
          md5: e.md5,
          phash: e.phash,
          dhash: e.dhash,
          ahash: e.ahash,
          isCurrent: false,
        })
      }
    }
  }

  // 4) 按 scope（是否拆分独立）分组并查找重复
  hooks.onStatus?.('正在比对相似度...')
  const scopes: string[] = options.separateSplits
    ? Array.from(new Set(records.map((r) => r.split)))
    : ['__all__']

  const groups: DuplicateGroup[] = []
  const minDist = new Map<number, number>() // record index -> 与最近邻的最小 phash 距离
  let groupId = 0

  for (const scope of scopes) {
    const idxs = records
      .map((r, i) => ({ r, i }))
      .filter((x) => (scope === '__all__' ? true : x.r.split === scope))
      .map((x) => x.i)

    if (idxs.length < 2) continue

    // LSH 分桶找候选对（pHash 与 dHash 各做一次）
    const bandMap = new Map<string, number[]>()
    const pushBand = (key: string, i: number) => {
      let arr = bandMap.get(key)
      if (!arr) {
        arr = []
        bandMap.set(key, arr)
      }
      arr.push(i)
    }
    for (const i of idxs) {
      for (const k of bandKeys(records[i].phash)) pushBand('p:' + k, i)
      for (const k of bandKeys(records[i].dhash)) pushBand('d:' + k, i)
    }

    // 桶大小在 [2, CAP] 才比较，超大桶（全黑/全白等）跳过以免爆炸
    const CAP = 400
    const pairSet = new Set<string>()
    for (const bucket of bandMap.values()) {
      if (bucket.length < 2 || bucket.length > CAP) continue
      for (let a = 0; a < bucket.length; a++) {
        for (let b = a + 1; b < bucket.length; b++) {
          const i = bucket[a]
          const j = bucket[b]
          const key = i < j ? `${i}-${j}` : `${j}-${i}`
          pairSet.add(key)
        }
      }
    }

    // 计算实际汉明距离，建图 + 记录最近邻
    const uf = new UnionFind(records.length)
    for (const key of pairSet) {
      const [i, j] = key.split('-').map(Number)
      const pd = hamming(records[i].phash, records[j].phash)
      const dd = hamming(records[i].dhash, records[j].dhash)
      minDist.set(i, Math.min(minDist.get(i) ?? 64, pd))
      minDist.set(j, Math.min(minDist.get(j) ?? 64, pd))

      const similar = preset.useExact
        ? pd === 0 && records[i].md5 !== '' && records[i].md5 === records[j].md5
        : pd <= preset.phashThreshold || dd <= preset.dhashThreshold
      if (similar) uf.union(i, j)
    }

    // 连通分量 -> 重复组
    const compMap = new Map<number, number[]>()
    for (const i of idxs) {
      const root = uf.find(i)
      let arr = compMap.get(root)
      if (!arr) {
        arr = []
        compMap.set(root, arr)
      }
      arr.push(i)
    }

    for (const members of compMap.values()) {
      if (members.length < 2) continue
      const currentMembers = members.filter((i) => records[i].isCurrent && records[i].file)
      if (currentMembers.length === 0) continue // 均为已有索引项，跳过 UI

      // 选定保留（体积最大者）；若仅 1 个当前成员但组分含 base -> 与已有重复
      let keepIdx = currentMembers[0]
      for (const i of currentMembers) {
        if ((records[i].file!.size) > (records[keepIdx].file!.size)) keepIdx = i
      }

      let md = 64
      for (let a = 0; a < currentMembers.length; a++) {
        for (let b = a + 1; b < currentMembers.length; b++) {
          md = Math.min(md, hamming(records[currentMembers[a]].phash, records[currentMembers[b]].phash))
        }
      }

      const allMd5 = new Set(currentMembers.map((i) => records[i].md5))
      const exact = allMd5.size === 1 && records[keepIdx].md5 !== ''

      const currentFiles = currentMembers.map((i) => records[i].file!)
      const duplicateOfExternal = currentMembers.length === 1 && members.length > 1

      groups.push({
        id: 'g' + groupId++,
        split: scope === '__all__' ? 'unknown' : (scope as SplitKey),
        category: records[keepIdx].category,
        files: currentFiles,
        keepId: duplicateOfExternal ? '' : records[keepIdx].id,
        removeIds: duplicateOfExternal
          ? [records[keepIdx].id]
          : currentMembers.filter((i) => i !== keepIdx).map((i) => records[i].id),
        minDistance: md,
        exact,
        duplicateOfExternal,
      })
    }
  }

  // 4.5) 跨子集泄漏检测：全量比对，找出 split 不同的相似对（数据泄漏）
  const leakage: LeakagePair[] = []
  if (options.detectLeakage) {
    hooks.onStatus?.('正在检测跨子集泄漏...')
    const CAP = 400
    const bandMap2 = new Map<string, number[]>()
    const pushBand2 = (key: string, i: number) => {
      let arr = bandMap2.get(key)
      if (!arr) { arr = []; bandMap2.set(key, arr) }
      arr.push(i)
    }
    for (const i of records.keys()) {
      for (const k of bandKeys(records[i].phash)) pushBand2('p:' + k, i)
      for (const k of bandKeys(records[i].dhash)) pushBand2('d:' + k, i)
    }
    const leakSeen = new Set<string>()
    for (const bucket of bandMap2.values()) {
      if (bucket.length < 2 || bucket.length > CAP) continue
      for (let a = 0; a < bucket.length; a++) {
        for (let b = a + 1; b < bucket.length; b++) {
          const i = bucket[a]
          const j = bucket[b]
          if (records[i].split === records[j].split) continue
          const pd = hamming(records[i].phash, records[j].phash)
          const dd = hamming(records[i].dhash, records[j].dhash)
          const similar = preset.useExact
            ? records[i].md5 !== '' && records[i].md5 === records[j].md5
            : pd <= preset.phashThreshold || dd <= preset.dhashThreshold
          if (!similar) continue
          const key = i < j ? `${i}-${j}` : `${j}-${i}`
          if (leakSeen.has(key)) continue
          leakSeen.add(key)
          const exact = records[i].md5 !== '' && records[i].md5 === records[j].md5
          leakage.push({
            aId: records[i].id,
            bId: records[j].id,
            fileA: records[i].file,
            fileB: records[j].file,
            splitA: records[i].split,
            splitB: records[j].split,
            md5: exact ? records[i].md5 : undefined,
            distance: pd,
            exact,
          })
        }
      }
    }
  }

  // 4.6) 子集比较模式：mixed 下只保留含子集成员的组，并优先保留非子集侧
  let effectiveGroups = groups
  if (options.compareMode === 'mixed' && options.subsetPaths && options.subsetPaths.size > 0) {
    const subset = options.subsetPaths
    const filtered: DuplicateGroup[] = []
    for (const g of groups) {
      if (!g.files.some((f) => subset.has(f.path))) continue
      const nonSubset = g.files.filter((f) => !subset.has(f.path))
      let keep = nonSubset[0] ?? g.files[0]
      for (const f of g.files) {
        if (f.size > keep.size) keep = f
      }
      filtered.push({
        ...g,
        keepId: keep.id,
        removeIds: g.files.filter((f) => f.id !== keep.id).map((f) => f.id),
      })
    }
    effectiveGroups = filtered
  }

  // 5) 脏数据同步过滤（离群/无效）
  const dirty: DirtyImage[] = []
  if (options.detectDirty) {
    hooks.onStatus?.('正在检测脏数据 / 离群图...')
    for (const i of records.keys()) {
      const r = records[i]
      if (!r.isCurrent || r.failed) continue
      const md2 = minDist.get(i)
      const isolated = md2 === undefined
      const minD = isolated ? 64 : md2

      if (isolated || minD > options.outlierThreshold) {
        let kind: DirtyKind = 'outlier'
        let reason = ''
        if (r.failed) {
          kind = 'invalid'
          reason = '解码失败 / 文件损坏'
        } else if (r.file && (r.file.width === 0 || r.file.height === 0)) {
          kind = 'invalid'
          reason = '图片尺寸无效'
        } else if (isBlank(r.ahash)) {
          kind = 'invalid'
          reason = '近似空白 / 纯色图'
        } else {
          kind = 'outlier'
          reason = isolated
            ? `与数据集中任何图都无相似（孤立样本）`
            : `与最近邻差异极大（最小汉明距离 ${minD}）`
        }
        dirty.push({
          file: r.file!,
          kind,
          reason,
          minDistance: isolated ? undefined : minD,
        })
      }
    }
  }

  // 6) 汇总
  const currentPaths = files.map((f) => f.path)
  const removablePathSet = new Set<string>()
  for (const g of effectiveGroups) {
    for (const id of g.removeIds) {
      const f = idToFile.get(id)
      if (f) removablePathSet.add(f.path)
    }
  }
  const removablePaths = Array.from(removablePathSet)
  const keepPaths = currentPaths.filter((p) => !removablePathSet.has(p))

  const exactDuplicates = effectiveGroups.filter((g) => g.exact).length
  const nearDuplicates = effectiveGroups.length - exactDuplicates
  const dirtyInvalid = dirty.filter((d) => d.kind === 'invalid').length
  const dirtyOutlier = dirty.filter((d) => d.kind === 'outlier').length
  const removable = removablePaths.length
  const total = files.length
  const hashed = records.filter((r) => r.isCurrent && !r.failed).length

  const splitDistribution: Record<SplitKey, number> = {
    train: 0,
    val: 0,
    test: 0,
    unknown: 0,
    none: 0,
  }
  for (const r of records) {
    if (r.isCurrent) splitDistribution[r.split]++
  }

  // 各 split 下计划移除的文件数（精确回答"删的是哪个子集"）
  const idToSplit = new Map(records.map((r) => [r.id, r.split]))
  const removedBySplit: Record<SplitKey, number> = {
    train: 0,
    val: 0,
    test: 0,
    unknown: 0,
    none: 0,
  }
  for (const g of effectiveGroups) {
    for (const id of g.removeIds) {
      const s = idToSplit.get(id)
      if (s) removedBySplit[s]++
    }
  }

  const result: DedupResult = {
    total,
    hashed,
    failed,
    groups: effectiveGroups,
    dirty,
    removablePaths,
    keepPaths,
    stats: {
      exactDuplicates,
      nearDuplicates,
      dirtyInvalid,
      dirtyOutlier,
      removable,
      reducedRatio: total ? removable / total : 0,
    },
    splitDistribution,
    removedBySplit,
    leakage,
  }

  hooks.onStatus?.('分析完成')
  return { result, index }
}
