/**
 * 环境适配层 - 统一浏览器和Tauri的文件操作API
 * 浏览器：使用 showDirectoryPicker + FileReader
 * 客户端：使用 Tauri FS API
 */
import type { EnvType } from './types'

export const env: EnvType = typeof window !== 'undefined' && '__TAURI__' in window ? 'tauri' : 'browser'

/** 读取文件夹（浏览器版） */
export async function pickDirectoryBrowser(): Promise<FileSystemDirectoryHandle | null> {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('当前浏览器不支持文件夹选择，请使用 Chrome/Edge 最新版')
  }
  try {
    return await (window as any).showDirectoryPicker({ mode: 'read' })
  } catch (e: any) {
    if (e.name === 'AbortError') return null
    throw e
  }
}

/** 递归读取文件夹内容（浏览器版） */
export async function readDirBrowser(
  handle: FileSystemDirectoryHandle,
  prefix: string = ''
): Promise<{ path: string; file: File }[]> {
  const results: { path: string; file: File }[] = []
  
  async function walk(dir: FileSystemDirectoryHandle, path: string) {
    for await (const entry of (dir as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> }).values()) {
      if (entry.kind === 'file') {
        const file = await (entry as FileSystemFileHandle).getFile()
        results.push({ path: path + file.name, file })
      } else if (entry.kind === 'directory') {
        await walk(entry as FileSystemDirectoryHandle, path + entry.name + '/')
      }
    }
  }
  
  await walk(handle, prefix)
  return results
}

/** 读取文件为ArrayBuffer */
export async function readFileAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

/** 读取文件为DataURL */
export async function readFileAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * 从图片字节头部解析宽高，无需解码像素（主线程零开销，超低延迟加载）。
 * 支持 JPEG / PNG / GIF / BMP / WebP(VP8 / VP8X / VP8L)。
 * 返回 null 表示无法识别（如罕见格式），此时由上层回退为 0×0。
 */
export function parseImageSize(buf: Uint8Array): { width: number; height: number } | null {
  if (!buf || buf.length < 16) return null

  // PNG: 89 50 4E 47 ... IHDR@12 -> width@16(4) height@20(4)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    if (buf.length < 24) return null
    return {
      width: (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19],
      height: (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23],
    }
  }

  // JPEG: FF D8 ... 在 SOF0~SOF15（除 C4/C8/CC）处取尺寸
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker === 0xd9 || marker === 0xda) break // EOI / SOS：之后无 SOF
      if (marker >= 0xc0 && marker <= 0xcf &&
          marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (buf[i + 5] << 8) | buf[i + 6]
        const width = (buf[i + 7] << 8) | buf[i + 8]
        return { width, height }
      }
      const len = (buf[i + 2] << 8) | buf[i + 3]
      if (len <= 0) break
      i += 2 + len
    }
    return null
  }

  // GIF: 'GIF' width@6(2) height@8(2)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    if (buf.length < 10) return null
    return { width: buf[6] | (buf[7] << 8), height: buf[8] | (buf[9] << 8) }
  }

  // BMP: 'BM' width@18(4) height@22(4)
  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    if (buf.length < 26) return null
    return {
      width: (buf[18] | (buf[19] << 8) | (buf[20] << 16) | (buf[21] << 24)) >>> 0,
      height: (buf[22] | (buf[23] << 8) | (buf[24] << 16) | (buf[25] << 24)) >>> 0,
    }
  }

  // WEBP: 'RIFF'....'WEBP' + 子格式
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    if (buf.length < 30) return null
    const fourcc = String.fromCharCode(buf[12], buf[13], buf[14], buf[15])
    if (fourcc === 'VP8X') {
      return {
        width: (buf[24] | (buf[23] << 8) | (buf[22] << 16)) + 1,
        height: (buf[27] | (buf[26] << 8) | (buf[25] << 16)) + 1,
      }
    }
    if (fourcc === 'VP8 ') {
      return {
        width: (buf[26] | (buf[27] << 8)) & 0x3fff,
        height: (buf[28] | (buf[29] << 8)) & 0x3fff,
      }
    }
    if (fourcc === 'VP8L') {
      const bits = (buf[21] << 16) | (buf[22] << 8) | buf[23]
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }

  return null
}

/** 获取图片尺寸（整图解码，仅用于单张导出等低频场景） */
export async function getImageDimensions(file: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.width, height: img.height })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取图片尺寸'))
    }
    img.src = url
  })
}
