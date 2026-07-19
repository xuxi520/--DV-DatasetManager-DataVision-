/**
 * 跨端统一「保存文件」入口。
 *
 * - 浏览器：沿用 <a download> Blob 下载（原生支持，弹出浏览器下载条）。
 * - Tauri 桌面端：弹出原生保存对话框让用户选择位置 / 文件名，再经 Rust
 *   `write_binary_file` 命令写盘。
 *
 * 背景：Tauri v2 的 WebView 会**静默丢弃** `blob:` URL 的 `<a download>` 下载，
 * 导致桌面端点「导出 / 下载」毫无反应（不弹窗、不落盘）。统一走本函数即可修复。
 */
import { env } from './env'

export interface SaveFileFilter {
  name: string
  extensions: string[]
}

export interface SaveFileOptions {
  /** 对话框标题 */
  title?: string
  /** 文件类型过滤器（桌面端有效） */
  filters?: SaveFileFilter[]
}

/** 返回 true 表示已保存；false 表示用户取消了保存对话框。 */
export async function saveFile(
  filename: string,
  data: Blob | Uint8Array | string,
  opts?: SaveFileOptions,
): Promise<boolean> {
  if (env === 'browser') {
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  }

  // Tauri：原生保存对话框 + 写盘（避免 WebView 丢弃 blob 下载）
  const { save } = await import('@tauri-apps/plugin-dialog')
  const selected = await save({
    defaultPath: filename,
    title: opts?.title ?? '保存文件',
    filters: opts?.filters,
  })
  if (!selected) return false // 用户取消

  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : data

  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('write_binary_file', { path: selected, contents: Array.from(bytes) })
  return true
}
