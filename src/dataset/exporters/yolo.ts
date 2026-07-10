/**
 * 导出为 YOLO 格式（规范化目录，统一命名）
 *
 * 输出布局：
 *   dataset/
 *     data.yaml
 *     train/images/<name>.jpg
 *     train/labels/<name>.txt
 *     val/...   test/...（仅含样本的划分）
 *
 * 坐标：规范模型已存归一化 [cx,cy,w,h]，YOLO 直接写出。
 */

import type { CanonicalDataset, CanonicalAnnotation } from '../types'
import type { ExportFile, ExportOptions } from './types'
import { makeNamer, primaryClassId, type NamingPolicy } from '../naming'

const enc = (s: string) => new TextEncoder().encode(s)

/** 计算归一化 bbox [cx,cy,w,h]（polygon/seg 取外接框） */
function bboxNorm(ann: CanonicalAnnotation): [number, number, number, number] {
  if (ann.type === 'bbox') {
    return [ann.coords[0], ann.coords[1], ann.coords[2], ann.coords[3]]
  }
  // points: [x0,y0,x1,y1,...] 归一化
  const pts = ann.coords
  let minx = 1, miny = 1, maxx = 0, maxy = 0
  for (let i = 0; i < pts.length; i += 2) {
    minx = Math.min(minx, pts[i])
    maxx = Math.max(maxx, pts[i])
    miny = Math.min(miny, pts[i + 1])
    maxy = Math.max(maxy, pts[i + 1])
  }
  return [(minx + maxx) / 2, (miny + maxy) / 2, maxx - minx, maxy - miny]
}

export async function exportYolo(
  ds: CanonicalDataset,
  policy: NamingPolicy = 'class_seq',
  _opts?: ExportOptions
): Promise<ExportFile[]> {
  const namer = makeNamer(policy)
  const files: ExportFile[] = []

  // data.yaml
  const present = new Set(ds.samples.map((s) => s.split))
  const names = ds.classes.map((c) => c.name)
  const lines: string[] = ['# 由 dataset-manager 生成']
  lines.push(`nc: ${names.length}`)
  lines.push(`names: [${names.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(', ')}]`)
  const rel: Record<string, string> = {
    train: 'train/images',
    val: 'val/images',
    test: 'test/images',
  }
  for (const sp of ['train', 'val', 'test'] as const) {
    if (present.has(sp)) lines.push(`${sp}: ${rel[sp]}`)
  }
  files.push({ path: 'data.yaml', bytes: enc(lines.join('\n') + '\n') })

  for (const sp of ['train', 'val', 'test'] as const) {
    const samples = ds.samples.filter((s) => s.split === sp)
    if (samples.length === 0) continue
    for (const s of samples) {
      const cid = primaryClassId(s, ds.classes)
      const className = ds.classes[cid]?.name || 'img'
      const base = namer.next(s, className)
      const ext = s.imageExt || '.jpg'

      const imgBytes = await s.getBytes()
      files.push({ path: `${sp}/images/${base}${ext}`, bytes: imgBytes })

      const label = s.annotations
        .map((ann) => {
          const [cx, cy, w, h] = bboxNorm(ann)
          return `${ann.classId} ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`
        })
        .join('\n')
      files.push({ path: `${sp}/labels/${base}.txt`, bytes: enc(label + (s.annotations.length ? '\n' : '')) })
    }
  }

  return files
}
