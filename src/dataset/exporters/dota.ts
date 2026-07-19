/**
 * 导出为 DOTA 格式（旋转框）
 *
 * 输出布局：
 *   dataset/
 *     images/<name>.png
 *     labelTxt/<name>.txt   （每行：x1 y1 x2 y2 x3 y3 x4 y4 class_name difficult）
 *
 * 仅 obb / bbox 可表示（转四角像素）；keypoints / mask 在 DOTA 中无对应，跳过。
 */

import type { CanonicalDataset, CanonicalAnnotation } from '../types'
import type { ExportFile, ExportOptions } from './types'
import { makeNamer, primaryClassId, type NamingPolicy } from '../naming'

const enc = (s: string) => new TextEncoder().encode(s)

/** obb/bbox -> 绝对像素四角（DOTA 顺序：顺时针 x1y1...x4y4） */
export function cornersAbs(ann: CanonicalAnnotation, w: number, h: number): number[] {
  const [cx, cy, bw, bh] = ann.coords
  const a = ann.rotation ?? 0
  const cos = Math.cos(a), sin = Math.sin(a)
  const hw = (bw * w) / 2, hh = (bh * h) / 2
  const local: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
  return local.flatMap(([lx, ly]) => [
    Math.round(cx * w + lx * cos - ly * sin),
    Math.round(cy * h + lx * sin + ly * cos),
  ])
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

export async function exportDota(
  ds: CanonicalDataset,
  policy: NamingPolicy = 'class_seq',
  opts?: ExportOptions
): Promise<ExportFile[]> {
  const namer = makeNamer(policy)
  const files: ExportFile[] = []

  for (const sp of ['train', 'val', 'test'] as const) {
    const samples = ds.samples.filter((s) => s.split === sp)
    if (samples.length === 0) continue
    for (const s of samples) {
      const cid = primaryClassId(s, ds.classes)
      const className = ds.classes[cid]?.name || 'img'
      const base = namer.next(s, className)
      const ext = s.imageExt || '.jpg'
      const file_name = `${sp}/images/${base}${ext}`

      const bytes = opts?.imageBytesMap?.get(s.sourcePath) ?? (await s.getBytes())
      const { width, height } = await dimsOf(s, bytes, opts)
      files.push({ path: file_name, bytes })

      const lines = s.annotations
        .filter((a) => a.type === 'obb' || a.type === 'bbox')
        .map((a) => {
          const corners = cornersAbs(a, width, height)
          const name = ds.classes[a.classId]?.name || 'object'
          return `${corners.join(' ')} ${name} 0`
        })
      files.push({
        path: `${sp}/labelTxt/${base}.txt`,
        bytes: enc(lines.join('\n') + (lines.length ? '\n' : '')),
      })
    }
  }

  return files
}
