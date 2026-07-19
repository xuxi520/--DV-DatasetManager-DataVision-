// 窗格 / 筛选 / 排序 领域类型（从 useViewerState 抽出，供 usePanes 与主文件共享）
import type { Ref, ComputedRef } from 'vue'
import type { DataSet, ImageFile, ParsedAnnotation } from '../../types'

export type FilterType = 'all' | 'annotated' | 'unannotated' | 'overlap' | 'nooverlap' | 'quality'
export type SortKey = 'name' | 'ann' | 'overlap' | 'wh' | 'size'

export interface OverlapInfo {
  pairs: number
  hasOverlap: boolean
  maxIou: number
}

// 单个窗格的响应式状态与方法契约（每个窗格独立搜索/排序/筛选/选中）
export interface PaneState {
  id: string
  datasetId: Ref<string | null>
  searchText: Ref<string>
  filterType: Ref<FilterType>
  sortKey: Ref<SortKey>
  sortDir: Ref<'asc' | 'desc'>
  selectedFile: Ref<ImageFile | null>
  selectedAnnotationIndex: Ref<number>
  dataset: ComputedRef<DataSet | null>
  datasetName: ComputedRef<string>
  fileOverlapMap: ComputedRef<Map<string, OverlapInfo>>
  filteredFiles: ComputedRef<ImageFile[]>
  currentIndex: ComputedRef<number>
  currentAnnotations: ComputedRef<ParsedAnnotation[]>
  selectFile: (file: ImageFile) => void
  prevFile: () => void
  nextFile: () => void
  onAnnotationSelected: (index: number) => void
  setDataset: (id: string | null) => void
}
