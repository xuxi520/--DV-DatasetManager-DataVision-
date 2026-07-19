/**
 * 类型定义文件
 */

// 导入类型
import type { CanonicalDataset } from './dataset/types'
import type { ParsedAnnotation } from './annotationParser'

/** 标注格式类型（旧管线遗留，部分服务仍引用） */
export type AnnotationFormat = 'yolo' | 'voc' | 'coco' | 'labelme' | 'custom'

/** 文件匹配规则（旧管线遗留） */
export interface MatchingRule {
  type: 'same_name' | 'same_dir' | 'custom'
  imagePattern: string
  annotationPattern: string
  customRule?: string
}

export type { ParsedAnnotation }



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
  /** 浏览器端原始文件句柄（轻量引用，不持有字节）；切图时由 selectFile 懒生成预览 URL */
  sourceFile?: File
  /** Tauri 端：文件在磁盘上的绝对路径（供 asset 协议直读 / 直接删除，零 JS 拷贝） */
  absPath?: string
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
  annotationFiles?: Map<string, AnnotationFile>
  /** 归一化中间模型（由 src/dataset 导入器生成），供去重/重划分/导出共享同一份数据 */
  canonical?: CanonicalDataset
  /** 标注数据（由导入器生成，键为图片路径） */
  annotations?: Map<string, ParsedAnnotation[]>
  /** Tauri 端：本数据集根目录的绝对路径（用于把相对 sourcePath 还原为绝对路径做读/删） */
  rootAbsPath?: string
  /** Tauri 端：分目录加载时标注根的绝对路径（图片与标注不在同一目录）；标注文件删除时按其定位 */
  labelRootAbsPath?: string
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
