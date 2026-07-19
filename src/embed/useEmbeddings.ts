/**
 * useEmbeddings —— 特征嵌入与相似检索单例（模块级单例，参考 useQuality）
 * 收敛 P2 相似检索的响应式状态与动作，供 SimilarityView 使用。
 *
 * 内容寻址：特征以 md5 为键存 IndexedDB（跨路径同图复用）。
 * 会话内额外维护 md5<->fileId 双向映射，使检索结果能解析回当前数据集的 ImageFile。
 * （跨会话持久化检索为 P2-2 增强，本期需先「计算特征」即可在本会话内检索。）
 */
import { ref, computed } from 'vue'
import type { ImageFile } from '../types'
import { runEmbedding, destroyEmbedWorker } from './embedEngine'
import type { EmbedBackend } from './embedTypes'
import { getAllEmbeddings } from '../cache/idbCache'
import type { AnnEntry } from './annIndex'
import {
  buildAnnIndex as buildAnnInWorker,
  searchAnn,
  resetAnnIndex,
  destroyAnnWorker,
} from './annClient'

function createEmbedState() {
  /** 当前会话内已加载的 md5 -> 特征（内存，便于快速检索；权威副本在 IndexedDB） */
  const embeddings = ref<Map<string, Float32Array>>(new Map())
  const md5ToFileId = new Map<string, string>()
  const fileIdToMd5 = new Map<string, string>()
  /** version 自增触发依赖它的计算属性刷新（Map 就地变更不具响应性） */
  const version = ref(0)

  const running = ref(false)
  const progress = ref({ processed: 0, total: 0 })
  const cacheHits = ref(0)
  const status = ref('')
  /** 实际推理后端（webgpu/wasm + 线程数），计算结束后保留展示 */
  const backend = ref<EmbedBackend | null>(null)
  let cancelFlag = false

  /** ANN（HNSW）索引：构建/检索委托给 Worker（ann.worker.ts），主线程仅协调；按 version 失效重建 */
  const ANN_THRESHOLD = 5000
  let annBuiltVersion = -1
  let annBuiltDim = 0
  let annBuildPromise: Promise<void> | null = null
  let annBroken = false
  const searchMode = ref<'brute' | 'ann' | null>(null)



  /**
   * 全量特征的内存级 memo：避免 findSimilar / analysisPoints 每次都全量游标扫 IndexedDB
   * （同一会话内多次「查找相似」或切换重算时不再重复读盘）。随 version 自增失效重载。
   */
  let memoAll: Map<string, Float32Array> | null = null
  let memoVer = -1
  async function allEmbeddings(): Promise<Map<string, Float32Array>> {
    if (memoAll && memoVer === version.value) return memoAll
    const all = await getAllEmbeddings()
    for (const [m, v] of embeddings.value) all.set(m, v)
    memoAll = all
    memoVer = version.value
    return all
  }

  async function compute(files: ImageFile[]): Promise<void> {
    if (files.length === 0) return
    cancelFlag = false
    running.value = true
    progress.value = { processed: 0, total: files.length }
    cacheHits.value = 0
    backend.value = null
    status.value = '加载模型并抽取特征…'
    try {
      await runEmbedding(files, {
        onResult: (r) => {
          md5ToFileId.set(r.md5, r.id)
          fileIdToMd5.set(r.id, r.md5)
          embeddings.value.set(r.md5, r.vec)
        },
        onProgress: (p, t, c) => {
          progress.value = { processed: p, total: t }
          cacheHits.value = c
          // 实时展示命中缓存比例（与 MD5/质量同款反馈）
          status.value = `已抽取 ${embeddings.value.size} 张特征（命中缓存 ${c}）`
        },
        onBackend: (b) => {
          backend.value = b
        },
        shouldCancel: () => cancelFlag,
      })
    } finally {
      running.value = false
      version.value++
      // 终态文案：体现「免计算」命中数（与质量/哈希对称）
      status.value =
        cacheHits.value > 0
          ? `完成：${embeddings.value.size} 张特征（命中缓存 ${cacheHits.value} 张，已跳过计算）`
          : `完成：${embeddings.value.size} 张特征`
    }
  }

  /** 余弦相似度（向量已 L2 归一化，等于点积，范围 [0,1]） */
  function cosine(a: Float32Array, b: Float32Array): number {
    let s = 0
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) s += a[i] * b[i]
    return s
  }

  /**
   * 检索与指定图片最相似的 topK 张。
   * - 小数据集（<= ANN_THRESHOLD）：暴力余弦（精确、零 wasm 开销，覆盖万级）。
   * - 大数据集：HNSW ANN 索引（查询 O(log N)，支撑百万级，P2-2）。
   *   索引按 embed.version 缓存；加载/建索引失败时回退暴力，保证功能不阻塞。
   * 返回命中列表（fileId + md5 + 相似度），未计算特征或找不到则返回空。
   */
  async function findSimilar(
    fileId: string,
    topK = 12,
  ): Promise<{ fileId: string; md5: string; score: number }[]> {
    const qMd5 = fileIdToMd5.get(fileId)
    if (!qMd5) return []
    // 全量特征权威来源：内存 memo（首次/失效时再读 IndexedDB，避免每次检索都扫盘）
    const all = await allEmbeddings()
    const q = all.get(qMd5)
    if (!q) return []

    if (all.size <= ANN_THRESHOLD || annBroken) {
      searchMode.value = 'brute'
      return bruteSimilar(qMd5, q, all, topK)
    }

    try {
      if (annBuiltVersion !== version.value || annBuiltDim !== q.length) {
        // 惰性构建：交给 ANN Worker（主线程零阻塞）。同一版本构建在途则复用 Promise。
        if (!annBuildPromise) {
          annBuildPromise = (async () => {
            const entries: AnnEntry[] = []
            for (const [m, v] of all) {
              const fid = md5ToFileId.get(m)
              if (fid) entries.push({ md5: m, fileId: fid, vec: v })
            }
            await buildAnnInWorker(entries, q.length, version.value)
            annBuiltVersion = version.value
            annBuiltDim = q.length
            annBroken = false
          })().finally(() => {
            annBuildPromise = null
          })
        }
        await annBuildPromise
      }
      const hits = await searchAnn(q, topK, qMd5)
      searchMode.value = 'ann'
      const out: { fileId: string; md5: string; score: number }[] = []
      for (const h of hits) {
        if (h.md5 === qMd5) continue
        out.push({ fileId: h.fileId, md5: h.md5, score: h.score })
        if (out.length >= topK) break
      }
      return out
    } catch {
      // ANN 不可用（wasm 加载/建索引失败）：回退暴力，保证功能不阻塞
      annBroken = true
      searchMode.value = 'brute'
      return bruteSimilar(qMd5, q, all, topK)
    }
  }

  /** 暴力余弦相似检索（精确，ANN 不可用时回退） */
  function bruteSimilar(
    qMd5: string,
    q: Float32Array,
    all: Map<string, Float32Array>,
    topK: number,
  ): { fileId: string; md5: string; score: number }[] {
    const hits: { fileId: string; md5: string; score: number }[] = []
    for (const [m, v] of all) {
      if (m === qMd5) continue
      const fid = md5ToFileId.get(m)
      if (!fid) continue
      hits.push({ fileId: fid, md5: m, score: cosine(q, v) })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, topK)
  }

  function fileIdOfMd5(md5: string): string | undefined {
    return md5ToFileId.get(md5)
  }

  /**
   * 聚合全量特征点（供 P2-3 降维 / P2-4 离群分析）。
   * 权威副本来自 IndexedDB，并合并本会话内存增量；仅保留可解析回数据集文件的点。
   */
  async function analysisPoints(): Promise<
    { md5: string; fileId: string; vec: Float32Array }[]
  > {
    const all = await allEmbeddings()
    const pts: { md5: string; fileId: string; vec: Float32Array }[] = []
    for (const [m, v] of all) {
      const fid = md5ToFileId.get(m)
      if (fid) pts.push({ md5: m, fileId: fid, vec: v })
    }
    return pts
  }

  function hasEmbedding(fileId: string): boolean {
    return fileIdToMd5.has(fileId)
  }

  function cancel(): void {
    cancelFlag = true
  }

  function reset(): void {
    embeddings.value = new Map()
    md5ToFileId.clear()
    fileIdToMd5.clear()
    annBuiltVersion = -1
    annBuiltDim = 0
    annBroken = false
    resetAnnIndex()
    version.value++
  }

  /** 当前会话已计算特征的文件数（响应式） */
  const count = computed(() => embeddings.value.size)

  return {
    embeddings,
    version,
    count,
    running,
    progress,
    cacheHits,
    status,
    backend,
    compute,
    findSimilar,
    searchMode,
    fileIdOfMd5,
    hasEmbedding,
    analysisPoints,
    cancel,
    reset,
  }
}

let _state: ReturnType<typeof createEmbedState> | null = null

export function useEmbeddings() {
  if (!_state) _state = createEmbedState()
  return _state
}

export { destroyEmbedWorker, destroyAnnWorker }
