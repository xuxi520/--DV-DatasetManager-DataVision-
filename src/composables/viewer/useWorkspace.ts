import { ref, watch, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  reloadDatasetFromPaths, reloadDatasetFromHandles, recordLoadHandles, peekLoadHandles,
} from '../../dataset/loadCanonical'
import {
  loadHandles, saveHandles, saveWorkspaceConfig,
  loadWorkspaceConfig, clearWorkspaceConfig,
} from '../../cache/idbCache'
import { env } from '../../env'
import type { Ref } from 'vue'
import type { DataSet, ParsedAnnotation } from '../../types'
import type { DatasetMeta, WorkspaceConfig, WsDataset } from '../../workspace/workspaceStore'
import type { CanonicalLoadResult } from '../../dataset/loadCanonical'
import type { PaneState } from './types'

/**
 * 工作区簇：结构配置（数据集 / 窗格 / 视图 / 显示设置）的序列化、持久化、恢复与清空。
 * 与 useViewerState 解耦，仅依赖注入的 datasets / 显示与侧栏 ref / 窗格动作 / applyLoadResult 等；
 * 自动保存（防抖）也在此处，依赖注入的全部签名 ref。
 */
export interface WorkspaceDeps {
  datasets: Ref<DataSet[]>
  datasetMeta: Ref<Map<string, DatasetMeta>>
  annotationsCache: Map<string, ParsedAnnotation[]>
  urlCacheHelper: { clearUrlCache: () => void }
  panes: Ref<PaneState[]>
  activePane: Ref<string>
  viewMode: Ref<string>
  headerCollapsed: Ref<boolean>
  sidebarCollapsed: Ref<boolean>
  filePanelCollapsed: Ref<boolean>
  annotationPanelCollapsed: Ref<boolean>
  syncByFilename: Ref<boolean>
  showAnnotations: Ref<boolean>
  showAnnotationLabels: Ref<boolean>
  showConfidence: Ref<boolean>
  autoFit: Ref<boolean>
  showImageInfo: Ref<boolean>
  showAnnotationList: Ref<boolean>
  addPane: () => void
  closePane: (id: string) => void
  MAX_PANES: number
  applyLoadResult: (oldId: string | null, result: CanonicalLoadResult) => DataSet
  captureMeta: (id: string, sourceFormat: string) => void
  loading: Ref<boolean>
  loadingText: Ref<string>
  loadingPct: Ref<number>
  loadingDetail: Ref<string>
}

