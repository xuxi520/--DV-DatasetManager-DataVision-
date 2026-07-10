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

/** 绝对像素 bbox [x,y,w,h]（polygon/seg 取外接框） */
function bboxAbs(ann: CanonicalAnnotation, w: number, h: number): [number, number, number, number] {
  if (ann.type === 'bbox') {
    const cx = ann.coords[0] * w
    const cy = ann.coords[1] * h
    const bw = ann.coords[2] * w
    const bh = ann.coords[3] * h
    return [cx - bw / 2, cy - bh / 2, bw, bh]
  }
  const pts = ann.coords
  let minx = 1, miny = 1, maxx = 0, maxy = 0
  for (let i = 0; i < pts.length; i += 2) {
    minx = Math.min(minx, pts[i])
    maxy = Math.max(maxy, pts[i + 1])
    minx = Math.min(minx, pts[i])
    maxx = Math.max(maxx, pts[i])
    miny = Math.min(miny, pts[i + 1])
  }
  const x = minx * w
  const y = miny * h
  return [x, y, (maxx - minx) * w, (maxy - miny) * h]
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

export async function exportCoco(
  ds: CanonicalDataset,
  policy: NamingPolicy = 'class_seq',
  opts?: ExportOptions
): Promise<ExportFile[]> {
  const namer = makeNamer(policy)
  const files: ExportFile[] = []
  let imgSeq = 0
  let annSeq = 0

  const categories = ds.classes.map((c) => ({ id: c.id, name: c.name }))

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

      const bytes = await s.getBytes()
      const { width, height } = await dimsOf(s, bytes, opts)
      const id = ++imgSeq
      images.push({ id, file_name, width, height })

      for (const ann of s.annotations) {
        const [x, y, w, h] = bboxAbs(ann, width, height)
        annotations.push({
          id: ++annSeq,
          image_id: id,
          category_id: ann.classId,
          bbox: [round(x), round(y), round(w), round(h)],
          area: round(w * h),
          iscrowd: 0,
        })
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
