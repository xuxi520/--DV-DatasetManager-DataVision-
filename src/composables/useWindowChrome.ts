// 无边框 Tauri 窗口的标题栏交互：拖拽由 CSS `-webkit-app-region` 负责，
// 这里只封装窗口控制（最小/最大/关闭）与边缘缩放。仅桌面端生效，浏览器下全部 no-op。
import { ref, onMounted } from 'vue'

export const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

type WindowEdge =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

// 懒加载 Tauri window API，避免浏览器构建时的任何原生初始化副作用。
let winCache: any = null
async function getWindow(): Promise<any | null> {
  if (!isTauri) return null
  if (!winCache) {
    const m = await import('@tauri-apps/api/window')
    winCache = m.getCurrentWindow()
  }
  return winCache
}

export function useWindowChrome() {
  const isMaximized = ref(false)

  async function refreshMaximized() {
    const w = await getWindow()
    if (!w) return
    try {
      isMaximized.value = await w.isMaximized()
    } catch {
      /* 非 Tauri 或权限不足时静默 */
    }
  }

  onMounted(refreshMaximized)

  async function minimize() {
    const w = await getWindow()
    if (w) await w.minimize()
  }
  async function toggleMaximize() {
    const w = await getWindow()
    if (!w) return
    await w.toggleMaximize()
    refreshMaximized()
  }
  async function close() {
    const w = await getWindow()
    if (w) await w.close()
  }
  async function startDragging() {
    const w = await getWindow()
    if (w) await w.startDragging()
  }
  // HTML 热区用 'top'/'left'/... 这类小写边名，映射到 Tauri 的 ResizeDirection。
  const EDGE_TO_DIR: Record<WindowEdge, string> = {
    top: 'North',
    bottom: 'South',
    left: 'West',
    right: 'East',
    'top-left': 'NorthWest',
    'top-right': 'NorthEast',
    'bottom-left': 'SouthWest',
    'bottom-right': 'SouthEast',
  }
  async function startResize(edge: WindowEdge) {
    const w = await getWindow()
    if (w) await w.startResizeDragging(EDGE_TO_DIR[edge] as any)
  }

  return { isTauri, isMaximized, minimize, toggleMaximize, close, startResize, startDragging }
}
