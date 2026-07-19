/**
 * 数据集版本 / 迭代间 diff（规范中间模型层）
 *
 * 设计：每个「版本」是一份轻量、可 diff 的清单（DatasetVersionManifest），
 * 不内嵌全量标注，只保存：类表 / split 计数 / 每类标注数 / 每样本
 * {id, sourcePath, split, imageSize, annCount, annHash}。
 *
 * - annHash：由「归一化标注内容 + 类名 + split + 路径」算出的确定性廉价摘要
 *   （FNV-1a 32-bit，不读图字节），用于判断「该图标注是否被改过」。
 * - diff 由两份 manifest 直接比对得出（新增 / 删除 / 修改 / 类变化 / split 变化 / 统计增减），
 *   无需回读图片，纯内存计算。
 *
 * 存储后端（versionStore.ts）负责把 manifest 落地：Tauri 端写 `dataset.dv.json`
 * 到数据集根（自标识文件），全量历史存 IDB；浏览器端存 IDB + 支持下载该文件做便携标识。
 */

import type {
  CanonicalDataset,
  CanonicalSample,
  SplitKey,
} from './types'

export const MANIFEST_SCHEMA = 1
export const MANIFEST_FILENAME = 'dataset.dv.json'

/** 类表快照（轻量，去掉 authoritative source） */
export interface VersionClass {
  id: number
  name: string
  aliases: string[]
}

/** 单样本快照：足以定位「增删改」与按类/按 split 统计 */
export interface VersionSample {
  id: string
  sourcePath: string
  split: SplitKey
  /** 图片字节数；未知为 0 */
  imageSize: number
  annCount: number
  /** 标注内容确定性摘要（FNV-1a） */
  annHash: string
}

export interface VersionStats {
  totalSamples: number
  totalAnnotations: number
  perSplit: Record<string, number>
  /** className -> 标注数 */
  perClass: Record<string, number>
}

/** 数据集版本清单（自标识文件 dataset.dv.json 的内容） */
export interface DatasetVersionManifest {
  schema: number
  /** 版本唯一 id */
  id: string
  /** 用户可读标签，如 "v1-初版" */
  label: string
  /** 创建时间 ISO */
  createdAt: string
  datasetName: string
  sourceFormat: string
  classes: VersionClass[]
  stats: VersionStats
  samples: VersionSample[]
}

/* ============================ 确定性摘要 ============================ */

/** FNV-1a 32-bit，返回 8 位十六进制串（用于 annHash / 调试） */
export function hashString(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // 转无符号 8 位十六进制
  return (h >>> 0).toString(16).padStart(8, '0')
}

const R = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * 单样本标注内容确定性摘要。
 * 仅用标注的「类型 / 类 / 归一化坐标 / 旋转 / iscrowd / RLE」构造稳定串，
 * 坐标做定点舍入避免浮点噪声导致误判为「已修改」。
 */
export function annHashOf(
  sample: CanonicalSample,
  dataset: CanonicalDataset,
): string {
  const clsName = (cid: number) =>
    dataset.classes[cid]?.name ?? `class_${cid}`
  const parts = sample.annotations
    .map((a) => {
      const coords = a.coords.map(R).join(',')
      const rle = a.rle
        ? JSON.stringify([a.rle.size, a.rle.counts])
        : ''
      return [
        a.type,
        clsName(a.classId),
        coords,
        a.rotation != null ? R(a.rotation) : '',
        a.iscrowd ? 1 : 0,
        rle,
      ].join('|')
    })
    .join(';')
  return hashString(`${sample.sourcePath}#${sample.split}#${parts}`)
}

/* ============================ 构建清单 ============================ */

function normSlash(p: string): string {
  return p.replace(/\\/g, '/')
}

export interface BuildManifestOptions {
  label: string
  datasetName: string
  id?: string
}

/** 由规范中间模型构建一份版本清单（当前工作区快照） */
export function buildManifest(
  canonical: CanonicalDataset,
  opts: BuildManifestOptions,
): DatasetVersionManifest {
  const perSplit: Record<string, number> = {}
  const perClass: Record<string, number> = {}
  let totalAnnotations = 0

  const samples: VersionSample[] = canonical.samples.map((s) => {
    const annCount = s.annotations.length
    totalAnnotations += annCount
    perSplit[s.split] = (perSplit[s.split] ?? 0) + 1
    for (const a of s.annotations) {
      const name = canonical.classes[a.classId]?.name ?? `class_${a.classId}`
      perClass[name] = (perClass[name] ?? 0) + 1
    }
    return {
      id: s.id,
      sourcePath: normSlash(s.sourcePath),
      split: s.split,
      imageSize: 0, // 规范模型不持有字节数；需要精确大小可后续补 size 字段
      annCount,
      annHash: annHashOf(s, canonical),
    }
  })

  return {
    schema: MANIFEST_SCHEMA,
    id: opts.id ?? 'v_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    label: opts.label,
    createdAt: new Date().toISOString(),
    datasetName: opts.datasetName,
    sourceFormat: canonical.sourceFormat,
    classes: canonical.classes.map((c) => ({
      id: c.id,
      name: c.name,
      aliases: [...c.aliases],
    })),
    stats: {
      totalSamples: samples.length,
      totalAnnotations,
      perSplit,
      perClass,
    },
    samples,
  }
}

