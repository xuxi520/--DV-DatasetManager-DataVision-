/**
 * 去重模块类型定义
 */
import type { ImageFile } from '../types'

/** 去重强度 */
export type DedupStrength = 'strict' | 'standard' | 'loose'

/** 强度预设 */
export interface StrengthPreset {
  key: DedupStrength
  label: string
  description: string
  /** pHash 汉明距离阈值（<= 视为相似） */
  phashThreshold: number
  /** dHash 汉明距离阈值 */
  dhashThreshold: number
  /** 是否使用 MD5 精确匹配（严格模式主判据） */
  useExact: boolean
}

/** 数据集拆分类型 */
export type SplitKey = 'train' | 'val' | 'test' | 'unknown' | 'none'

/** 去重选项 */
export interface DedupOptions {
  strength: DedupStrength
  /** train/val/test 不交叉去重 */
  separateSplits: boolean
  /** 由逻辑数据集提供权威 split（覆盖从 path 推断） */
  splitOf?: (file: ImageFile) => SplitKey
  /** 子集比较模式：within=仅子集内去重；mixed=全量比对但只报告含子集的组 */
  compareMode?: 'within' | 'mixed'
  /** 子集路径集合（Phase 3）：与 compareMode 配合 */
  subsetPaths?: Set<string>
  /** 跨子集泄漏检测（同一图出现在 train/test 等多个 split） */
  detectLeakage?: boolean
  /** 脏数据同步检测（离群/无效图） */
  detectDirty: boolean
  /** 增量模式：复用已有哈希索引 */
  incremental: boolean
  /** 离群判定阈值（与最近邻的最小汉明距离 > 该值视为离群） */
  outlierThreshold: number
  /** 每个重复组仅保留一张（默认开启） */
  keepOnePerGroup: boolean
}

/** 单文件哈希结果 */
export interface FileHash {
  md5: string
  phash: string
  dhash: string
  ahash: string
}

/** 拆分 & 类别元信息 */
export interface SplitMeta {
  split: SplitKey
  category: string
}

/** 重复组 */
export interface DuplicateGroup {
  id: string
  split: SplitKey
  category: string
  /** 组内文件（当前已加载的 ImageFile） */
  files: ImageFile[]
  /** 推荐保留的文件 id（为空表示原件在已有索引中，应移除新增的副本） */
  keepId: string
  /** 将被移除的文件 id 列表 */
  removeIds: string[]
  /** 组内最小汉明距离（代表相似度，0 表示完全一致） */
  minDistance: number
  /** 是否完全精确重复（MD5 相同） */
  exact: boolean
  /** 与已有索引中某图重复（增量场景） */
  duplicateOfExternal?: boolean
  /** 跨子集泄漏组（同一图出现在多个 split） */
  leakage?: boolean
  /** 泄漏组覆盖的 split 列表 */
  splits?: SplitKey[]
}

/** 脏数据类型 */
export type DirtyKind = 'invalid' | 'outlier'

/** 脏图（异常/无效） */
export interface DirtyImage {
  file: ImageFile
  kind: DirtyKind
  reason: string
  /** 与最近邻的最小汉明距离（outlier 时有效） */
  minDistance?: number
}

/** 跨子集泄漏对（同一图出现在多个 split，数据泄漏） */
export interface LeakagePair {
  aId: string
  bId: string
  fileA?: ImageFile
  fileB?: ImageFile
  splitA: SplitKey
  splitB: SplitKey
  md5?: string
  /** 最小汉明距离 */
  distance: number
  /** MD5 完全一致 */
  exact: boolean
}

/** 去重结果 */
export interface DedupResult {
  total: number
  hashed: number
  failed: string[]
  groups: DuplicateGroup[]
  dirty: DirtyImage[]
  /** 计划移除的文件路径（相对数据集根） */
  removablePaths: string[]
  /** 保留的文件路径 */
  keepPaths: string[]
  stats: {
    exactDuplicates: number
    nearDuplicates: number
    dirtyInvalid: number
    dirtyOutlier: number
    removable: number
    reducedRatio: number
  }
  splitDistribution: Record<SplitKey, number>
  /** 各 split 下计划移除的文件数（回答"删的是哪个子集"） */
  removedBySplit: Record<SplitKey, number>
  /** 跨子集泄漏对 */
  leakage: LeakagePair[]
}

/** 哈希索引条目（用于增量去重） */
export interface HashIndexEntry {
  path: string
  size: number
  md5: string
  phash: string
  dhash: string
  ahash: string
}

/** 哈希索引：path -> 条目 */
export type HashIndex = Record<string, HashIndexEntry>
