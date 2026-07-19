import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import {
  loadDatasetCanonical, reimportDataset, peekLoadHandles, forgetLoadHandles,
  setAnnotationChooser,
  type LoadOptions, type CanonicalLoadResult, type AnnotationChooser,
} from '../../dataset/loadCanonical'
import type { AnnotationCandidate } from '../../dataset/annotationCandidates'
import { env, pickDirectoryTauri, pickDirectoryBrowser } from '../../env'
import { capabilities } from '../../capabilities'
import { saveHandles, clearWorkspaceConfig } from '../../cache/idbCache'
import type { Ref } from 'vue'
import type { DataSet, ImageFile, ParsedAnnotation } from '../../types'
import type { CanonicalDataset } from '../../dataset/types'
import type { DatasetMeta } from '../../workspace/workspaceStore'
import type { PaneState } from './types'

/**
 * 加载簇：数据集加载（含分目录/格式覆盖/纠错回路）、加载结果接入全局状态、来源元信息捕获。
 * 与 useViewerState 解耦，仅依赖注入的 datasets / 标注映射 / 窗格相关；applyLoadResult 与
 * captureMeta 同时返回，供 useWorkspace 复用（恢复工作区时仍走同一套接入逻辑）。
 */
export interface LoadingDeps {
  datasets: Ref<DataSet[]>
  datasetAnnotations: Ref<Map<string, Map<string, ParsedAnnotation[]>>>
  categoryColorMap: Ref<Map<string, string>>
  datasetMeta: Ref<Map<string, DatasetMeta>>
  annotationsCache: Map<string, ParsedAnnotation[]>
  urlCacheHelper: { clearUrlCache: () => void }
  panes: Ref<PaneState[]>
  activePane: Ref<string>
  activePaneState: Ref<PaneState>
  MAX_PANES: number
  paneSeq: { n: number }
  createPane: (id: string) => PaneState
}

