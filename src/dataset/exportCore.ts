/**
 * 导出打包公共核心：把原本散落在 exportBrowser.ts / augment/export.ts 的
 * 「ZIP 打包」与「Tauri 批量落盘」逻辑收敛到一处，统一复用。
 *
 * 导出序列化层（exporters/*、annotationIO.buildSaveFiles）早已共享；
 * 本模块补齐「打包/落盘」层的共享原语，让数据集导出、训练工程导出、
 * 增强导出三条路径共用同一套实现，避免重复与漏改（如图片 STORE 优化）。
 */

import JSZip from 'jszip'
import { invoke } from '@tauri-apps/api/core'
import { saveFile } from '../fileSave'

export interface PackFile {
  path: string
  bytes: Uint8Array
}

/** 图片已被 JPG/PNG 等压缩，ZIP 内重压几乎不掉体积却吃满 CPU，故走 STORE 跳过 DEFLATE */
export function isImagePath(p: string): boolean {
  return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(p)
}

/** 把单个文件加入 ZIP：图片 STORE、文本 DEFLATE，兼顾速度与体积；root 为空则不加前缀 */
export function addToZip(zip: JSZip, path: string, bytes: Uint8Array, root = ''): void {
  const full = root ? `${root}/${path}` : path
  zip.file(full, bytes, { compression: isImagePath(path) ? 'STORE' : 'DEFLATE' })
}

/**
 * 把一组文件打包为 ZIP Blob（图片 STORE、文本 DEFLATE）。
 * @param root  统一前缀目录；为空则不嵌套。
 * @param onProgress 可选压缩进度回调（0~100）。
 */
export async function packZip(
  files: PackFile[],
  root = '',
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  const zip = new JSZip()
  for (const f of files) addToZip(zip, f.path, f.bytes, root)
  return zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    onProgress ? (meta) => onProgress(meta.percent) : undefined,
  )
}

/** 触发 ZIP 下载（Tauri 端弹保存对话框，浏览器端直接下载） */
export async function downloadZip(blob: Blob, filename: string): Promise<void> {
  await saveFile(filename, blob, {
    title: '保存导出 ZIP',
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })
}

/**
 * 批量写文件到 Tauri 所选目录（一次 IPC 替代 N 次往返）。
 * 图片字节直接以 Uint8Array 传递（Tauri v2 二进制载荷），避免前端
 * Array.from 的逐字节序列化开销。
 */
export async function writeFilesBatchTauri(
  baseDir: string,
  files: { rel: string; bytes: Uint8Array }[],
): Promise<void> {
  const paths: string[] = []
  const contents: Uint8Array[] = []
  for (const f of files) {
    paths.push(`${baseDir}/${f.rel}`)
    contents.push(f.bytes)
  }
  await invoke('write_files_batch', { paths, contents })
}
