/**
 * COCO 格式导入器
 *
 * 结构：annotations/instances_train.json + train/*.jpg
 * 标注 bbox 为像素 [x, y, w, h]（左上角），归一化为 [cx, cy, w, h]。
 * categories 的 id 可能非连续，映射到本地连续 classId。
 */
import { ClassRegistry } from '../classRegistry'
import type { CanonicalSample } from '../types'
import {
  VirtualFile,
  normSlash,
  isImagePath,
  ext,
  baseName,
} from './shared'
import { transformCocoData, type RawSample } from './cocoTransform'
import { parseCocoInWorker } from './cocoImportClient'

interface CocoImage {
  id: number
  file_name: string
  width?: number
  height?: number
}
interface CocoAnn {
  image_id: number
  category_id: number
  bbox: number[]
  /** COCO keypoints: 扁平 [x1,y1,v1,...]，x/y 像素，v∈{0,1,2} */
  keypoints?: number[]
  num_keypoints?: number
  /** COCO segmentation：多边形数组 [[x1,y1,...]] 或 RLE 对象 {counts,size} */
  segmentation?: any
  /** COCO iscrowd：1 表示 crowd 区域（用 RLE 表示） */
  iscrowd?: number
  /** COCO captions 条目：仅含 caption 文本，无类别，加载时应跳过 */
  caption?: string
}
interface CocoCat {
  id: number
  name: string
  /** COCO 关键点骨架边（成对索引，1-based） */
  skeleton?: [number, number][]
}

export interface CocoImportOptions {
  /** 若提供，仅处理路径集合内的标注 json（用于多任务标注文件的选择性加载） */
  annotationFilter?: Set<string>
}

/** 超过此尺寸的 COCO json 走 Worker 解析，避免主线程被 JSON.parse（val2017 单份可达 200MB+）卡死 */
const LARGE_JSON_BYTES = 5 * 1024 * 1024

/** 导入 COCO 数据集（images + categories + annotations），支持分割/关键点/旋转框。
 *  巨型标注文件在 Web Worker 中解析，主线程仅做类别合并与图片字节回填，UI 不卡顿。 */
export async function importCoco(
  files: VirtualFile[],
  opts?: CocoImportOptions,
): Promise<{ samples: CanonicalSample[]; registry: ClassRegistry; warnings: string[]; annotationFiles: string[] }> {
  const norm = files.map((f) => ({ ...f, path: normSlash(f.path) }))
  const jsonFiles = norm.filter((f) => ext(f.path).toLowerCase() === '.json')
  const jsonFilesToUse = opts?.annotationFilter
    ? jsonFiles.filter((f) => opts.annotationFilter!.has(f.path))
    : jsonFiles
  const warnings: string[] = []
  // 记录 COCO 标注 JSON 的相对路径（删除图片时据此做条目级摘除）
  const annotationFiles = new Set<string>()

  // 收集图片文件，建立「文件名 -> VirtualFile」映射（解析线程不读图，主线程回填 getBytes）
  const imageFiles = norm.filter((f) => isImagePath(f.path))
  const imageByBase = new Map<string, VirtualFile>()
  for (const f of imageFiles) {
    imageByBase.set(baseName(f.path).toLowerCase(), f)
    // 也以支持子目录形式匹配
    const sub = f.path.toLowerCase()
    if (!imageByBase.has('__' + sub)) imageByBase.set('__' + sub, f)
  }

  type FileResult = {
    rawSamples: RawSample[]
    classes: { id: number; name: string }[]
    warnings: string[]
  }
  const results: FileResult[] = []
  const useWorker = typeof Worker !== 'undefined'

  for (const jf of jsonFilesToUse) {
    annotationFiles.add(jf.path)
    if (useWorker && jf.size !== undefined && jf.size > LARGE_JSON_BYTES) {
      // 巨型文件：主线程仅异步读取文本（不阻塞），JSON.parse 这一 CPU 重活交给 Worker
      try {
        const text = await jf.getText()
        const res = await parseCocoInWorker(jf.path, text)
        results.push({
          rawSamples: res.samples ?? [],
          classes: res.classes ?? [],
          warnings: res.warnings ?? [],
        })
      } catch (e) {
        warnings.push(`无法在 Worker 中解析 COCO json: ${jf.path} (${String(e)})`)
      }
    } else {
      // 小文件：主线程直接解析（快，无需 Worker 开销）
      let data: any
      try {
        data = JSON.parse(await jf.getText())
      } catch {
        warnings.push(`无法解析 COCO json: ${jf.path}`)
        continue
      }
      const localReg = new ClassRegistry()
      const r = transformCocoData(data, jf.path, localReg)
      results.push({
        rawSamples: r.samples,
        classes: localReg.classes.map((c) => ({ id: c.id, name: c.name })),
        warnings: r.warnings,
      })
    }
  }

  // 合并多份标注文件：按类别名统一到主 registry，并重映射 annotation.classId，
  // 再回填 getBytes（图片字节始终留在主线程的 VirtualFile 上）。
  const registry = new ClassRegistry()
  const samples: CanonicalSample[] = []
  for (const r of results) {
    const localToName = new Map<number, string>()
    for (const c of r.classes) localToName.set(c.id, c.name)
    const nameToGlobal = new Map<string, number>()
    for (const c of r.classes) nameToGlobal.set(c.name, registry.add(c.name))
    for (const raw of r.rawSamples) {
      const anns = raw.annotations.map((a) => {
        const name = localToName.get(a.classId)
        const gid = name !== undefined ? nameToGlobal.get(name) : undefined
        return gid !== undefined ? { ...a, classId: gid } : a
      })
      const vf =
        imageByBase.get(baseName(raw.sourcePath).toLowerCase()) ||
        imageByBase.get('__' + normSlash(raw.sourcePath).toLowerCase())
      samples.push({
        ...raw,
        annotations: anns,
        getBytes: vf ? vf.getBytes : async () => new Uint8Array(),
      })
    }
    warnings.push(...r.warnings)
  }

  if (samples.length === 0) warnings.push('未从 COCO json 解析出任何图片')
  return { samples, registry, warnings, annotationFiles: [...annotationFiles] }
}