export function useLoading(deps: LoadingDeps) {
  const {
    datasets, datasetAnnotations, categoryColorMap, datasetMeta, annotationsCache,
    urlCacheHelper, panes, activePane, activePaneState, MAX_PANES, paneSeq, createPane,
  } = deps

  const loading = ref(false)
  const loadingText = ref('加载数据集中...')
  const loadingPct = ref(0)
  const loadingDetail = ref('')

  /**
   * 多任务标注文件选择弹窗状态。当加载的 COCO 目录下存在多个候选标注 json
   * （如 instances / person_keypoints / captions）时，由加载管线回调弹出，
   * 让用户指定用哪一份（可多选叠加）标注文件来预览。
   */
  const annPicker = reactive({
    visible: false,
    candidates: [] as AnnotationCandidate[],
    selected: [] as string[],
    resolve: null as ((v: string[] | null) => void) | null,
  })

  // 注入到加载管线：返回选中路径数组，或 null 表示取消
  const chooseAnnotations: AnnotationChooser = (cands) =>
    new Promise<string[] | null>((resolve) => {
      annPicker.candidates = cands
      // 默认选中优先级最高（检测+分割）的一项
      annPicker.selected = cands.length ? [cands[0].path] : []
      annPicker.resolve = resolve
      annPicker.visible = true
    })
  setAnnotationChooser(chooseAnnotations)

  function confirmAnnPicker() {
    const r = annPicker.resolve
    annPicker.visible = false
    annPicker.resolve = null
    r?.(annPicker.selected.slice())
  }
  function cancelAnnPicker() {
    const r = annPicker.resolve
    annPicker.visible = false
    annPicker.resolve = null
    r?.(null)
  }

  /** 捕获某数据集的来源元信息（路径 / 句柄 / 格式），浏览器端同时落盘句柄 */
  function captureMeta(id: string, sourceFormat: string) {
    const m = peekLoadHandles(id)
    if (!m) return
    const meta: DatasetMeta = { sourceFormat: sourceFormat as DatasetMeta['sourceFormat'] }
    if (m.root) meta.imageRoot = m.root
    if (m.labelRoot) meta.labelRoot = m.labelRoot
    if (m.imageHandle) {
      meta.imageHandle = m.imageHandle
      meta.handleKey = 'h_' + id
    }
    if (m.labelHandle) meta.labelHandle = m.labelHandle
    const next = new Map(datasetMeta.value)
    next.set(id, meta)
    datasetMeta.value = next
    // 浏览器端：把目录句柄持久化进 IDB，供跨会话恢复
    if (env === 'browser' && meta.handleKey && meta.imageHandle) {
      void saveHandles(meta.handleKey, meta.imageHandle, meta.labelHandle ?? null)
    }
  }

  /**
   * 把一次加载结果接入全局状态：
   * - oldId 为 null：作为全新数据集 unshift 进列表；
   * - oldId 非 null（纠错回路）：原地替换该数据集，并把引用它的窗格重新绑定到新数据集。
   */
  function applyLoadResult(oldId: string | null, result: CanonicalLoadResult): DataSet {
    const { dataset, annotations, categoryColors, canonical } = result
    dataset.canonical = canonical

    if (oldId) {
      const idx = datasets.value.findIndex((d) => d.id === oldId)
      if (idx >= 0) datasets.value[idx] = dataset
      datasetAnnotations.value.delete(oldId)
    } else {
      datasets.value.unshift(dataset)
    }

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

    // 纠错替换：把引用旧数据集的窗格重新指向新数据集
    if (oldId) {
      for (const pane of panes.value) {
        if (pane.datasetId.value === oldId) {
          pane.setDataset(dataset.id)
          if (dataset.fileList.length) pane.selectFile(dataset.fileList[0])
        }
      }
    }
    return dataset
  }

  // 加载数据（支持分目录句柄与格式覆盖）
  async function handleLoadDataset(opts?: LoadOptions) {
    // 浏览器端环境隔离：仅 Chromium 支持文件夹选择；不支持的浏览器直接提示，避免静默失败
    if (env === 'browser' && !capabilities.canPickDirectory) {
      ElMessage.warning('当前浏览器不支持文件夹选择，无法加载数据集。请使用 Chrome/Edge，或安装桌面版。')
      return
    }
    try {
      // 新数据集：清空标注缓存，避免与上次加载的同名 file.id 串味；
      // 同时清空 Blob URL 缓存（键为文件对象，旧条目已失效需释放）并回收内存
      annotationsCache.clear()
      urlCacheHelper.clearUrlCache()
      loading.value = true
      loadingText.value = '正在扫描文件...'
      loadingPct.value = 0
      loadingDetail.value = ''

      const result = await loadDatasetCanonical(
        (current, _total, status) => {
          loadingText.value = status
          loadingPct.value = current
          if (status.includes('图片')) {
            loadingDetail.value = status
          }
        },
        opts,
      )
      const dataset = applyLoadResult(null, result)
      // 捕获来源元信息（路径 / 句柄 / 格式），供工作区持久化
      captureMeta(dataset.id, opts?.format ?? '')

      // 窗格绑定规则：
      // 1) 首个空闲窗格（datasetId 为 null）→ 绑定
      // 2) 无空闲且未达上限 → 新增窗格绑定（多窗口对照）
      // 3) 无空闲且已满 → 替换当前焦点窗格的数据集
      const free = panes.value.find((p) => !p.datasetId.value)
      if (free) {
        free.setDataset(dataset.id)
        if (dataset.fileList.length) free.selectFile(dataset.fileList[0])
      } else if (panes.value.length < MAX_PANES) {
        const id = 'p' + paneSeq.n++
        const pane = createPane(id)
        panes.value = [...panes.value, pane]
        pane.setDataset(dataset.id)
        if (dataset.fileList.length) pane.selectFile(dataset.fileList[0])
        activePane.value = id
      } else {
        const target = activePaneState.value
        target.setDataset(dataset.id)
        if (dataset.fileList.length) target.selectFile(dataset.fileList[0])
      }

      const totalAnns = Array.from(result.annotations.values()).reduce((sum, arr) => sum + arr.length, 0)
      if (result.warnings.length) {
        ElMessage.warning(
          `导入提示（${result.warnings.length} 条）：${result.warnings.slice(0, 3).join('，')}${result.warnings.length > 3 ? ' …' : ''}`,
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

  /** 分目录加载：分别选择图片根与标注根（对应看板「独立选择图片和标注文件夹」） */
  async function handleLoadSeparate() {
    if (env === 'browser' && !capabilities.canPickDirectory) {
      ElMessage.warning('当前浏览器不支持文件夹选择，无法分目录加载。请使用 Chrome/Edge，或安装桌面版。')
      return
    }
    try {
      if (env === 'tauri') {
        // 桌面端：用 Tauri 对话框分别选两个绝对路径（零 JS 拷贝，不弹浏览器授权框）
        const imageRoot = await pickDirectoryTauri()
        if (!imageRoot) return
        const labelRoot = await pickDirectoryTauri()
        if (!labelRoot) return
        await handleLoadDataset({ imageRoot, labelRoot })
        return
      }
      const imageHandle = await pickDirectoryBrowser()
      if (!imageHandle) return
      const labelHandle = await pickDirectoryBrowser()
      if (!labelHandle) return
      await handleLoadDataset({ imageHandle, labelHandle })
    } catch (e: any) {
      if (e.message !== '用户取消选择') {
        ElMessage.error('分目录加载失败：' + e.message)
      }
    }
  }

  /**
   * 纠错回路：对当前焦点窗格的数据集，以指定格式复用同一批目录句柄重新导入。
   * 解决「自动识别不准时手动改格式并立即生效」的闭环。
   */
  async function reloadActiveWithFormat(format: CanonicalDataset['sourceFormat']) {
    const dsId = activePaneState.value.datasetId.value
    if (!dsId) {
      ElMessage.warning('请先加载并选择数据集')
      return
    }
    try {
      loading.value = true
      loadingText.value = `正在以 ${format} 重新识别...`
      loadingPct.value = 0
      const result = await reimportDataset(dsId, format, (c) => {
        loadingPct.value = c
      })
      applyLoadResult(dsId, result)
      ElMessage.success(`已按 ${format} 重新导入：${result.dataset.fileList.length} 张图片`)
    } catch (e: any) {
      ElMessage.error('重新识别失败：' + (e?.message || e))
    } finally {
      loading.value = false
    }
  }

  async function handleAddDataset() {
    await handleLoadDataset()
  }

  /**
   * 关闭一个已加载的数据集：从列表移除并清理其关联状态（标注兜底表 / 来源元信息 /
   * 标注缓存 / 引用窗格 / Blob URL / 目录句柄记录）。由于数据集变化会触发工作区配置
   * 自动保存（wsSignature watch），关闭即持久化——下次启动 autoRestore 只恢复剩余数据集，
   * 不再瞬间复原被关闭的数据集。全部关闭时清空已保存工作区配置，使下次启动无数据集可恢复。
   */
  function closeDataset(id: string) {
    const idx = datasets.value.findIndex((d) => d.id === id)
    if (idx < 0) return
    const name = datasets.value[idx].name
    datasets.value = datasets.value.filter((d) => d.id !== id)

    // 标注兜底表 / 来源元信息
    datasetAnnotations.value.delete(id)
    const meta = new Map(datasetMeta.value)
    meta.delete(id)
    datasetMeta.value = meta

    // 标注缓存按 `ownerId:fileId` 作用域隔离，清理该数据集的条目
    for (const k of Array.from(annotationsCache.keys())) {
      if (k.startsWith(id + ':')) annotationsCache.delete(k)
    }

    // 解绑引用该数据集的窗格；若焦点窗格变空且有剩余数据集，则绑到第一个
    for (const pane of panes.value) {
      if (pane.datasetId.value === id) pane.setDataset(null)
    }
    if (!activePaneState.value.dataset.value && datasets.value.length > 0) {
      const first = datasets.value[0]
      activePaneState.value.setDataset(first.id)
      if (first.fileList.length) activePaneState.value.selectFile(first.fileList[0])
    }

    // 释放 Blob URL 缓存（与加载行为一致，键为文件对象）
    urlCacheHelper.clearUrlCache()
    // 释放目录句柄记录
    forgetLoadHandles(id)

    if (datasets.value.length === 0) {
      // 全部关闭：清空已保存工作区，避免下次启动又复原
      void clearWorkspaceConfig()
    }
    ElMessage.success(`已关闭数据集：${name}`)
  }

  return {
    loading, loadingText, loadingPct, loadingDetail,
    handleLoadDataset, handleAddDataset, handleLoadSeparate, reloadActiveWithFormat,
    applyLoadResult, captureMeta, closeDataset,
    annPicker, confirmAnnPicker, cancelAnnPicker,
  }
}
