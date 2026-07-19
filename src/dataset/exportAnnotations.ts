/**
 * 标注 CSV / JSON 导出（IExportService 落地项）
 *
 * 覆盖全部规范标注类型：bbox / obb / polygon / segmentation / keypoints / mask（RLE 与多边形）。
 * 坐标统一用 canonical 归一化 0~1，不依赖图片尺寸；mask RLE 原样保留，保证无损往返。
 * 与导出 ZIP 不同：不打包图片，仅导出标注文件（单文件直接下载）。
 */

import { cloneCanonical, rebalanceSplits } from './exportBrowser'
import type { SplitTargets, ReSplitOptions } from './split'
import type { CanonicalDataset, CanonicalAnnotation } from './types'
import { saveFile } from '../fileSave'

export type AnnotationFormat = 'csv' | 'json'

export interface AnnotationExportOptions {
  format: AnnotationFormat
  datasetName?: string
  /** 若提供则先在克隆上按比例重划分，导出的 split 反映重划分结果 */
  rebalance?: { targets: SplitTargets; options?: ReSplitOptions }
}

/** 清洗为安全文件名片段 */
function safe(s: string): string {
  return (s || 'dataset').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'dataset'
}

/** 取标注归一化包围盒 [x_center, y_center, width, height]（0~1） */
function annBBox(ann: CanonicalAnnotation): [number, number, number, number] {
  if (ann.type === 'bbox' || ann.type === 'obb') {
    const [cx, cy, w, h] = ann.coords
    return [cx, cy, w, h]
  }
  if (ann.coords.length >= 2) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i + 1 < ann.coords.length; i += 2) {
      const x = ann.coords[i]
      const y = ann.coords[i + 1]
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    if (minX <= maxX) return [minX, minY, maxX - minX, maxY - minY]
  }
  // RLE-only mask：以全图兜底
  return [0, 0, 1, 1]
}

/** 几何点文本：polygon/segmentation/mask(多边形) → "x y x y ..."；keypoints → "x y v x y v ..." */
function pointsText(ann: CanonicalAnnotation): string {
  if (ann.type === 'keypoints') {
    const out: string[] = []
    for (let i = 0; i + 2 < ann.coords.length; i += 3) {
      out.push(`${ann.coords[i]} ${ann.coords[i + 1]} ${ann.coords[i + 2]}`)
    }
    return out.join(' ')
  }
  if (ann.coords.length >= 2) {
    const out: string[] = []
    for (let i = 0; i + 1 < ann.coords.length; i += 2) {
      out.push(`${ann.coords[i]} ${ann.coords[i + 1]}`)
    }
    return out.join(' ')
  }
  return ''
}

/** RLE 文本：紧凑字符串原样；展开数组以空格连接；无则空 */
function rleText(ann: CanonicalAnnotation): string {
  if (!ann.rle) return ''
  return typeof ann.rle.counts === 'string'
    ? ann.rle.counts
    : ann.rle.counts.join(' ')
}

function rleSizeText(ann: CanonicalAnnotation): string {
  return ann.rle ? `${ann.rle.size[0]},${ann.rle.size[1]}` : ''
}

function csvField(v: string | number): string {
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const CSV_HEADER = [
  'image_path', 'split', 'class_id', 'class_name', 'type',
  'x_center', 'y_center', 'width', 'height', 'rotation',
  'points', 'rle_counts', 'rle_size', 'iscrowd', 'confidence', 'description',
]

function buildCsv(ds: CanonicalDataset): string {
  const classMap = new Map(ds.classes.map((c) => [c.id, c.name]))
  const rows: string[] = [CSV_HEADER.join(',')]

  for (const s of ds.samples) {
    if (s.annotations.length === 0) continue
    for (const a of s.annotations) {
      const [cx, cy, w, h] = annBBox(a)
      const cells = [
        s.sourcePath,
        s.split,
        a.classId,
        classMap.get(a.classId) ?? '',
        a.type,
        cx.toFixed(6),
        cy.toFixed(6),
        w.toFixed(6),
        h.toFixed(6),
        a.rotation != null ? a.rotation.toFixed(6) : '',
        pointsText(a),
        rleText(a),
        rleSizeText(a),
        a.iscrowd ? 1 : 0,
        a.confidence != null ? a.confidence.toFixed(4) : '',
        a.description ?? '',
      ]
      rows.push(cells.map(csvField).join(','))
    }
  }
  // 加 BOM 保证 Excel 正确识别 UTF-8 中文
  return '﻿' + rows.join('\r\n')
}

function buildJson(ds: CanonicalDataset): string {
  const classMap = new Map(ds.classes.map((c) => [c.id, c.name]))
  const payload = {
    exported_at: new Date().toISOString(),
    classes: ds.classes.map((c) => ({ id: c.id, name: c.name })),
    images: ds.samples.map((s) => ({
      file_name: s.sourcePath,
      split: s.split,
      width: s.width ?? null,
      height: s.height ?? null,
      annotations: s.annotations.map((a) => {
        const [cx, cy, w, h] = annBBox(a)
        const base: Record<string, unknown> = {
          class_id: a.classId,
          class_name: classMap.get(a.classId) ?? '',
          type: a.type,
          bbox: [Number(cx.toFixed(6)), Number(cy.toFixed(6)), Number(w.toFixed(6)), Number(h.toFixed(6))],
        }
        if (a.rotation != null) base.rotation = Number(a.rotation.toFixed(6))
        if (a.type === 'keypoints') {
          const kp: { x: number; y: number; v: number }[] = []
          for (let i = 0; i + 2 < a.coords.length; i += 3) {
            kp.push({
              x: Number(a.coords[i].toFixed(6)),
              y: Number(a.coords[i + 1].toFixed(6)),
              v: a.coords[i + 2],
            })
          }
          base.keypoints = kp
        } else if (a.coords.length >= 2) {
          const pts: [number, number][] = []
          for (let i = 0; i + 1 < a.coords.length; i += 2) {
            pts.push([Number(a.coords[i].toFixed(6)), Number(a.coords[i + 1].toFixed(6))])
          }
          base.points = pts
        }
        if (a.rle) base.rle = { size: a.rle.size, counts: a.rle.counts }
        if (a.iscrowd) base.iscrowd = true
        if (a.confidence != null) base.confidence = Number(a.confidence.toFixed(4))
        if (a.description) base.description = a.description
        return base
      }),
    })),
  }
  return JSON.stringify(payload, null, 2)
}

async function downloadBlob(blob: Blob, filename: string) {
  const ext = filename.toLowerCase().endsWith('.csv') ? 'csv' : 'json'
  await saveFile(filename, blob, {
    title: '保存标注文件',
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  })
}

/**
 * 导出标注（CSV / JSON）并直接下载。
 * @returns 导出的标注条数
 */
export async function exportAnnotations(
  source: CanonicalDataset,
  opts: AnnotationExportOptions,
): Promise<number> {
  const ds = cloneCanonical(source)
  if (opts.rebalance) {
    rebalanceSplits(ds, opts.rebalance.targets, opts.rebalance.options)
  }

  const content = opts.format === 'csv' ? buildCsv(ds) : buildJson(ds)
  const mime = opts.format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8'
  await downloadBlob(new Blob([content], { type: mime }), `${safe(opts.datasetName ?? 'dataset')}_annotations.${opts.format}`)

  let count = 0
  for (const s of ds.samples) count += s.annotations.length
  return count
}