/* ============================ 迭代间 diff ============================ */

export type SampleChangeKind = 'added' | 'removed' | 'modified'

export interface SampleChange {
  id: string
  sourcePath: string
  kind: SampleChangeKind
  /** 当前 split（added / modified 时为 after；removed 时为 before） */
  split?: SplitKey
  annCountBefore?: number
  annCountAfter?: number
  /** modified 时：split 是否发生变化 */
  splitChanged?: boolean
}

export interface ClassChange {
  name: string
  kind: 'added' | 'removed' | 'renamed'
  id: number
  /** renamed 时的旧名 */
  fromName?: string
}

export interface SplitChange {
  split: string
  before: number
  after: number
}

export interface VersionDiff {
  summary: {
    added: number
    removed: number
    modified: number
    classesChanged: number
    splitsChanged: number
  }
  samples: SampleChange[]
  classes: ClassChange[]
  splits: SplitChange[]
  stats: { before: VersionStats; after: VersionStats }
  beforeLabel: string
  afterLabel: string
}

/**
 * 比对两份版本清单，得出迭代间差异。
 * after = 较新版本（或当前工作区）；before = 基准版本。
 */
export function diffManifests(
  after: DatasetVersionManifest,
  before: DatasetVersionManifest,
): VersionDiff {
  const beforeById = new Map(before.samples.map((s) => [s.id, s]))
  const samples: SampleChange[] = []

  let added = 0
  let removed = 0
  let modified = 0

  for (const s of after.samples) {
    const b = beforeById.get(s.id)
    if (!b) {
      added++
      samples.push({
        id: s.id,
        sourcePath: s.sourcePath,
        kind: 'added',
        split: s.split,
        annCountAfter: s.annCount,
      })
    } else if (b.annHash !== s.annHash) {
      modified++
      samples.push({
        id: s.id,
        sourcePath: s.sourcePath,
        kind: 'modified',
        split: s.split,
        annCountBefore: b.annCount,
        annCountAfter: s.annCount,
        splitChanged: b.split !== s.split,
      })
    }
  }
  for (const b of before.samples) {
    if (!after.samples.some((s) => s.id === b.id)) {
      removed++
      samples.push({
        id: b.id,
        sourcePath: b.sourcePath,
        kind: 'removed',
        split: b.split,
        annCountBefore: b.annCount,
      })
    }
  }

  // 类变化（按 id 对齐；同名不同 id 视为新增 + 删除）
  const beforeClassById = new Map(before.classes.map((c) => [c.id, c]))
  const afterClassById = new Map(after.classes.map((c) => [c.id, c]))
  const classes: ClassChange[] = []
  for (const c of after.classes) {
    const b = beforeClassById.get(c.id)
    if (!b) classes.push({ name: c.name, kind: 'added', id: c.id })
    else if (b.name !== c.name)
      classes.push({ name: c.name, kind: 'renamed', id: c.id, fromName: b.name })
  }
  for (const b of before.classes) {
    if (!afterClassById.has(b.id))
      classes.push({ name: b.name, kind: 'removed', id: b.id })
  }

  // split 变化
  const splitKeys = new Set([
    ...Object.keys(before.stats.perSplit),
    ...Object.keys(after.stats.perSplit),
  ])
  const splits: SplitChange[] = []
  for (const k of splitKeys) {
    const bv = before.stats.perSplit[k] ?? 0
    const av = after.stats.perSplit[k] ?? 0
    if (bv !== av) splits.push({ split: k, before: bv, after: av })
  }

  return {
    summary: {
      added,
      removed,
      modified,
      classesChanged: classes.length,
      splitsChanged: splits.length,
    },
    samples,
    classes,
    splits,
    stats: { before: before.stats, after: after.stats },
    beforeLabel: before.label,
    afterLabel: after.label,
  }
}

/** 便捷：当前工作区 vs 一份已存清单 */
export function diffVersions(
  current: CanonicalDataset,
  saved: DatasetVersionManifest,
  datasetName: string,
): VersionDiff {
  const after = buildManifest(current, { label: '当前工作区', datasetName })
  return diffManifests(after, saved)
}
