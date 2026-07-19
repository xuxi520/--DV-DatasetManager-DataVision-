/**
 * 导出为 COCO 格式
 *
 * 输出布局：
 *   dataset/
 *     annotations/instances_train.json
 *     annotations/instances_val.json
 *     train/<name>.jpg
 *     val/<name>.jpg
 *     test/<name>.jpg
 *
 * bbox：COCO 绝对像素 [x_top, y_top, w, h]。
 * 规范模型存归一化 [cx,cy,w,h]，按图片尺寸换算。
 */

import type { CanonicalDataset, CanonicalAnnotation } from '../types'
import type { ExportFile, ExportOptions } from './types'
import { makeNamer, primaryClassId, type NamingPolicy } from '../naming'

const enc = (s: string) => new TextEncoder().encode(s)

/** 绝对像素 bbox [x,y,w,h]（polygon/seg/obb 取外接框） */
function bboxAbs(ann: CanonicalAnnotation, w: number, h: number): [number, number, number, number] {
  if (ann.type === 'bbox' || ann.type === 'obb') {
    const cx = ann.coords[0] * w
    const cy = ann.coords[1] * h
    const bw = ann.coords[2] * w
    const bh = ann.coords[3] * h
    return [cx - bw / 2, cy - bh / 2, bw, bh]
  }
  const pts = ann.coords
  let minx = 1, miny = 1, maxx = 0, maxy = 0
  for (let i = 0; i < pts.length; i += 2) {
    minx = Math.min(minx, pts[i]); maxx = Math.max(maxx, pts[i])
    miny = Math.min(miny, pts[i + 1]); maxy = Math.max(maxy, pts[i + 1])
  }
  const x = minx * w
  const y = miny * h
  return [x, y, (maxx - minx) * w, (maxy - miny) * h]
}

/** 由归一化 obb [cx,cy,w,h] + 弧度角生成绝对像素四角多边形 */
function obbPolygonAbs(ann: CanonicalAnnotation, w: number, h: number): number[] {
  const [cx, cy, bw, bh] = ann.coords
  const a = ann.rotation ?? 0
  const cos = Math.cos(a), sin = Math.sin(a)
  const hw = (bw * w) / 2, hh = (bh * h) / 2
  const local: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
  const out: number[] = []
  for (const [lx, ly] of local) {
    out.push(cx * w + lx * cos - ly * sin, cy * h + lx * sin + ly * cos)
  }
  return out
}

/** 多边形面积（绝对像素，shoelace） */
function polyAreaAbs(poly: number[]): number {
  let area = 0
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    area += poly[i] * poly[j + 1] - poly[j] * poly[i + 1]
  }
  return Math.abs(area) / 2
}

async function dimsOf(
  s: CanonicalDataset['samples'][number],
  bytes: Uint8Array,
  opts?: ExportOptions
): Promise<{ width: number; height: number }> {
  if (s.width && s.height) return { width: s.width, height: s.height }
  if (opts?.dimsReader) return opts.dimsReader(bytes)
  return { width: 0, height: 0 }
}

/** 把单条规范标注转为 COCO annotation（不含 id/image_id） */
export function toCocoAnn(ann: CanonicalAnnotation, width: number, height: number): any {
  const [x, y, w, h] = bboxAbs(ann, width, height)
  const base: any = {
    category_id: ann.classId,
    bbox: [round(x), round(y), round(w), round(h)],
  }

  if (ann.type === 'keypoints') {
    const kp: number[] = []
    let num = 0
    for (let i = 0; i + 2 < ann.coords.length; i += 3) {
      const px = round(ann.coords[i] * width)
      const py = round(ann.coords[i + 1] * height)
      const v = Math.round(ann.coords[i + 2])
      kp.push(px, py, v)
      if (v > 0) num++
    }
    base.keypoints = kp
    base.num_keypoints = num
    base.area = round(w * h)
    base.iscrowd = 0
    return base
  }

  if (ann.type === 'obb') {
    const poly = obbPolygonAbs(ann, width, height)
    base.segmentation = [poly]
    base.area = round(polyAreaAbs(poly))
    base.iscrowd = 0
    return base
  }

  if (ann.type === 'mask' || ann.type === 'segmentation') {
    if (ann.rle) {
      base.segmentation = { size: ann.rle.size, counts: ann.rle.counts }
      base.iscrowd = ann.iscrowd ? 1 : 0
      base.area = ann.iscrowd ? round(w * h) : round(polyAreaAbs(obbPolygonAbsSafe(ann, width, height)))
    } else {
      const poly: number[] = []
      for (let i = 0; i + 1 < ann.coords.length; i += 2) {
        poly.push(round(ann.coords[i] * width), round(ann.coords[i + 1] * height))
      }
      base.segmentation = [poly]
      base.area = round(polyAreaAbs(poly))
      base.iscrowd = 0
    }
    return base
  }

  // bbox
  base.area = round(w * h)
  base.iscrowd = 0
  return base
}

/** 当 mask 仅有 RLE 时，用 bbox 面积作为 area 兜底 */
function obbPolygonAbsSafe(ann: CanonicalAnnotation, w: number, h: number): number[] {
  const [bx, by, bw, bh] = bboxAbs(ann, w, h)
  return [bx, by, bx + bw, by, bx + bw, by + bh, bx, by + bh]
}

export async function exportCoco(
  ds: CanonicalDataset,
  policy: NamingPolicy = 'class_seq',
  opts?: ExportOptions
): Promise<ExportFile[]> {
  const namer = makeNamer(policy)
  const files: ExportFile[] = []
  let imgSeq = 0
  let annSeq = 0

  // 关键点类别需补充 keypoints 名称与 skeleton（取首条关键点标注的边）
  const hasKeypoints = ds.samples.some((s) => s.annotations.some((a) => a.type === 'keypoints'))
  let skeleton: [number, number][] = []
  let kpCount = 0
  for (const s of ds.samples) {
    const a = s.annotations.find((x) => x.type === 'keypoints' && x.coords.length >= 3)
    if (a) {
      kpCount = a.coords.length / 3
      skeleton = a.edges ?? []
      break
    }
  }
  const categories = ds.classes.map((c) => {
    const cat: any = { id: c.id, name: c.name }
    if (hasKeypoints) {
      cat.keypoints = Array.from({ length: kpCount }, (_, i) => `k${i}`)
      cat.skeleton = skeleton
    }
    return cat
  })

  for (const sp of ['train', 'val', 'test'] as const) {
    const samples = ds.samples.filter((s) => s.split === sp)
    if (samples.length === 0) continue

    const images: any[] = []
    const annotations: any[] = []

    for (const s of samples) {
      const cid = primaryClassId(s, ds.classes)
      const className = ds.classes[cid]?.name || 'img'
      const base = namer.next(s, className)
      const ext = s.imageExt || '.jpg'
      const file_name = `${sp}/${base}${ext}`

      const bytes = opts?.imageBytesMap?.get(s.sourcePath) ?? (await s.getBytes())
      const { width, height } = await dimsOf(s, bytes, opts)
      const id = ++imgSeq
      images.push({ id, file_name, width, height })

      for (const ann of s.annotations) {
        const coco = toCocoAnn(ann, width, height)
        coco.id = ++annSeq
        coco.image_id = id
        annotations.push(coco)
      }

      files.push({ path: file_name, bytes })
    }

    const json = {
      info: { description: 'Exported by dataset-manager' },
      licenses: [],
      images,
      annotations,
      categories,
    }
    files.push({
      path: `annotations/instances_${sp}.json`,
      bytes: enc(JSON.stringify(json, null, 2)),
    })
  }

  return files
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
