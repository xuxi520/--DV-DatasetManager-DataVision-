/**
 * 文件操作分发层
 * 浏览器：只能读取已加载到内存的 blob，且【不能真正删除文件】，只能下载清单/脚本。
 * Tauri ：通过 Rust 命令直接读取本地文件、并可将文件移入回收站目录（可逆删除）。
 * 以此实现「双端统一核心逻辑，判断环境分发文件读写」。
 */
import { env } from '../env'
import type { ImageFile } from '../types'
import type { DatasetFormat } from '../dataset/types'

/** 读取文件字节（环境分发） */
export async function getFileBytes(file: ImageFile): Promise<Uint8Array> {
  if (env === 'browser') {
    if (file.blob) return new Uint8Array(await file.blob.arrayBuffer())
    if (file.sourceFile) return new Uint8Array(await file.sourceFile.arrayBuffer())
    throw new Error('缺少文件数据: ' + file.path)
  }
  // Tauri：通过 Rust 命令直接读取本地文件（absPath 为磁盘绝对路径）
  const { invoke } = await import('@tauri-apps/api/core')
  const arr = await invoke<number[]>('read_file_bytes', { path: file.absPath ?? file.path })
  return Uint8Array.from(arr)
}

/** base64 字符串 -> Uint8Array（用于解析 Rust 批量读返回的 base64） */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * 批量读取文件字节（环境分发），一次性 IPC 取回多张图，消除逐图 read_file_bytes 的
 * N 次串行往返（去重 / 导出共用）。返回 id -> 字节 的映射，读取失败的项自动跳过。
 * Tauri 走 `read_files_bytes`（base64 批量）；浏览器并发读内存 blob。
 */
export async function getFileBytesBatch(
  files: ImageFile[],
  chunk = 32,
): Promise<Map<string, Uint8Array>> {
  const map = new Map<string, Uint8Array>()

  if (env === 'browser') {
    const arr = await Promise.all(
      files.map((f) =>
        getFileBytes(f).catch(() => null as Uint8Array | null),
      ),
    )
    files.forEach((f, i) => {
      if (arr[i]) map.set(f.id, arr[i]!)
    })
    return map
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    for (let s = 0; s < files.length; s += chunk) {
      const slice = files.slice(s, s + chunk)
      const b64list = await invoke<string[]>('read_files_bytes', {
        paths: slice.map((f) => f.absPath ?? f.path),
      })
      slice.forEach((f, i) => {
        const b = b64list[i]
        if (b) map.set(f.id, base64ToBytes(b))
      })
    }
  } catch {
    // 回退：逐张读取，保证健壮性
    for (const f of files) {
      try {
        map.set(f.id, await getFileBytes(f))
      } catch {
        /* 忽略失败项 */
      }
    }
  }
  return map
}

/**
 * 按绝对路径批量读取字节（环境分发），key 为传入的 path（与输入一一对应）。
 * 浏览器端无本地路径概念，返回空映射（调用方应回退到样本自身的 getBytes）。
 * Tauri 走 `read_files_bytes`（base64 批量，分块），消除逐图 IPC 往返。
 */
export async function readPathsBytes(
  paths: string[],
  chunk = 32,
): Promise<Map<string, Uint8Array>> {
  const map = new Map<string, Uint8Array>()
  if (env === 'browser' || paths.length === 0) return map
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    for (let s = 0; s < paths.length; s += chunk) {
      const slice = paths.slice(s, s + chunk)
      const b64list = await invoke<string[]>('read_files_bytes', { paths: slice })
      slice.forEach((p, i) => {
        const b = b64list[i]
        if (b) map.set(p, base64ToBytes(b))
      })
    }
  } catch {
    /* 失败返回已读取部分，调用方对缺失项回退 getBytes */
  }
  return map
}

export interface DeleteResult {
  removed: string[]
  error?: string
  /** 'browser' 表示当前环境无法真正删除，应改用清单 */
  mode: 'tauri' | 'browser'
}

/**
 * 由图片相对路径推算其标注文件路径（按格式约定）。
 * 可能返回多个候选（含回退路径），不存在的会被后端跳过，因此多给候选无害。
 * - yolo：images/<split>/x.jpg -> labels/<split>/x.txt（回退：同目录 x.txt）
 * - voc ：JPEGImages/x.jpg -> Annotations/x.xml（回退：同目录 x.xml）
 * - labelme：同目录 x.json
 * - coco / folder：无逐文件标注，返回空（COCO 标注内嵌于单一 json，不在本函数范围）
 */
