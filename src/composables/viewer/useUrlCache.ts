// Blob URL 全局 LRU（容量 6）：左右窗格同时显示不同图也不会互相释放。
// 从 useViewerState 抽出为独立模块。
// 注意：缓存键必须是「文件对象本身」而非 file.id。两个数据集可能含同名相对路径
//（file.id 由路径生成），若按 id 作键会命中另一数据集同 id 的失效/错误 URL，
// 导致对比加载新数据集时画布黑屏。用对象引用作键可天然区分不同数据集的同一 id。
import { env } from '../../env'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { ImageFile } from '../../types'

export interface UrlCacheEntry {
  url: string
  file: ImageFile
  last: number
}

export function createUrlCache() {
  const urlCache = new Map<ImageFile, UrlCacheEntry>()
  let urlSeq = 0
  const URL_CAPACITY = 6

  function ensureUrl(file: ImageFile): string | undefined {
    const existing = urlCache.get(file)
    if (existing) {
      existing.last = ++urlSeq
      return existing.url
    }
    let url: string | undefined
    if (env === 'tauri') {
      // Tauri：asset 协议——webview 直接从磁盘读图，零 JS 字节缓冲（真正的直读无复制）
      if (!file.absPath) return file.url
      url = convertFileSrc(file.absPath)
    } else {
      // 浏览器：引擎原生直读 File/Blob，不经过任何 JS 字节缓冲
      if (!file.sourceFile) return file.url
      url = URL.createObjectURL(file.sourceFile)
    }
    if (!url) return file.url
    file.url = url
    urlCache.set(file, { url, file, last: ++urlSeq })
    if (urlCache.size > URL_CAPACITY) {
      // 淘汰最久未用（但保留刚创建的这一张）
      let oldestFile: ImageFile | null = null
      let oldest = Infinity
      for (const [f, e] of urlCache) {
        if (e.last < oldest) {
          oldest = e.last
          oldestFile = f
        }
      }
      if (oldestFile && oldestFile !== file) {
        const e = urlCache.get(oldestFile)!
        urlCache.delete(oldestFile)
        // 仅回收 blob: 对象 URL；asset:// 由协议层管理，无需释放
        if (e.url.startsWith('blob:')) URL.revokeObjectURL(e.url)
        e.file.url = undefined
      }
    }
    return url
  }

  /** 清空缓存（加载新数据集 / 恢复工作区时调用）。注意仅清 Map，不逐个 revoke，
   * 与原行为保持一致（淘汰逻辑已在 ensureUrl 内处理）。 */
  function clearUrlCache() {
    urlCache.clear()
  }

  return { urlCache, ensureUrl, clearUrlCache }
}
