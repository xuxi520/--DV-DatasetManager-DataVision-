/**
 * COCO 数据变换（纯函数，无副作用、无 DOM 依赖）。
 *
 * 同时被主线程内联解析与 Web Worker 重型解析共用：把一份已解析的 COCO json
 * 对象转换为「样本 + 标注」的紧凑结构（不含 getBytes，因为图片字节留在主线程
 * 的 VirtualFile 上，解析线程不应触碰文件 IO）。
 *
 * 之所以单独抽出来：COCO val2017 单份标注 json 可达 200MB+，JSON.parse 会卡死
 * 主线程。把这一步移到 Worker 后，主线程全程保持响应，仅负责按名合并类别并回填
 * getBytes。
 */
import { ClassRegistry } from '../classRegistry'
import type {
  CanonicalSample,
  CanonicalAnnotation,
  KeypointEdge,
  SplitKey,
} from '../types'
import { normSlash, ext, baseName, detectSplit } from './shared'

/** 不含 getBytes 的样本（图片字节由主线程回填） */
export type RawSample = Omit<CanonicalSample, 'getBytes'>

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
  keypoints?: number[]
  num_keypoints?: number
  segmentation?: any
  iscrowd?: number
  caption?: string
}
interface CocoCat {
  id: number
  name: string
  skeleton?: [number, number][]
}

export function cocoSplit(jsonPath: string, fileName: string): SplitKey {
  const n = normSlash(jsonPath).toLowerCase()
  if (/(^|[\/_])(train|training)/.test(n)) return 'train'
  if (/(^|[\/_])(val|valid|validation)/.test(n)) return 'val'
  if (/(^|[\/_])(test|testing)/.test(n)) return 'test'
  return detectSplit(fileName)
}

export interface CocoTransformResult {
  samples: RawSample[]
  warnings: string[]
}

/**
 * 把已解析的 COCO json（data）转换为 RawSample 列表。
 * @param registry 类别注册表（调用方持有，支持多文件合并时共享）
 */
export function transformCocoData(
  data: any,
  jfPath: string,
  registry: ClassRegistry,
): CocoTransformResult {
  const warnings: string[] = []
  const imgs: CocoImage[] = data.images || []
  const anns: CocoAnn[] = data.annotations || []
  const cats: CocoCat[] = data.categories || []

  // category_id -> 本地 classId；并记录关键点骨架
  const catMap = new Map<number, number>()
  const skeletonMap = new Map<number, KeypointEdge[]>()
  for (const c of cats) {
    if (!catMap.has(c.id)) {
      const id = registry.add(c.name)
      catMap.set(c.id, id)
    }
    if (c.skeleton && Array.isArray(c.skeleton)) {
      // COCO skeleton 为 1-based 索引，转为 0-based
      skeletonMap.set(
        c.id,
        c.skeleton.map((e: [number, number]) => [e[0] - 1, e[1] - 1] as KeypointEdge),
      )
    }
  }

  const samples: RawSample[] = []
  const seenImgIds = new Set<number>()
  const imgMap = new Map<number, RawSample>()

  for (const im of imgs) {
    if (seenImgIds.has(im.id)) continue
    seenImgIds.add(im.id)
    const split = cocoSplit(jfPath, im.file_name)
    const sample: RawSample = {
      id: `coco:${im.id}`,
      sourcePath: im.file_name,
      split,
      category: '',
      imageExt: ext(im.file_name).toLowerCase() || '.jpg',
      annotations: [],
      width: im.width,
      height: im.height,
    }
    imgMap.set(im.id, sample)
    samples.push(sample)
  }

  for (const a of anns) {
    // 图文描述（captions）等非检测条目：无类别、仅 caption 文本，跳过避免噪声
    if (a.caption !== undefined) continue
    const s = imgMap.get(a.image_id)
    if (!s) continue
    const clsId = catMap.get(a.category_id)
    if (clsId === undefined) {
      if (warnings.length < 50) warnings.push(`标注含未知 category_id=${a.category_id}`)
      continue
    }
    const W = s.width || 1
    const H = s.height || 1
    let ann: CanonicalAnnotation | null = null

    // 关键点（COCO person keypoints 等）
    if (a.keypoints && a.keypoints.length >= 3) {
      const coords: number[] = []
      for (let i = 0; i + 2 < a.keypoints.length; i += 3) {
        coords.push(a.keypoints[i] / W, a.keypoints[i + 1] / H, a.keypoints[i + 2])
      }
      ann = {
        type: 'keypoints',
        classId: clsId,
        coords,
        edges: skeletonMap.get(a.category_id),
      }
    }
    // 分割掩码（多边形 / RLE）
    else if (a.segmentation) {
      if (Array.isArray(a.segmentation) && a.segmentation.length && Array.isArray(a.segmentation[0])) {
        const poly = a.segmentation[0] as number[]
        const coords: number[] = []
        for (let i = 0; i + 1 < poly.length; i += 2) {
          coords.push(poly[i] / W, poly[i + 1] / H)
        }
        ann = {
          type: 'mask',
          classId: clsId,
          coords,
          iscrowd: a.iscrowd === 1,
        }
      } else if (a.segmentation && typeof a.segmentation === 'object' && 'counts' in a.segmentation) {
        ann = {
          type: 'mask',
          classId: clsId,
          coords: [],
          rle: { size: a.segmentation.size, counts: a.segmentation.counts },
          iscrowd: a.iscrowd === 1,
        }
      }
    }

    // 默认 / 兜底：水平框
    if (!ann) {
      const [x, y, w, h] = a.bbox
      ann = {
        type: 'bbox',
        classId: clsId,
        coords: [(x + w / 2) / W, (y + h / 2) / H, w / W, h / H],
      }
    }
    s.annotations.push(ann)
  }

  if (samples.length === 0) warnings.push('未从 COCO json 解析出任何图片')
  return { samples, warnings }
}