export function deriveAnnotationPaths(imagePath: string, format: DatasetFormat): string[] {
  const segs = imagePath.split('/')
  const name = segs[segs.length - 1] || ''
  const dot = name.lastIndexOf('.')
  const stem = dot >= 0 ? name.slice(0, dot) : name
  const dir = segs.slice(0, -1)
  const sameDir = (ext: string) => [...dir, stem + ext].join('/')
  const out: string[] = []

  if (format === 'yolo') {
    const relabeled = imagePath.replace(/(^|\/)images(\/|$)/i, '$1labels$2')
    if (relabeled !== imagePath) out.push(relabeled.replace(/\.[^./\\]+$/, '.txt'))
    out.push(sameDir('.txt'))
  } else if (format === 'voc') {
    const reanno = imagePath
      .replace(/(^|\/)JPEGImages(\/|$)/i, '$1Annotations$2')
      .replace(/(^|\/)images(\/|$)/i, '$1Annotations$2')
    if (reanno !== imagePath) out.push(reanno.replace(/\.[^./\\]+$/, '.xml'))
    out.push(sameDir('.xml'))
  } else if (format === 'labelme') {
    out.push(sameDir('.json'))
  }
  // coco / folder：无逐文件标注
  return Array.from(new Set(out))
}

/** 把相对路径拼到绝对根目录（Tauri 端把 sourcePath 还原为磁盘绝对路径做读/删） */
export function absJoin(root: string, rel: string): string {
  return (root.endsWith('/') ? root : root + '/') + rel
}

/**
 * 删除（移动至回收站目录）一批文件，并按格式同步删除每张图片对应的标注文件。
 * 浏览器环境无法删除，返回 mode='browser' 由上层改下载清单。
 * Tauri 端：root 为数据集根目录绝对路径，会把相对 sourcePath 还原为绝对路径再删（直接落盘，无复制）。
 */
export async function deleteFiles(
  paths: string[],
  format?: DatasetFormat,
  root?: string,
  labelRoot?: string,
  annotationFiles?: string[],
): Promise<DeleteResult> {
  if (env === 'browser') {
    return { removed: [], mode: 'browser' }
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    let all = paths
    if (format && format !== 'unknown' && root) {
      const set = new Set(paths.map((p) => absJoin(root, p)))
      for (const p of paths) {
        // 分目录时标注根与图片根不同，标注按 labelRoot 定位
        for (const d of deriveAnnotationPaths(p, format)) {
          set.add(labelRoot ? absJoin(labelRoot, d) : absJoin(root, d))
        }
      }
      all = [...set]
    } else if (format && format !== 'unknown') {
      all = [...paths, ...paths.flatMap((p) => deriveAnnotationPaths(p, format))]
    }
    const removed = await invoke<string[]>('remove_duplicate_files', { paths: all })

    // COCO：单文件 JSON 标注需条目级摘除（图片已移入回收站，这里从 JSON 摘掉对应 image + 其 annotations 并备份）
    if (format === 'coco' && annotationFiles && annotationFiles.length > 0) {
      try {
        for (const jf of annotationFiles) {
          const abs = root ? absJoin(labelRoot ?? root, jf) : jf
          await invoke('rewrite_coco_json', { jsonPath: abs, removeFileNames: paths })
        }
      } catch (e: any) {
        return {
          removed,
          mode: 'tauri',
          error: 'COCO 标注 JSON 同步删除失败：' + (e?.message || String(e)),
        }
      }
    }
    return { removed, mode: 'tauri' }
  } catch (e: any) {
    return { removed: [], error: e?.message || String(e), mode: 'tauri' }
  }
}

/**
 * 直接删除（不可逆）：删除单张图片并同步删除其标注文件。
 * 与 deleteFiles（移入回收站，可逆）不同，本函数走 delete_files 真正删除，
 * 适用于「删除图片即删除标注」这类需要彻底清理的场景。
 */
export async function deleteImageWithAnnotation(
  imagePath: string,
  format: DatasetFormat,
  root?: string,
  labelRoot?: string,
): Promise<DeleteResult> {
  if (env === 'browser') {
    return { removed: [], mode: 'browser' }
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const anns = deriveAnnotationPaths(imagePath, format)
    const all =
      root
        ? [absJoin(root, imagePath), ...anns.map((d) => absJoin(labelRoot ?? root, d))]
        : [imagePath, ...anns]
    const removed = await invoke<string[]>('delete_files', { paths: all })
    return { removed, mode: 'tauri' }
  } catch (e: any) {
    return { removed: [], error: e?.message || String(e), mode: 'tauri' }
  }
}
