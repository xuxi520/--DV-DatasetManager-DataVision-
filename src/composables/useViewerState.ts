// useViewerState —— DatasetViewer 的共享状态与动作（单例）
// 将原本内联在 DatasetViewer.vue 中的全部响应式状态、计算属性与业务方法收拢到此 composable，
// 供 ViewerHeader / ExportDialog / SettingsPanel / PaneView 等子组件共享。
// 采用模块级单例：整个应用只有一个 DatasetViewer 实例，全局状态唯一，避免 prop 层层透传。
//
// 架构说明（双窗格对比）：
// - 全局状态：datasets / datasetAnnotations / categoryColorMap / 标注缓存 / 加载 / 哈希 / 导出 / 显示设置 / viewMode / activePane。
// - 每个「窗格(pane)」拥有独立的 datasetId、searchText、filterType、sortKey、sortDir、selectedFile、selectedAnnotationIndex，
//   即左右两侧各自独立搜索、排序、筛选、选中，形成对照且互不干扰。
// - leftPane 始终存在（单图模式）；rightPane 在「对比」模式下显示，可绑定另一个数据集。
// - 标注缓存按 `datasetId:fileId` 作用域隔离，避免两个数据集同名相对路径导致 id 冲突串味。
// - Blob URL 用全局 LRU（容量 6）管理，左右窗格各显示一张图也不会互相释放。
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useExport } from './viewer/useExport'
import { useVersion } from './viewer/useVersion'
import type { CanonicalDataset } from '../dataset/types'
import type { DatasetMeta } from '../workspace/workspaceStore'
import { useQuality } from '../composables/useQuality'
import type { DataSet, ImageFile, ParsedAnnotation } from '../types'
import { createUrlCache } from './viewer/useUrlCache'
import { useAnnotations } from './viewer/useAnnotations'
import { usePanes } from './viewer/usePanes'
import { useCompute } from './viewer/useCompute'
import { useLoading } from './viewer/useLoading'
import { useWorkspace } from './viewer/useWorkspace'
import { useView } from './viewer/useView'
// 窗格/筛选领域类型已抽到 composables/viewer/types.ts，向消费者再导出以保持对外契约
export type { PaneState, FilterType, SortKey, OverlapInfo } from './viewer/types'

// ===== 窗格状态（左右两侧各一份，独立搜索/排序/筛选/选中）=====


