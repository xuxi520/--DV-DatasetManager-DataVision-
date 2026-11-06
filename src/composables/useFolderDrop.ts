/**
 * 拖拽文件夹加载数据集（仅浏览器端；Tauri 客户端已移除该拖放加载功能）。
 *
 * 浏览器：用 HTML5 `getAsFileSystemHandle()` 取目录句柄 imageHandle，
 *   复用与「选择文件夹」完全一致的加载管线。
 * Tauri 客户端：原生 HTML5 拖放在 WebView2 下拿不到真实绝对路径
 *   （File.path 被剥离），原生 onDragDropEvent 模式又带 Windows 禁止光标，
 *   体验不佳，故客户端不启用拖放加载。这里仅对外部文件拖放做无害化处理
 *   （preventDefault），避免页面误跳转到被拖入的文件。
 *
 * 落点统一转成 LoadOptions 形状交给回调，由调用方复用 handleLoadDataset。
 *
 * 注意：本 composable 必须单实例（在 App.vue 根组件注册一次即可）。
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

  function isFileDrag(e: DragEvent): boolean {
    const types = e.dataTransfer?.types
    return !!types && Array.from(types).includes('Files')
  }

  // ---------- 浏览器分支：HTML5 拖放，取目录句柄 ----------
  let enterCount = 0
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
    ElMessage.warning('请拖入数据集文件夹（当前环境不支持或拖入的是单个文件）')
  }

  // 客户端：对外部文件拖放无害化处理（防止页面跳转到被拖入文件），不加载。
  function neutralizeDrop(e: DragEvent) {
    if (!isFileDrag(e)) return
    e.preventDefault()
  }

  onMounted(() => {
    if (env === 'tauri') {
      window.addEventListener('dragover', neutralizeDrop)
      window.addEventListener('drop', neutralizeDrop)
    } else {
      window.addEventListener('dragenter', onDragEnter)
      window.addEventListener('dragover', onDragOver)
      window.addEventListener('dragleave', onDragLeave)
      window.addEventListener('drop', onDrop)
    }
  })

  onUnmounted(() => {
    if (env === 'tauri') {
      window.removeEventListener('dragover', neutralizeDrop)
      window.removeEventListener('drop', neutralizeDrop)
    } else {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  })

  return { dragOver }
}
