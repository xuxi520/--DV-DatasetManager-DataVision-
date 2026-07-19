/**
 * 把 ImageFile 解码为 HTMLImageElement（增强预览用）。
 * 复用与运行时一致的环境分支：Tauri 走 asset 协议直读，浏览器走 blob URL。
 */
import type { ImageFile } from '../types'
import { env } from '../env'

function tryLoad(url: string, anonymous: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // 匿名 CORS：允许后续 canvas.getImageData（加噪）读取像素，避免画布被跨域数据污染。
    if (anonymous) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图像解码失败: ' + url))
    img.src = url
  })
}

/**
 * 先以匿名 CORS 加载（像素可读，支持加噪）；若因缺少 CORS 头失败，
 * 回退为普通加载（图像可正常显示，仅加噪会自动降级跳过）。
 */
async function loadImage(url: string): Promise<HTMLImageElement> {
  try {
    return await tryLoad(url, true)
  } catch {
    return tryLoad(url, false)
  }
}

export async function decodeImageFile(file: ImageFile): Promise<HTMLImageElement> {
  if (env === 'tauri') {
    const url = file.absPath ? (await import('@tauri-apps/api/core')).convertFileSrc(file.absPath) : file.url
    if (!url) throw new Error('Tauri 端无可用图像源（缺少 absPath）')
    return loadImage(url)
  }
  // 浏览器：优先复用已生成的 blob URL，否则用原始 File 句柄
  if (file.url) return loadImage(file.url)
  if (file.sourceFile) {
    const url = URL.createObjectURL(file.sourceFile)
    try {
      return await loadImage(url)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  if (file.blob) {
    const url = URL.createObjectURL(file.blob)
    try {
      return await loadImage(url)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  throw new Error('浏览器端无可用图像源（缺少 url / sourceFile / blob）')
}
