/**
 * 拖拽文件夹加载数据集（双端）。
 *
 * - Tauri：webview 默认拦截系统文件拖放，浏览器 drop 事件拿不到路径，
 *   必须监听 `getCurrentWebview().onDragDropEvent`，drop 时取绝对路径。
 * - 浏览器：用 HTML5 拖放事件，drop 时对 `DataTransferItem.getAsFileSystemHandle()`
 *   取目录句柄（Chromium 支持），复用与「选择文件夹」完全一致的加载管线。
 *
 * 落点统一转成 `LoadOptions` 形状交给回调（`{ imageHandle }` / `{ imageRoot }`），
 * 由调用方复用 `handleLoadDataset`，无需新增导入分支。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { env } from '../env'

export interface DroppedFolder {
  imageHandle?: FileSystemDirectoryHandle
  imageRoot?: string
}

export function useFolderDrop(onFolder: (opts: DroppedFolder) => void) {
  const dragOver = ref(false)
  let unlisten: (() => void) | null = null
  let enterCount = 0

  // ---------- 浏览器分支 ----------
  function isFileDrag(e: DragEvent): boolean {
    const types = e.dataTransfer?.types
    return !!types && Array.from(types).includes('Files')
  }
  function onDragEnter(e: DragEvent) {
    if (!isFileDrag(e)) return
    e.preventDefault()
    enterCount++
    dragOver.value = true
  }
  function onDragOver(e: DragEvent) {
    if (!isFileDrag(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }
  function onDragLeave(e: DragEvent) {
    if (!isFileDrag(e)) return
    e.preventDefault()
    enterCount = Math.max(0, enterCount - 1)
    if (enterCount === 0) dragOver.value = false
  }
  async function onDrop(e: DragEvent) {
    if (!isFileDrag(e)) return
    e.preventDefault()
    enterCount = 0
    dragOver.value = false
    const items = e.dataTransfer?.items
    if (!items || items.length === 0) return
    for (const it of Array.from(items)) {
      if (it.kind !== 'file') continue
      const anyIt = it as DataTransferItem & {
        getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
      }
      if (typeof anyIt.getAsFileSystemHandle === 'function') {
        try {
          const handle = await anyIt.getAsFileSystemHandle()
          if (handle && handle.kind === 'directory') {
            onFolder({ imageHandle: handle as FileSystemDirectoryHandle })
            return
          }
        } catch {
          // 忽略单个条目失败，尝试下一个
        }
      }
    }
    ElMessage.warning('请拖入数据集文件夹（当前浏览器不支持或拖入的是单个文件）')
  }

  // ---------- Tauri 分支 ----------
  async function setupTauri() {
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview')
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload as { type: string; paths?: string[] }
        if (p.type === 'over' || p.type === 'enter') {
          dragOver.value = true
        } else if (p.type === 'leave') {
          dragOver.value = false
        } else if (p.type === 'drop') {
          dragOver.value = false
          const paths = p.paths
          if (paths && paths.length > 0) {
            onFolder({ imageRoot: paths[0] })
          }
        }
      })
    } catch (err) {
      console.warn('[folder-drop] Tauri 拖放监听注册失败', err)
    }
  }

  onMounted(() => {
    if (env === 'tauri') {
      void setupTauri()
    } else {
      window.addEventListener('dragenter', onDragEnter)
      window.addEventListener('dragover', onDragOver)
      window.addEventListener('dragleave', onDragLeave)
      window.addEventListener('drop', onDrop)
    }
  })

  onUnmounted(() => {
    if (unlisten) {
      unlisten()
      unlisten = null
    }
    if (env === 'browser') {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  })

  return { dragOver }
}
