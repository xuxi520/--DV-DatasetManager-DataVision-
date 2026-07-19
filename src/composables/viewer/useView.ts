// useView —— 视图模式 / 显示设置 / 共享侧栏 / 键盘导航 glue（独立 composable）
//
// 从 useViewerState 抽出「视图/显示」簇：
// - viewMode / modeLabel / headerCollapsed / showSettings
// - 跨窗格共享的标注/图像显示设置（showAnnotations 等）
// - 共享侧栏（master-detail）的折叠状态与切换
// - 导航切换 onViewModeChange、键盘导航 handleKeydown（居中 glue，复用各切片动作）
//
// 显示设置同时作为 useWorkspace 的依赖（工作区结构配置持久化），故须先于 useWorkspace 组合。
import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import type { ImageFile } from '../../types'
import type { PaneState } from './types'

export interface ViewDeps {
  activePaneState: Ref<PaneState>
  dualPane: Ref<boolean>
  activePane: Ref<string>
  panes: Ref<PaneState[]>
  prevFileAll: () => void
  nextFileAll: () => void
  undo: () => void
  redo: () => void
  deleteAnnotationAt: (file: ImageFile, idx: number) => void
}

export function useView(deps: ViewDeps) {
  const {
    activePaneState, dualPane, activePane, panes,
    prevFileAll, nextFileAll, undo, redo, deleteAnnotationAt,
  } = deps

  // 视图模式 / 折叠：导航只有「数据集预览(single)」与「统计(stats)」两项。
  // 「对照（多窗口对比）」不再是导航项，而是单图浏览内的独立开关 dualPane。
  const viewMode = ref<'single' | 'stats' | 'similarity' | 'dedup' | 'active'>('single')
  const headerCollapsed = ref(false)
  // 共享侧栏（master-detail）：整个工作区只有一份文件列表+标注面板，固定在最左侧，
  // 绑定焦点窗格内容。位置恒定不再随焦点在窗格间「弹出/跳转」，可整体收起/展开，
  // 图像获得全部横向空间。collapse 状态为全局（单一侧栏），不再按窗格隔离。
  const sidebarCollapsed = ref(false)
  const filePanelCollapsed = ref(false)
  const annotationPanelCollapsed = ref(false)
  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }
  function toggleFilePanel() {
    filePanelCollapsed.value = !filePanelCollapsed.value
  }
  function toggleAnnotationPanel() {
    annotationPanelCollapsed.value = !annotationPanelCollapsed.value
  }
  const showSettings = ref(false)
  // 标注/图像显示设置（跨窗格共享）
  const showAnnotations = ref(true)
  const showAnnotationLabels = ref(true)
  const showConfidence = ref(true)
  const autoFit = ref(true)
  const showImageInfo = ref(true)
  const showPredictions = ref(false)
  const showAnnotationList = ref(true)

  // 底部状态栏显示的模式文案
  const modeLabel = computed(() => {
    if (viewMode.value === 'stats') return '统计'
    if (viewMode.value === 'similarity') return '相似'
    if (viewMode.value === 'dedup') return '去重'
    return dualPane.value ? '对照' : '单图'
  })

  // 导航切换：仅在「数据集预览」与「统计」之间。对照是单图内的独立开关，
  // 不随导航改变；从统计切回单图时若原本开着对照则保持，否则焦点归左。
  function onViewModeChange() {
    if (viewMode.value === 'stats') return
    if (!dualPane.value) activePane.value = panes.value[0].id
  }

  // 键盘导航：作用于当前焦点窗格；在输入框/下拉中打字时不劫持方向键。
  // 与底部按钮一致：←/→ 切换所有窗格（联动模式下按文件名对齐）。
  function handleKeydown(e: KeyboardEvent) {
    const el = document.activeElement as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
      return
    }
    // 撤销 / 重做：Ctrl+Z 撤销，Ctrl+Y 或 Ctrl+Shift+Z 重做（Mac 用 ⌘）
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault()
      redo()
      return
    }
    if (e.key === 'ArrowLeft') {
      prevFileAll()
    } else if (e.key === 'ArrowRight') {
      nextFileAll()
    } else if (e.key === 'Delete') {
      // 删除当前选中的标注（清洗台）
      const pane = activePaneState.value
      const file = pane.selectedFile.value
      const idx = pane.selectedAnnotationIndex.value
      if (file && idx >= 0) {
        deleteAnnotationAt(file, idx)
        const remain = pane.currentAnnotations.value.length
        pane.selectedAnnotationIndex.value = remain > 0 ? Math.min(idx, remain - 1) : -1
      }
    }
  }

  return {
    // 视图 / 折叠
    viewMode, headerCollapsed, showSettings,
    // 共享侧栏（master-detail）
    sidebarCollapsed, filePanelCollapsed, annotationPanelCollapsed,
    toggleSidebar, toggleFilePanel, toggleAnnotationPanel,
    // 标注/图像显示设置（跨窗格共享）
    showAnnotations, showAnnotationLabels, showConfidence, autoFit, showImageInfo, showPredictions, showAnnotationList,
    // 派生 / 动作
    modeLabel, onViewModeChange, handleKeydown,
  }
}