function createViewerState() {
  // 质量检查单例（跨窗格共享结果/统计/阈值）；须在 usePanes 依赖之前声明
  const quality = useQuality()

  // 数据集管理
  const datasets = ref<DataSet[]>([])
  // 导出 / 版本 集群：独立 composable，仅依赖共享的 datasets
  const exportSlice = useExport(datasets)
  const versionSlice = useVersion(datasets)
  const datasetAnnotations = ref<Map<string, Map<string, ParsedAnnotation[]>>>(new Map())
  const categoryColorMap = ref<Map<string, string>>(new Map())
  /** 各数据集的来源元信息（路径 / 目录句柄 / 格式），供工作区持久化捕获与重建 */
  const datasetMeta = ref<Map<string, DatasetMeta>>(new Map())

  // 标注缓存：getFileAnnotations 曾是性能瓶颈。按 `datasetId:fileId` 作用域隔离，
  // 既保留 O(1) 命中，又避免双数据集同名相对路径（id 相同）导致注释串味。
  const annotationsCache = new Map<string, ParsedAnnotation[]>()

  // 共享缓存 / 工具（已抽到独立模块）
  const urlCacheHelper = createUrlCache()
  // 标注访问 + 编辑清洗台（独立 composable）
  const ann = useAnnotations({
    datasets,
    datasetAnnotations,
    categoryColorMap,
    annotationsCache,
  })
  // 窗格管理（独立 composable）
  const paneSlice = usePanes({
    datasets,
    getFileAnnotations: ann.getFileAnnotations,
    annVersion: ann.annVersion,
    quality,
    ensureUrl: urlCacheHelper.ensureUrl,
  })
  // 兼容别名：供后续切片（loading / workspace / 计算 / 键盘）作为依赖参数复用。
  const annVersion = ann.annVersion
  const panes = paneSlice.panes
  const activePane = paneSlice.activePane
  const dualPane = paneSlice.dualPane
  const syncByFilename = paneSlice.syncByFilename
  const MAX_PANES = paneSlice.MAX_PANES
  const paneSeq = paneSlice.paneSeq
  const createPane = paneSlice.createPane
  const activePaneState = paneSlice.activePaneState
  const prevFileAll = paneSlice.prevFileAll
  const nextFileAll = paneSlice.nextFileAll
  const addPane = paneSlice.addPane
  const closePane = paneSlice.closePane
  const undo = ann.undo
  const redo = ann.redo
  const deleteAnnotationAt = ann.deleteAnnotationAt

  // 计算（哈希 / 质量检查）目标筛选辅助（供 useCompute 依赖，须在切片之前定义）
  /** 解析目标数据集对应的文件列表：'__all__' / null = 全部已加载数据集 */
  function filesForTarget(targetId: string | null): ImageFile[] {
    if (targetId && targetId !== '__all__') {
      return datasets.value.find((d) => d.id === targetId)?.fileList ?? []
    }
    const all: ImageFile[] = []
    for (const ds of datasets.value) all.push(...ds.fileList)
    return all
  }
  /** 默认目标：当前焦点窗格的数据集，否则第一个已加载数据集 */
  function defaultTargetId(): string | null {
    const active = activePaneState.value.datasetId.value
    if (active && datasets.value.some((d) => d.id === active)) return active
    return datasets.value[0]?.id ?? null
  }

  // 计算簇（哈希计算 + 质量检查）
  const computeSlice = useCompute({ datasets, quality, filesForTarget, defaultTargetId })
  // 加载簇（数据集加载 / 纠错回路 / 结果接入 / 来源元信息）
  const loadingSlice = useLoading({ datasets, datasetAnnotations, categoryColorMap, datasetMeta, annotationsCache, urlCacheHelper, panes, activePane, activePaneState, MAX_PANES, paneSeq, createPane })
  // 视图簇（视图模式 / 显示设置 / 共享侧栏 / 键盘导航 glue）
  const viewSlice = useView({
    activePaneState, dualPane, activePane, panes,
    prevFileAll, nextFileAll, undo, redo, deleteAnnotationAt,
  })
  // 工作区簇（结构配置序列化 / 持久化 / 恢复 / 清空 + 自动保存）
  const workspaceSlice = useWorkspace({
    datasets, datasetMeta, annotationsCache, urlCacheHelper, panes, activePane,
    viewMode: viewSlice.viewMode, headerCollapsed: viewSlice.headerCollapsed,
    sidebarCollapsed: viewSlice.sidebarCollapsed, filePanelCollapsed: viewSlice.filePanelCollapsed,
    annotationPanelCollapsed: viewSlice.annotationPanelCollapsed,
    syncByFilename, showAnnotations: viewSlice.showAnnotations, showAnnotationLabels: viewSlice.showAnnotationLabels,
    showConfidence: viewSlice.showConfidence, autoFit: viewSlice.autoFit, showImageInfo: viewSlice.showImageInfo,
    showAnnotationList: viewSlice.showAnnotationList,
    addPane, closePane, MAX_PANES,
    applyLoadResult: loadingSlice.applyLoadResult, captureMeta: loadingSlice.captureMeta,
    loading: loadingSlice.loading, loadingText: loadingSlice.loadingText,
    loadingPct: loadingSlice.loadingPct, loadingDetail: loadingSlice.loadingDetail,
  })


  // 计算属性
  const hasDataset = computed(() => datasets.value.length > 0)
  const datasetCount = computed(() => datasets.value.length)
  const totalFiles = computed(() => {
    return datasets.value.reduce((sum, ds) => sum + ds.fileList.length, 0)
  })
  // 统计：以 canonical 为权威来源并依赖 annVersion，使编辑（增删/改类）后实时刷新，
  // 不再读陈旧的 datasetAnnotations 表。
  const totalAnnotations = computed(() => {
    annVersion.value // 编辑信号
    let total = 0
    for (const ds of datasets.value) {
      if (ds.canonical) {
        for (const s of ds.canonical.samples) total += s.annotations.length
      } else {
        const annMap = datasetAnnotations.value.get(ds.id)
        if (annMap) for (const anns of annMap.values()) total += anns.length
      }
    }
    return total
  })

  const currentDatasetName = computed(() => {
    if (datasets.value.length === 0) return '未加载数据集'
    if (datasets.value.length === 1) return datasets.value[0].name
    return `已加${datasets.value.length} 个数据集`
  })

  /** 当前焦点窗格数据集的识别格式（供 header 纠错切换器展示） */
  const activeFormat = computed<CanonicalDataset['sourceFormat'] | ''>(() => {
    const ds = activePaneState.value.dataset.value
    return ds?.canonical?.detection?.format ?? ds?.canonical?.sourceFormat ?? ''
  })


  return {
    // 数据集
    datasets, datasetAnnotations, categoryColorMap, filesForTarget,
    // 计算（哈希 / 质量检查）：独立 composable
    ...computeSlice,
    // 加载（数据集加载 / 纠错回路 / 结果接入 / 来源元信息）：独立 composable
    ...loadingSlice,
    // 导出 / 版本（独立 composable 组合）
    ...exportSlice, ...versionSlice,
    // 工作区结构配置持久化（多数据集）：独立 composable
    ...workspaceSlice,
    // 视图 / 显示 / 侧栏 / 键盘导航 glue：独立 composable
    ...viewSlice,
    // 计算属性
    hasDataset, datasetCount, totalFiles, totalAnnotations,
    currentDatasetName, activeFormat,
    quality,
    // 标注编辑（清洗台）+ 窗格（多窗格状态）：独立 composable，已对齐对外契约
    ...ann, ...paneSlice,
  }
}

let _instance: ReturnType<typeof createViewerState> | null = null

export function useViewerState() {
  if (!_instance) _instance = createViewerState()
  return _instance
}
