/**
 * 类型定义文件
 */

// 导入类型
import type { CanonicalDataset } from './dataset/types'
import type { StructureAnalysisResult, AnnotationFormat, MatchingRule, DatasetSplit } from './datasetStructureAnalyzer'
import type { ParsedAnnotation } from './annotationParser'
export type { ParsedAnnotation, StructureAnalysisResult, AnnotationFormat, MatchingRule, DatasetSplit }



/** 图片文件信息 */
export interface ImageFile {
  id: string
  name: string
  path: string
  size: number
  width: number
  height: number
  hash?: string
  phash?: string
  dhash?: string
  ahash?: string
  blob?: Blob
  url?: string
}

/** 数据集 */
export interface DataSet {
  id: string
  name: string
  files: Map<string, ImageFile>
  fileList: ImageFile[]
  totalCount: number
  dupCount: number
  uniqueCount: number
  structureAnalysis?: StructureAnalysisResult
  annotationFiles?: Map<string, AnnotationFile>
  /** 归一化中间模型（由 src/dataset 导入器生成），供去重/重划分/导出共享同一份数据 */
  canonical?: CanonicalDataset
  /** 标注数据（由导入器生成，键为图片路径） */
  annotations?: Map<string, ParsedAnnotation[]>
}

/** 标注文件信息 */
export interface AnnotationFile {
  id: string
  name: string
  path: string
  format: AnnotationFormat
  content?: string
  relatedImageId?: string
}

/** 比对结果 */
export interface CompareResult {
  type: 'duplicate' | 'similar' | 'unique' | 'onlyA' | 'onlyB'
  fileA?: ImageFile
  fileB?: ImageFile
  similarity: number
  groupId: string
}

/** 环境类型 */
export type EnvType = 'browser' | 'tauri'

/** 应用状态 */
export interface AppState {
  env: EnvType
  datasetA: DataSet | null
  datasetB: DataSet | null
  compareMode: boolean
  results: CompareResult[]
  selectedFiles: Set<string>
  filter: FilterOptions
  sortBy: SortOption
}

export interface FilterOptions {
  type: 'all' | 'duplicate' | 'similar' | 'unique'
  minSimilarity: number
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  minSize: number
  maxSize: number
  search: string
}

export type SortOption = 'name' | 'size' | 'width' | 'height' | 'similarity'

export interface StatsData {
  totalA: number
  totalB: number
  duplicateCount: number
  similarCount: number
  uniqueA: number
  uniqueB: number
  duplicateRate: number
  avgSimilarity: number
  resolutionDist: { range: string; count: number }[]
  formatDist: { format: string; count: number }[]
  sizeDist: { range: string; count: number }[]
}
