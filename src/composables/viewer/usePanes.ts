import { ref, computed, shallowRef } from 'vue'
import { ElMessage } from 'element-plus'
import { computeFileOverlap } from '../useDatasetStats'
import { useQuality } from '../useQuality'
import type { Ref } from 'vue'
import type { DataSet, ImageFile, ParsedAnnotation } from '../../types'
import type { PaneState, FilterType, SortKey, OverlapInfo } from './types'

type Quality = ReturnType<typeof useQuality>

/**
 * 窗格（多视图对比）簇：包含窗格创建、筛选/排序、文件导航、跨窗格对齐、增删与拖拽分隔。
 * 与 useViewerState 主文件解耦，仅依赖注入的 datasets / getFileAnnotations / annVersion / quality / ensureUrl，
 * 对外契约（footerSelected / paneIndexInfo / fileOverlapMap / addPane 等）与原主文件实现保持一致。
 */
export interface PanesDeps {
  datasets: Ref<DataSet[]>
  getFileAnnotations: (file: ImageFile) => ParsedAnnotation[]
  annVersion: Ref<number>
  quality: Quality
  ensureUrl: (file: ImageFile) => string | undefined
}

export function usePanes(deps: PanesDeps) {
  const { datasets, getFileAnnotations, annVersion, quality, ensureUrl } = deps

  const paneSeq = { n: 0 }
  const MAX_PANES = 6

  function createPane(id: string): PaneState {
    const datasetId = ref<string | null>(null)
    const searchText = ref('')
    const filterType = ref<FilterType>('all')
    const sortKey = ref<SortKey>('name')
    const sortDir = ref<'asc' | 'desc'>('asc')
    const selectedFile = ref<ImageFile | null>(null)
    const selectedAnnotationIndex = ref(-1)

    const dataset = computed<DataSet | null>(() => datasets.value.find((d) => d.id === datasetId.value) || null)
    const datasetName = computed(() => dataset.value?.name || (id === 'left' ? '未选择数据集' : '未选择对比数据集'))

    // 单文件内标注重叠（供筛选/排序/侧栏徽标使用），key 为 file.id
    const fileOverlapMap = computed<Map<string, OverlapInfo>>(() => {
      annVersion.value
      const map = new Map<string, OverlapInfo>()
      const ds = dataset.value
      if (!ds) return map
      for (const f of ds.fileList) {
        map.set(f.id, computeFileOverlap(getFileAnnotations(f), f.width || 0, f.height || 0))
      }
      return map
    })

    const filteredFiles = computed<ImageFile[]>(() => {
      const ds = dataset.value
      if (!ds) return []
      let files = [...ds.fileList]
      const q = searchText.value.trim().toLowerCase()
      if (q) files = files.filter((f) => f.name.toLowerCase().includes(q))
      if (filterType.value === 'annotated') files = files.filter((f) => getFileAnnotations(f).length > 0)
      else if (filterType.value === 'unannotated') files = files.filter((f) => getFileAnnotations(f).length === 0)
      else if (filterType.value === 'overlap') files = files.filter((f) => fileOverlapMap.value.get(f.id)?.hasOverlap)
      else if (filterType.value === 'nooverlap') files = files.filter((f) => !fileOverlapMap.value.get(f.id)?.hasOverlap)
      else if (filterType.value === 'quality') files = files.filter((f) => {
        const r = quality.results.value.get(f.id)
        if (!r) return false
        return quality.issueList(r).length > 0
      })
      const dir = sortDir.value === 'asc' ? 1 : -1
      const sorted = [...files]
      sorted.sort((a, b) => {
        switch (sortKey.value) {
          case 'ann': return (getFileAnnotations(a).length - getFileAnnotations(b).length) * dir
          case 'overlap': return ((fileOverlapMap.value.get(a.id)?.pairs || 0) - (fileOverlapMap.value.get(b.id)?.pairs || 0)) * dir
          case 'wh': return (a.width * a.height - b.width * b.height) * dir
          case 'size': return ((a.size || 0) - (b.size || 0)) * dir
          default: return a.name.localeCompare(b.name) * dir
        }
      })
      return sorted
    })

    const currentIndex = computed(() => {
      if (!selectedFile.value) return -1
      return filteredFiles.value.findIndex((f) => f.id === selectedFile.value!.id)
    })
    const currentAnnotations = computed<ParsedAnnotation[]>(() =>
      selectedFile.value ? (annVersion.value, getFileAnnotations(selectedFile.value)) : [],
    )
    function selectFile(file: ImageFile) {
      ensureUrl(file)
      selectedFile.value = file
      selectedAnnotationIndex.value = -1
    }
    function prevFile() {
      if (currentIndex.value > 0) selectFile(filteredFiles.value[currentIndex.value - 1])
    }
    function nextFile() {
      if (currentIndex.value < filteredFiles.value.length - 1) selectFile(filteredFiles.value[currentIndex.value + 1])
    }
    function onAnnotationSelected(index: number) {
      selectedAnnotationIndex.value = index
    }
    function setDataset(id: string | null) {
      datasetId.value = id
      selectedFile.value = null
      selectedAnnotationIndex.value = -1
    }
    return {
      id,
      datasetId,
      searchText,
      filterType,
      sortKey,
      sortDir,
      selectedFile,
      selectedAnnotationIndex,
      dataset,
      datasetName,
      fileOverlapMap,
      filteredFiles,
      currentIndex,
      currentAnnotations,
      selectFile,
      prevFile,
      nextFile,
      onAnnotationSelected,
      setDataset,
    }
  }

  const panes = shallowRef<PaneState[]>([createPane('p' + paneSeq.n++)])
  const dualPane = computed(() => panes.value.length > 1)
  const activePane = ref<string>(panes.value[0]?.id ?? 'p0')
  const paneWidths = ref<Record<string, number>>({})
  const syncByFilename = ref(false)

  function getPaneStyle(id: string): Record<string, string> {
    const w = paneWidths.value[id]
    return w != null ? { flex: `0 0 ${w}px` } : { flex: '1 1 0%' }
  }
  const resizing = ref(false)
  function startResize(e: MouseEvent, aId: string, bId: string) {
    const aEl = document.querySelector(`[data-pane-id="${aId}"]`) as HTMLElement | null
    const bEl = document.querySelector(`[data-pane-id="${bId}"]`) as HTMLElement | null
    if (!aEl || !bEl) return
    if (paneWidths.value[aId] == null) paneWidths.value = { ...paneWidths.value, [aId]: aEl.offsetWidth }
    if (paneWidths.value[bId] == null) paneWidths.value = { ...paneWidths.value, [bId]: bEl.offsetWidth }
    const startX = e.clientX
    const aw = paneWidths.value[aId]
    const bw = paneWidths.value[bId]
    resizing.value = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX
      const newA = Math.max(160, aw + delta)
      const newB = Math.max(160, bw - delta)
      paneWidths.value = { ...paneWidths.value, [aId]: newA, [bId]: newB }
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      resizing.value = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const activePaneState = computed<PaneState>(() =>
    panes.value.find((p) => p.id === activePane.value) || panes.value[0],
  )

  const footerCount = computed(() => activePaneState.value.filteredFiles.value.length)
  const footerIndex = computed(() => activePaneState.value.currentIndex.value)
  const footerSelected = computed(() => activePaneState.value.selectedFile.value)

  const paneIndexInfo = computed(() =>
    panes.value.map((p) => ({
      id: p.id,
      idx: panes.value.indexOf(p) + 1,
      name: p.dataset.value?.name || '未选择',
      index: p.currentIndex.value,
      count: p.filteredFiles.value.length,
      hasFile: !!p.selectedFile.value,
    })),
  )

  function alignPanesByName() {
    const active = activePaneState.value
    const name = active.selectedFile.value?.name
    if (!name) return
    for (const p of panes.value) {
      if (p === active) continue
      if (!p.selectedFile.value) continue
      const match = p.filteredFiles.value.find((f) => f.name === name)
      if (match) p.selectFile(match)
    }
  }

  function prevFileAll() {
    if (syncByFilename.value) {
      activePaneState.value.prevFile()
      alignPanesByName()
      return
    }
    for (const p of panes.value) {
      if (p.selectedFile.value) p.prevFile()
    }
  }
  function nextFileAll() {
    if (syncByFilename.value) {
      activePaneState.value.nextFile()
      alignPanesByName()
      return
    }
    for (const p of panes.value) {
      if (p.selectedFile.value) p.nextFile()
    }
  }

  const allCanPrev = computed(() => {
    if (syncByFilename.value) {
      const a = activePaneState.value
      return !!a.selectedFile.value && a.currentIndex.value > 0
    }
    return panes.value.some((p) => p.selectedFile.value && p.currentIndex.value > 0)
  })
  const allCanNext = computed(() => {
    if (syncByFilename.value) {
      const a = activePaneState.value
      return !!a.selectedFile.value && a.currentIndex.value < a.filteredFiles.value.length - 1
    }
    return panes.value.some((p) => p.selectedFile.value && p.currentIndex.value < p.filteredFiles.value.length - 1)
  })

  function addPane() {
    if (panes.value.length >= MAX_PANES) {
      ElMessage.warning(`最多支持 ${MAX_PANES} 个对比窗口`)
      return
    }
    const id = 'p' + paneSeq.n++
    const pane = createPane(id)
    panes.value = [...panes.value, pane]
    activePane.value = id
    if (datasets.value.length > 0) {
      const used = new Set(panes.value.map((p) => p.datasetId.value))
      const other = datasets.value.find((d) => !used.has(d.id)) || datasets.value[0]
      if (other) {
        pane.setDataset(other.id)
        if (other.fileList.length) pane.selectFile(other.fileList[0])
      }
    }
  }

  function closePane(id: string) {
    if (panes.value.length <= 1) return
    const idx = panes.value.findIndex((p) => p.id === id)
    if (idx < 0) return
    const removed = panes.value[idx]
    panes.value = panes.value.filter((_, i) => i !== idx)
    removed.setDataset(null)
    if (paneWidths.value[id] != null) {
      const nw = { ...paneWidths.value }
      delete nw[id]
      paneWidths.value = nw
    }
    if (activePane.value === id) {
      activePane.value = panes.value[Math.max(0, idx - 1)].id
    }
  }

  return {
    panes,
    dualPane,
    activePane,
    paneWidths,
    syncByFilename,
    MAX_PANES,
    paneSeq,
    createPane,
    activePaneState,
    footerCount,
    footerIndex,
    footerSelected,
    paneIndexInfo,
    alignPanesByName,
    prevFileAll,
    nextFileAll,
    allCanPrev,
    allCanNext,
    addPane,
    closePane,
    getPaneStyle,
    resizing,
    startResize,
  }
}
