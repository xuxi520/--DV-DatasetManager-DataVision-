/**
 * 导出为 Pascal VOC 格式
 *
 * 输出布局：
 *   dataset/
 *     JPEGImages/<name>.jpg
 *     Annotations/<name>.xml
 *     ImageSets/Main/<className>_train.txt   (每行 "<name> 1")
 *     ImageSets/Main/<className>_val.txt
 *     ImageSets/Main/<className>_test.txt
 *
 * bndbox：VOC 绝对像素 [xmin, ymin, xmax, ymax]。
 */

import type { CanonicalDataset, CanonicalAnnotation } from '../types'
import type { ExportFile, ExportOptions } from './types'
import { makeNamer, primaryClassId, type NamingPolicy } from '../naming'

const enc = (s: string) => new TextEncoder().encode(s)

function bboxAbs(ann: CanonicalAnnotation, w: number, h: number): [number, number, number, number] {
  if (ann.type === 'bbox') {
    const cx = ann.coords[0] * w
    const cy = ann.coords[1] * h
    const bw = ann.coords[2] * w
    const bh = ann.coords[3] * h
    return [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2]
  }
  const pts = ann.coords
  let minx = 1, miny = 1, maxx = 0, maxy = 0
  for (let i = 0; i < pts.length; i += 2) {
    minx = Math.min(minx, pts[i])
    maxx = Math.max(maxx, pts[i])
    miny = Math.min(miny, pts[i + 1])
    maxy = Math.max(maxy, pts[i + 1])
  }
  return [minx * w, miny * h, maxx * w, maxy * h]
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

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;'
  )
}

export async function exportVoc(
  ds: CanonicalDataset,
  policy: NamingPolicy = 'class_seq',
  opts?: ExportOptions
): Promise<ExportFile[]> {
  const namer = makeNamer(policy)
  const files: ExportFile[] = []

  // 每个类名 -> 各划分下的文件名列表（用于 ImageSets）
  const splitLists = new Map<string, Record<string, string[]>>()

  for (const sp of ['train', 'val', 'test'] as const) {
    const samples = ds.samples.filter((s) => s.split === sp)
    if (samples.length === 0) continue

    for (const s of samples) {
      const cid = primaryClassId(s, ds.classes)
      const className = ds.classes[cid]?.name || 'img'
      const base = namer.next(s, className)
      const ext = s.imageExt || '.jpg'

      const bytes = await s.getBytes()
      const { width, height } = await dimsOf(s, bytes, opts)

      files.push({ path: `JPEGImages/${base}${ext}`, bytes })

      const objs = s.annotations
        .map((ann) => {
          const [xmin, ymin, xmax, ymax] = bboxAbs(ann, width, height)
          return `  <object>\n    <name>${xmlEscape(ds.classes[ann.classId]?.name || 'unknown')}</name>\n    <pose>Unspecified</pose>\n    <truncated>0</truncated>\n    <difficult>0</difficult>\n    <bndbox>\n      <xmin>${Math.round(xmin)}</xmin>\n      <ymin>${Math.round(ymin)}</ymin>\n      <xmax>${Math.round(xmax)}</xmax>\n      <ymax>${Math.round(ymax)}</ymax>\n    </bndbox>\n  </object>`
        })
        .join('\n')

      const xml = `<?xml version="1.0"?>\n<annotation>\n  <folder>JPEGImages</folder>\n  <filename>${xmlEscape(base + ext)}</filename>\n  <size>\n    <width>${Math.round(width)}</width>\n    <height>${Math.round(height)}</height>\n    <depth>3</depth>\n  </size>\n${objs}\n</annotation>\n`
      files.push({ path: `Annotations/${base}.xml`, bytes: enc(xml) })

      // 记录到 ImageSets
      let rec = splitLists.get(className)
      if (!rec) {
        rec = { train: [], val: [], test: [] }
        splitLists.set(className, rec)
      }
      rec[sp].push(base)
    }
  }

  // ImageSets/Main/<className>_<split>.txt
  for (const [className, rec] of splitLists) {
    for (const sp of ['train', 'val', 'test'] as const) {
      if (rec[sp].length === 0) continue
      const content = rec[sp].map((b) => `${b} 1`).join('\n') + '\n'
      files.push({ path: `ImageSets/Main/${className}_${sp}.txt`, bytes: enc(content) })
    }
  }

  return files
}
