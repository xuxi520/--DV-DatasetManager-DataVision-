/**
 * 文件操作分发层
 * 浏览器：只能读取已加载到内存的 blob，且【不能真正删除文件】，只能下载清单/脚本。
 * Tauri ：通过 Rust 命令直接读取本地文件、并可将文件移入回收站目录（可逆删除）。
 * 以此实现「双端统一核心逻辑，判断环境分发文件读写」。
 */
import { env } from '../env'
import type { ImageFile } from '../types'

/** 读取文件字节（环境分发） */
export async function getFileBytes(file: ImageFile): Promise<Uint8Array> {
  if (env === 'browser') {
    if (!file.blob) throw new Error('缺少文件数据: ' + file.path)
    return new Uint8Array(await file.blob.arrayBuffer())
  }
  // Tauri：通过 Rust 命令直接读取本地文件
  const { invoke } = await import('@tauri-apps/api/core')
  const arr = await invoke<number[]>('read_file_bytes', { path: file.path })
  return Uint8Array.from(arr)
}

export interface DeleteResult {
  removed: string[]
  error?: string
  /** 'browser' 表示当前环境无法真正删除，应改用清单 */
  mode: 'tauri' | 'browser'
}

/**
 * 删除（移动至回收站目录）一批文件。
 * 浏览器环境无法删除，返回 mode='browser' 由上层改下载清单。
 */
export async function deleteFiles(paths: string[]): Promise<DeleteResult> {
  if (env === 'browser') {
    return { removed: [], mode: 'browser' }
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const removed = await invoke<string[]>('remove_duplicate_files', { paths })
    return { removed, mode: 'tauri' }
  } catch (e: any) {
    return { removed: [], error: e?.message || String(e), mode: 'tauri' }
  }
}