export function useWorkspace(deps: WorkspaceDeps) {
  const {
    datasets, datasetMeta, annotationsCache, urlCacheHelper, panes, activePane,
    viewMode, headerCollapsed, sidebarCollapsed, filePanelCollapsed, annotationPanelCollapsed,
    syncByFilename, showAnnotations, showAnnotationLabels, showConfidence, autoFit, showImageInfo, showAnnotationList,
    addPane, closePane, MAX_PANES, applyLoadResult, captureMeta,
    loading, loadingText, loadingPct, loadingDetail,
  } = deps

  const workspaceBusy = ref(false)
  /** 启动是否提示恢复上次工作区（而非静默自动恢复），localStorage 持久化 */
  const AUTO_RESTORE_KEY = 'dv.workspace.autoRestore'
  const autoRestore = ref<boolean>(localStorage.getItem(AUTO_RESTORE_KEY) !== 'false')
  function setAutoRestore(v: boolean) {
    autoRestore.value = v
    localStorage.setItem(AUTO_RESTORE_KEY, v ? 'true' : 'false')
  }
  // 视图层（如设置开关）直接改 autoRestore 时也同步落地 localStorage
  watch(autoRestore, (v) => {
    localStorage.setItem(AUTO_RESTORE_KEY, v ? 'true' : 'false')
  })

  /** 由当前运行时状态构建可序列化的工作区配置 */
  function buildWorkspaceConfig(): WorkspaceConfig {
    const datasetsCfg: WsDataset[] = datasets.value.map((d) => {
      const m = datasetMeta.value.get(d.id)
      const entry: WsDataset = {
        id: d.id,
        name: d.name,
        env,
        sourceFormat: m?.sourceFormat ?? '',
      }
      if (env === 'tauri') {
        if (m?.imageRoot) entry.imageRoot = m.imageRoot
        if (m?.labelRoot) entry.labelRoot = m.labelRoot
      } else if (m?.handleKey) {
        entry.handleKey = m.handleKey
      }
      return entry
    })
    return {
      schemaVersion: 1,
      datasets: datasetsCfg,
      panes: panes.value.map((p) => ({ id: p.id, datasetId: p.datasetId.value ?? '', selectedFile: p.selectedFile.value?.name ?? null })),
      activePane: activePane.value,
      viewMode: viewMode.value as WorkspaceConfig['viewMode'],
      headerCollapsed: headerCollapsed.value,
      sidebarCollapsed: sidebarCollapsed.value,
      filePanelCollapsed: filePanelCollapsed.value,
      annotationPanelCollapsed: annotationPanelCollapsed.value,
      syncByFilename: syncByFilename.value,
      display: {
        showAnnotations: showAnnotations.value,
        showAnnotationLabels: showAnnotationLabels.value,
        showConfidence: showConfidence.value,
        autoFit: autoFit.value,
        showImageInfo: showImageInfo.value,
        showAnnotationList: showAnnotationList.value,
      },
    }
  }

  /** 保存当前工作区结构到 IDB（浏览器同时保证句柄已落盘） */
  async function saveWorkspaceNow(quiet = false): Promise<void> {
    try {
      // 浏览器：确保各数据集句柄都已持久化
      if (env === 'browser') {
        for (const m of datasetMeta.value.values()) {
          if (m.handleKey && m.imageHandle) {
            await saveHandles(m.handleKey, m.imageHandle, m.labelHandle ?? null)
          }
        }
      }
      await saveWorkspaceConfig(buildWorkspaceConfig())
      if (!quiet) ElMessage.success('工作区已保存')
    } catch (e: any) {
      if (!quiet) ElMessage.error('保存工作区失败：' + (e?.message || e))
    }
  }

  /** 恢复工作区：重建数据集 + 重绑窗格 + 还原视图/显示设置 */
  async function restoreWorkspace(silentIfEmpty = false): Promise<void> {
    if (workspaceBusy.value) return
    workspaceBusy.value = true
    loading.value = true
    loadingText.value = '正在恢复工作区...'
    loadingPct.value = 0
    loadingDetail.value = ''
    const warnings: string[] = []
    try {
      const cfg = await loadWorkspaceConfig()
      if (!cfg || cfg.datasets.length === 0) {
        if (!silentIfEmpty) ElMessage.info('没有可恢复的工作区')
        return
      }
      annotationsCache.clear()
      urlCacheHelper.clearUrlCache()
      const idMap = new Map<string, string>() // 旧 id -> 新 id
      const total = cfg.datasets.length
      for (let i = 0; i < total; i++) {
        const e = cfg.datasets[i]
        loadingPct.value = Math.round((i / total) * 90)
        loadingText.value = `正在恢复 ${e.name} (${i + 1}/${total})`
        try {
          let result: CanonicalLoadResult
          if (e.env === 'tauri' && e.imageRoot) {
            result = await reloadDatasetFromPaths({
              imageRoot: e.imageRoot,
              labelRoot: e.labelRoot,
              formatOverride: e.sourceFormat || undefined,
              onProgress: (c, _t, s) => { loadingDetail.value = s },
            })
          } else if (e.handleKey) {
            const h = await loadHandles(e.handleKey)
            if (!h?.imageHandle) throw new Error('目录句柄已丢失，请在浏览器重新授权')
            const perm = (h.imageHandle as any).requestPermission
              ? await (h.imageHandle as any).requestPermission({ mode: 'read' })
              : 'granted'
            if (perm !== 'granted') throw new Error('未获得目录读权限，已跳过')
            result = await reloadDatasetFromHandles({
              imageHandle: h.imageHandle,
              labelHandle: h.labelHandle,
              formatOverride: e.sourceFormat || undefined,
              onProgress: (c, _t, s) => { loadingDetail.value = s },
            })
          } else {
            throw new Error('缺少路径或目录句柄')
          }
          const newDs = applyLoadResult(null, result)
          idMap.set(e.id, newDs.id)
          const meta: DatasetMeta = { sourceFormat: e.sourceFormat }
          if (e.imageRoot) { meta.imageRoot = e.imageRoot; meta.labelRoot = e.labelRoot }
          if (e.handleKey) {
            const h = await loadHandles(e.handleKey)
            if (h) { meta.handleKey = e.handleKey; meta.imageHandle = h.imageHandle; meta.labelHandle = h.labelHandle }
          }
          const next = new Map(datasetMeta.value)
          next.set(newDs.id, meta)
          datasetMeta.value = next
          // 重建 lastLoadHandles，使纠错回路（reloadActiveWithFormat）在恢复后仍可用
          const handles = next.get(newDs.id)!
          recordLoadHandles(newDs.id, {
            imageHandle: handles.imageHandle ?? null,
            labelHandle: handles.labelHandle ?? null,
            root: handles.imageRoot,
            labelRoot: handles.labelRoot,
          })
        } catch (err: any) {
          warnings.push(`${e.name}：${err?.message || err}`)
        }
      }

      if (datasets.value.length === 0) {
        ElMessage.warning('工作区恢复失败：所有数据集均不可用')
        return
      }

      // 按保存顺序重排数据集列表
      const ordered = cfg.datasets
        .map((e) => datasets.value.find((d) => d.id === idMap.get(e.id)))
        .filter((d): d is DataSet => !!d)
      datasets.value = ordered

      // 还原窗格绑定（按需增减窗格）
      const targetCount = Math.min(cfg.panes.length, MAX_PANES)
      while (panes.value.length < targetCount) addPane()
      while (panes.value.length > Math.max(1, targetCount)) {
        closePane(panes.value[panes.value.length - 1].id)
      }
      cfg.panes.forEach((p, i) => {
        const pane = panes.value[i]
        if (!pane) return
        pane.setDataset(idMap.get(p.datasetId) || null)
        // 恢复选中文件，使标注面板随界面一并还原（展开条失效也仍能找回）
        if (p.selectedFile && pane.dataset.value) {
          const f = pane.dataset.value.fileList.find((x) => x.name === p.selectedFile)
          if (f) pane.selectFile(f)
        }
      })
      activePane.value = idMap.get(cfg.activePane) || panes.value[0].id

      // 还原视图与显示设置
      if (cfg.viewMode) viewMode.value = cfg.viewMode as typeof viewMode.value
      headerCollapsed.value = !!cfg.headerCollapsed
      sidebarCollapsed.value = !!cfg.sidebarCollapsed
      filePanelCollapsed.value = !!cfg.filePanelCollapsed
      annotationPanelCollapsed.value = !!cfg.annotationPanelCollapsed
      syncByFilename.value = !!cfg.syncByFilename
      if (cfg.display) {
        showAnnotations.value = cfg.display.showAnnotations
        showAnnotationLabels.value = cfg.display.showAnnotationLabels
        showConfidence.value = cfg.display.showConfidence
        autoFit.value = cfg.display.autoFit
        showImageInfo.value = cfg.display.showImageInfo
        if (typeof cfg.display.showAnnotationList === 'boolean') {
          showAnnotationList.value = cfg.display.showAnnotationList
        }
      }

      loadingPct.value = 100
      loadingText.value = '工作区已恢复'
      if (warnings.length) {
        ElMessage.warning(
          `工作区已恢复（${datasets.value.length} 个数据集）；${warnings.length} 个失败：${warnings.slice(0, 2).join('；')}${warnings.length > 2 ? ' …' : ''}`,
        )
      } else {
        ElMessage.success(`工作区已恢复：${datasets.value.length} 个数据集`)
      }
    } catch (e: any) {
      ElMessage.error('恢复工作区失败：' + (e?.message || e))
    } finally {
      workspaceBusy.value = false
      loading.value = false
    }
  }

  /** 清空已保存的工作区配置与句柄 */
  async function clearWorkspace(): Promise<void> {
    try {
      await clearWorkspaceConfig()
      ElMessage.success('已清除保存的工作区')
    } catch (e: any) {
      ElMessage.error('清除工作区失败：' + (e?.message || e))
    }
  }

  /**
   * 启动恢复确认：若开启了「启动提示恢复」且当前无数据集、且存在已保存的工作区，
   * 弹出对话框询问用户是否恢复。确认则恢复；取消/关闭则保持空白（已保存配置保留，
   * 用户仍可稍后从工作区菜单手动恢复）。取代原先静默自动恢复的行为。
   */
  async function promptRestoreOnStartup(): Promise<void> {
    if (datasets.value.length > 0) return
    if (!autoRestore.value) return
    let cfg: WorkspaceConfig | null = null
    try {
      cfg = await loadWorkspaceConfig()
    } catch {
      return
    }
    if (!cfg || cfg.datasets.length === 0) return
    try {
      await ElMessageBox.confirm(
        `检测到上次保存的工作区（共 ${cfg.datasets.length} 个数据集），是否恢复？\n\n（取消后将保持空白，可稍后从「工作区 ▸ 恢复」手动恢复）`,
        '恢复工作区',
        {
          confirmButtonText: '恢复',
          cancelButtonText: '不恢复',
          type: 'info',
          closeOnClickModal: false,
          closeOnPressEscape: false,
        },
      )
      await restoreWorkspace(true)
    } catch {
      // 用户取消或不恢复：保持空白启动，不自动恢复
    }
  }

  // 自动保存：数据集结构 / 窗格 / 视图 / 设置变化时防抖写盘（仅当有数据集时）
  // 注意：必须放在 activePane / syncByFilename 等所有依赖 ref 声明之后，
  // 否则 watch 立即求值会触发 TDZ（Cannot access 'activePane' before initialization）导致白屏。
  const wsSignature = computed(() => {
    const ds = datasets.value.map((d) => `${d.id}:${d.name}`).join('|')
    const metaKeys = Array.from(datasetMeta.value.keys()).join(',')
    const pn = panes.value.map((p) => `${p.id}=${p.datasetId.value ?? ''}`).join('|')
    return [
      ds, metaKeys, pn, activePane.value, viewMode.value,
      headerCollapsed.value, sidebarCollapsed.value, filePanelCollapsed.value,
      annotationPanelCollapsed.value, syncByFilename.value,
      showAnnotations.value, showAnnotationLabels.value, showConfidence.value,
      autoFit.value, showImageInfo.value, showAnnotationList.value,
    ].join('#')
  })
  let wsSaveTimer: ReturnType<typeof setTimeout> | null = null
  watch(wsSignature, () => {
    if (datasets.value.length === 0) return
    if (wsSaveTimer) clearTimeout(wsSaveTimer)
    wsSaveTimer = setTimeout(() => { void saveWorkspaceNow(true) }, 800)
  })

  return {
    workspaceBusy, autoRestore, setAutoRestore,
    saveWorkspaceNow, restoreWorkspace, clearWorkspace, promptRestoreOnStartup,
  }
}
