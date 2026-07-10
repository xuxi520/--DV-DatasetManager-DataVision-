// useViewerState —— DatasetViewer 的共享状态与动作（单例）
// 将原本内联在 DatasetViewer.vue 中的全部响应式状态、计算属性与业务方法收拢到此 composable，
// 供 ViewerHeader / CompareWizard / ExportDialog / SettingsPanel / SingleView / CompareView 等子组件共享。
// 采用模块级单例：整个应用只有一个 DatasetViewer 实例，状态全局唯一，避免 prop 层层透传。
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { loadDatasetCanonical, sampleToAnnotations } from '../dataset/loadCanonical'
import {
  exportDatasetZip, previewRebalance, splitCounts,
  type ExportFormat,
} from '../dataset/exportBrowser'
import type { NamingPolicy } from '../dataset/naming'
import type { CanonicalDataset } from '../dataset/types'
import { hashService } from '../hashService'
import type { DataSet, ImageFile, ParsedAnnotation } from '../types'

export interface CompareConfig {
  datasetA: string
  datasetB: string
  mode: 'same' | 'diff'
}

function createViewerState() {
  // 视图模式 / 折叠
  const viewMode = ref<'single' | 'compare' | 'stats'>('single')
  const headerCollapsed = ref(false)
  const filePanelCollapsed = ref(false)
  const annotationPanelCollapsed = ref(false)
  const showSettings = ref(false)

  // 数据集管理
  const datasets = ref<DataSet[]>([])
  const datasetAnnotations = ref<Map<string, Map<string, ParsedAnnotation[]>>>(new Map())
  const categoryColorMap = ref<Map<string, string>>(new Map())

  // 加载状态
  const loading = ref(false)
  const loadingText = ref('加载数据集中...')
  const loadingPct = ref(0)
  const loadingDetail = ref('')

  // 计算哈希
  const computing = ref(false)
  const computeProgress = ref(0)
  const computeStatus = ref('')
  const cancelCompute = ref(false)

  // 导出数据
  const showExport = ref(false)
  const exporting = ref(false)
  const exportProgress = ref(0)
  const exportStatus = ref('')
  const exportFormat = ref<ExportFormat>('yolo')
  const exportPolicy = ref<NamingPolicy>('class_seq')
  const exportEnableRebalance = ref(false)
  const exportRatio = ref({ train: 8, val: 1, test: 1 })
  const exportStratify = ref(true)
  const exportLockTest = ref(false)
  const exportSeed = ref(1)

  // 文件列表
  const searchText = ref('')
  const filterType = ref<'all' | 'annotated' | 'unannotated'>('all')
  const selectedFile = ref<ImageFile | null>(null)
  const selectedAnnotationIndex = ref(-1)

  // 设置（标注显示 / 图像显示，跨 ImageViewer 共享）
  const showAnnotations = ref(true)
  const showAnnotationLabels = ref(true)
  const showConfidence = ref(true)
  const autoFit = ref(true)
  const showImageInfo = ref(true)

  // 对比模式配置
  const compareStep = ref(0)
  const compareReady = ref(false)
  const compareConfig = ref<CompareConfig>({
    datasetA: '',
    datasetB: '',
    mode: 'same',
  })

  // 对比模式状态
  const matchedFiles = ref<Array<{ fileA: ImageFile; fileB: ImageFile }>>([])
  const matchedFileIndex = ref(0)
  const selectedFileA = ref<ImageFile | null>(null)
  const selectedFileB = ref<ImageFile | null>(null)
  const currentIndexA = ref(0)
  const currentIndexB = ref(0)

  // 计算属性
  const hasDataset = computed(() => datasets.value.length > 0)
  const datasetCount = computed(() => datasets.value.length)
  const totalFiles = computed(() => {
    return datasets.value.reduce((sum, ds) => sum + ds.fileList.length, 0)
  })
  const totalAnnotations = computed(() => {
    let total = 0
    for (const annMap of datasetAnnotations.value.values()) {
      for (const annList of annMap.values()) {
        total += annList.length
      }
    }
    return total
  })

  const currentDatasetName = computed(() => {
    if (datasets.value.length === 0) return '未加载数据集'
    if (datasets.value.length === 1) return datasets.value[0].name
    return `已加${datasets.value.length} 个数据集`
  })

  const filteredFiles = computed(() => {
    if (!datasets.value[0]) return []
    let files = [...datasets.value[0].fileList]

    if (searchText.value) {
      const q = searchText.value.toLowerCase()
      files = files.filter((f) => f.name.toLowerCase().includes(q))
    }

    if (filterType.value === 'annotated') {
      files = files.filter((f) => getFileAnnotations(f).length > 0)
    } else if (filterType.value === 'unannotated') {
      files = files.filter((f) => getFileAnnotations(f).length === 0)
    }

    return files
  })

  const currentIndex = computed(() => {
    if (!selectedFile.value) return -1
    return filteredFiles.value.findIndex((f) => f.id === selectedFile.value!.id)
  })

  const canProceed = computed(() => {
    if (compareStep.value === 0) return compareConfig.value.datasetA !== ''
    if (compareStep.value === 1) return compareConfig.value.datasetB !== ''
    if (compareStep.value === 2) return true
    return true
  })

  const currentAnnotations = computed(() => {
    if (!selectedFile.value) return []
    return getFileAnnotations(selectedFile.value)
  })

  // 导出源与预览
  const exportSource = computed<{ ds: DataSet; canonical: CanonicalDataset } | null>(() => {
    const ds = datasets.value.find((d) => d.canonical)
    return ds && ds.canonical ? { ds, canonical: ds.canonical } : null
  })
  const currentSplitCounts = computed(() => {
    const src = exportSource.value
    if (!src) return null
    return splitCounts(src.canonical)
  })
  const rebalancePreview = computed(() => {
    const src = exportSource.value
    if (!src || !exportEnableRebalance.value) return null
    const { train, val, test } = exportRatio.value
    return previewRebalance(
      src.canonical,
      { train, val, test },
      { stratifyByClass: exportStratify.value, lockTest: exportLockTest.value, seed: exportSeed.value },
    )
  })

  // ===== 方法 =====
  function getFileAnnotations(file: ImageFile): ParsedAnnotation[] {
    // 1) canonical 规范模型为权威来源（统一管线导入，标注最全）
    for (const ds of datasets.value) {
      if (ds.canonical) {
        const s = ds.canonical.samples.find((x) => x.id === file.id)
        if (s && s.annotations.length) {
          return sampleToAnnotations(s, ds.canonical, categoryColorMap.value)
        }
      }
    }
    // 2) datasetAnnotations 表（id / path 兜底）
    for (const ds of datasets.value) {
      const annMap = datasetAnnotations.value.get(ds.id)
      if (annMap) {
        const byId = annMap.get(file.id)
        if (byId) return byId
        const byPath = annMap.get(file.path)
        if (byPath) return byPath
      }
    }
    return []
  }

  function getDatasetAnnotations(datasetId: string, file: ImageFile): ParsedAnnotation[] {
    const annMap = datasetAnnotations.value.get(datasetId)
    if (!annMap) return []
    return annMap.get(file.path) || []
  }

  function getDatasetName(datasetId: string): string {
    const ds = datasets.value.find((d) => d.id === datasetId)
    return ds?.name || '未知'
  }

  function getDatasetFileCount(datasetId: string): number {
    const ds = datasets.value.find((d) => d.id === datasetId)
    return ds?.fileList.length || 0
  }

  function getDatasetAnnotationCount(datasetId: string): number {
    const annMap = datasetAnnotations.value.get(datasetId)
    if (!annMap) return 0
    let count = 0
    for (const anns of annMap.values()) {
      count += anns.length
    }
    return count
  }

  function getMatchedFileCount(): number {
    if (!compareConfig.value.datasetA || !compareConfig.value.datasetB) return 0

    const dsA = datasets.value.find((d) => d.id === compareConfig.value.datasetA)
    const dsB = datasets.value.find((d) => d.id === compareConfig.value.datasetB)

    if (!dsA || !dsB) return 0

    const namesA = new Set(dsA.fileList.map((f) => f.name))
    const namesB = new Set(dsB.fileList.map((f) => f.name))

    let count = 0
    for (const name of namesA) {
      if (namesB.has(name)) count++
    }

    return count
  }

  function getAnnotationTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      bbox: '矩形',
      polygon: '多边形',
      circle: '圆形',
      rotation: '旋转框',
      keypoint: '关键点',
      polyline: '折线',
    }
    return labels[type] || type
  }

  function selectFile(file: ImageFile) {
    selectedFile.value = file
    selectedAnnotationIndex.value = -1
  }

  function prevFile() {
    if (currentIndex.value > 0) {
      selectFile(filteredFiles.value[currentIndex.value - 1])
    }
  }

  function nextFile() {
    if (currentIndex.value < filteredFiles.value.length - 1) {
      selectFile(filteredFiles.value[currentIndex.value + 1])
    }
  }

  function onAnnotationSelected(index: number) {
    selectedAnnotationIndex.value = index
  }

  function onViewModeChange() {
    if (viewMode.value === 'compare') {
      // 重置对比配置
      compareStep.value = 0
      compareReady.value = false
      compareConfig.value = { datasetA: '', datasetB: '', mode: 'same' }
    }
  }

  function handleWizardNext() {
    if (compareStep.value === 2) {
      // 预览步骤，直接跳到完成
      compareStep.value = 3
    } else {
      compareStep.value++
    }
  }

  function startCompare() {
    if (!compareConfig.value.datasetA || !compareConfig.value.datasetB) {
      ElMessage.warning('请选择两个数据集')
      return
    }

    // 构建匹配文件列表（同图对比模式）
    if (compareConfig.value.mode === 'same') {
      const dsA = datasets.value.find((d) => d.id === compareConfig.value.datasetA)
      const dsB = datasets.value.find((d) => d.id === compareConfig.value.datasetB)

      if (!dsA || !dsB) {
        ElMessage.error('数据集不存在')
        return
      }

      const mapB = new Map(dsB.fileList.map((f) => [f.name, f]))
      matchedFiles.value = []

      for (const fileA of dsA.fileList) {
        const fileB = mapB.get(fileA.name)
        if (fileB) {
          matchedFiles.value.push({ fileA, fileB })
        }
      }

      matchedFileIndex.value = 0

      if (matchedFiles.value.length === 0) {
        ElMessage.warning('没有找到匹配的图片（按文件名匹配）')
        return
      }
    } else {
      // 异图对比模式
      const dsA = datasets.value.find((d) => d.id === compareConfig.value.datasetA)
      if (dsA && dsA.fileList.length > 0) {
        selectedFileA.value = dsA.fileList[0]
        currentIndexA.value = 0
      }

      const dsB = datasets.value.find((d) => d.id === compareConfig.value.datasetB)
      if (dsB && dsB.fileList.length > 0) {
        selectedFileB.value = dsB.fileList[0]
        currentIndexB.value = 0
      }
    }

    compareReady.value = true
    ElMessage.success('对比模式已启动！')
  }

  function resetCompare() {
    compareReady.value = false
    compareStep.value = 0
    viewMode.value = 'compare'
  }

  function prevMatchedFile() {
    if (matchedFileIndex.value > 0) {
      matchedFileIndex.value--
    }
  }

  function nextMatchedFile() {
    if (matchedFileIndex.value < matchedFiles.value.length - 1) {
      matchedFileIndex.value++
    }
  }

  function prevFileInDataset(which: 'A' | 'B') {
    if (which === 'A' && currentIndexA.value > 0) {
      currentIndexA.value--
      const files = getDatasetFiles(compareConfig.value.datasetA)
      selectedFileA.value = files[currentIndexA.value]
    } else if (which === 'B' && currentIndexB.value > 0) {
      currentIndexB.value--
      const files = getDatasetFiles(compareConfig.value.datasetB)
      selectedFileB.value = files[currentIndexB.value]
    }
  }

  function nextFileInDataset(which: 'A' | 'B') {
    if (which === 'A') {
      const files = getDatasetFiles(compareConfig.value.datasetA)
      if (currentIndexA.value < files.length - 1) {
        currentIndexA.value++
        selectedFileA.value = files[currentIndexA.value]
      }
    } else if (which === 'B') {
      const files = getDatasetFiles(compareConfig.value.datasetB)
      if (currentIndexB.value < files.length - 1) {
        currentIndexB.value++
        selectedFileB.value = files[currentIndexB.value]
      }
    }
  }

  function getDatasetFiles(datasetId: string): ImageFile[] {
    const ds = datasets.value.find((d) => d.id === datasetId)
    return ds?.fileList || []
  }

  // 加载数据
  async function handleLoadDataset() {
    try {
      loading.value = true
      loadingText.value = '正在扫描文件...'
      loadingPct.value = 0
      loadingDetail.value = ''

      const { dataset, annotations, categoryColors, canonical, warnings } = await loadDatasetCanonical(
        (current, _total, status) => {
          loadingText.value = status
          loadingPct.value = current
          if (status.includes('图片')) {
            loadingDetail.value = status
          }
        },
      )
      dataset.canonical = canonical

      datasets.value.unshift(dataset)

      const annMap = new Map<string, ParsedAnnotation[]>()
      for (const [path, anns] of annotations) {
        annMap.set(path, anns)
      }
      datasetAnnotations.value.set(dataset.id, annMap)

      for (const [category, color] of categoryColors) {
        if (!categoryColorMap.value.has(category)) {
          categoryColorMap.value.set(category, color)
        }
      }

      if (dataset.fileList.length > 0) {
        selectFile(dataset.fileList[0])
      }

      const totalAnns = Array.from(annotations.values()).reduce((sum, arr) => sum + arr.length, 0)
      if (warnings.length) {
        ElMessage.warning(
          `导入提示（${warnings.length} 条）：${warnings.slice(0, 3).join('，')}${warnings.length > 3 ? ' …' : ''}`,
        )
      }
      ElMessage.success(`加载成功：${dataset.fileList.length} 张图片，${totalAnns} 个标注`)
    } catch (e: any) {
      if (e.message !== '用户取消选择') {
        ElMessage.error('加载失败' + e.message)
      }
    } finally {
      loading.value = false
    }
  }

  async function handleAddDataset() {
    await handleLoadDataset()
  }

  async function handleComputeHashes() {
    if (datasets.value.length === 0) return

    computing.value = true
    computeProgress.value = 0
    cancelCompute.value = false

    const allFiles: ImageFile[] = []
    for (const ds of datasets.value) {
      allFiles.push(...ds.fileList)
    }

    try {
      await hashService.computeHashes(
        allFiles,
        (fileId, hash, phash) => {
          for (const ds of datasets.value) {
            const file = ds.fileList.find((f) => f.id === fileId)
            if (file) {
              file.hash = hash
              file.phash = phash
              break
            }
          }
        },
        (processed, total) => {
          computeProgress.value = Math.round((processed / total) * 100)
          computeStatus.value = `Computing ${processed}/${total}`
        },
      )

      ElMessage.success('哈希计算完成')
    } catch (e: any) {
      ElMessage.error('计算失败' + e.message)
    } finally {
      computing.value = false
    }
  }

  function handleExport() {
    if (datasets.value.length === 0) {
      ElMessage.warning('请先加载数据集')
      return
    }
    if (!exportSource.value) {
      ElMessage.warning('当前数据集缺少规范中间模型（canonical），请通过「加载数据」重新导入后再导出')
      return
    }
    showExport.value = true
  }

  async function runExport() {
    const src = exportSource.value
    if (!src) return
    exporting.value = true
    exportProgress.value = 0
    exportStatus.value = '准备中...'
    try {
      const { train, val, test } = exportRatio.value
      const count = await exportDatasetZip(
        src.canonical,
        {
          format: exportFormat.value,
          policy: exportPolicy.value,
          datasetName: src.ds.name,
          rebalance: exportEnableRebalance.value
            ? {
                targets: { train, val, test },
                options: {
                  stratifyByClass: exportStratify.value,
                  lockTest: exportLockTest.value,
                  seed: exportSeed.value,
                },
              }
            : undefined,
        },
        (pct, status) => {
          exportProgress.value = pct
          exportStatus.value = status
        },
      )
      ElMessage.success(`导出成功：共 ${count} 个文件，已打包下载`)
      showExport.value = false
    } catch (e: any) {
      ElMessage.error('导出失败' + (e?.message || e))
    } finally {
      exporting.value = false
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') {
      if (viewMode.value === 'compare' && compareReady.value) {
        if (compareConfig.value.mode === 'same') {
          prevMatchedFile()
        }
      } else {
        prevFile()
      }
    } else if (e.key === 'ArrowRight') {
      if (viewMode.value === 'compare' && compareReady.value) {
        if (compareConfig.value.mode === 'same') {
          nextMatchedFile()
        }
      } else {
        nextFile()
      }
    }
  }

  return {
    // 视图 / 折叠
    viewMode, headerCollapsed, filePanelCollapsed, annotationPanelCollapsed, showSettings,
    // 数据集
    datasets, datasetAnnotations, categoryColorMap,
    // 加载
    loading, loadingText, loadingPct, loadingDetail,
    // 哈希
    computing, computeProgress, computeStatus, cancelCompute,
    // 导出
    showExport, exporting, exportProgress, exportStatus,
    exportFormat, exportPolicy, exportEnableRebalance, exportRatio,
    exportStratify, exportLockTest, exportSeed,
    // 文件列表
    searchText, filterType, selectedFile, selectedAnnotationIndex,
    // 设置
    showAnnotations, showAnnotationLabels, showConfidence, autoFit, showImageInfo,
    // 对比
    compareStep, compareReady, compareConfig,
    matchedFiles, matchedFileIndex, selectedFileA, selectedFileB, currentIndexA, currentIndexB,
    // 计算属性
    hasDataset, datasetCount, totalFiles, totalAnnotations,
    currentDatasetName, filteredFiles, currentIndex, canProceed, currentAnnotations,
    exportSource, currentSplitCounts, rebalancePreview,
    // 方法
    getFileAnnotations, getDatasetAnnotations, getDatasetName, getDatasetFileCount,
    getDatasetAnnotationCount, getMatchedFileCount, getAnnotationTypeLabel, getDatasetFiles,
    selectFile, prevFile, nextFile, onAnnotationSelected, onViewModeChange,
    handleWizardNext, startCompare, resetCompare,
    prevMatchedFile, nextMatchedFile, prevFileInDataset, nextFileInDataset,
    handleLoadDataset, handleAddDataset, handleComputeHashes, handleExport, runExport, handleKeydown,
  }
}

let _instance: ReturnType<typeof createViewerState> | null = null

export function useViewerState() {
  if (!_instance) _instance = createViewerState()
  return _instance
}
