/**
 * 标注编辑的持久化层：把 canonical 中（被用户编辑过的）标注写回原始标注文件。
 *
 * 设计：
 * - canonical 是唯一数据源；编辑只改 canonical，本模块负责把「脏文件」重新序列化为
 *   对应格式的原始标注文件内容，并写回磁盘（Tauri）或打包下载（浏览器）。
 * - 单样本序列化复用 exporters 的坐标换算逻辑（YOLO 归一化 / VOC·COCO 绝对像素）。
 * - COCO 是单 JSON 多图，按 split 整文件重写（reflect 该 split 全部编辑）。
 * - 由于浏览器无本地写能力，脏文件以 ZIP 下载（focused save）。
 */
import JSZip from 'jszip'
import { invoke } from '@tauri-apps/api/core'
import { env } from '../env'
import { saveFile } from '../fileSave'
import type { CanonicalDataset, CanonicalAnnotation, SplitKey } from './types'
import type { DataSet } from '../types'
import { yoloLine } from './exporters/yolo'
import { toCocoAnn } from './exporters/coco'
import { cornersAbs } from './exporters/dota'

function bboxNorm(ann: CanonicalAnnotation): [number, number, number, number] {
  if (ann.type === 'bbox' || ann.type === 'obb') {
    return [ann.coords[0], ann.coords[1], ann.coords[2], ann.coords[3]]
  }
  const pts = ann.coords
  const step = ann.type === 'keypoints' ? 3 : 2
  let minx = 1, miny = 1, maxx = 0, maxy = 0
  for (let i = 0; i + 1 < pts.length; i += step) {
    minx = Math.min(minx, pts[i]); maxx = Math.max(maxx, pts[i])
    miny = Math.min(miny, pts[i + 1]); maxy = Math.max(maxy, pts[i + 1])
  }
  return [(minx + maxx) / 2, (miny + maxy) / 2, maxx - minx, maxy - miny]
}

function bboxAbsPx(
  ann: CanonicalAnnotation,
  w: number,
  h: number,
): [number, number, number, number] {
  if (ann.type === 'bbox' || ann.type === 'obb') {
    const cx = ann.coords[0] * w
    const cy = ann.coords[1] * h
    const bw = ann.coords[2] * w
    const bh = ann.coords[3] * h
    return [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2]
  }
  const pts = ann.coords
  const step = ann.type === 'keypoints' ? 3 : 2
  let minx = 1, miny = 1, maxx = 0, maxy = 0
  for (let i = 0; i + 1 < pts.length; i += step) {
    minx = Math.min(minx, pts[i]); maxx = Math.max(maxx, pts[i])
    miny = Math.min(miny, pts[i + 1]); maxy = Math.max(maxy, pts[i + 1])
  }
  return [minx * w, miny * h, maxx * w, maxy * h]
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;')
}

function dirName(p: string): string {
  const i = p.replace(/\\/g, '/').lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}
function baseName(p: string): string {
  const f = p.replace(/\\/g, '/').split('/').pop() || ''
  const i = f.lastIndexOf('.')
  return i < 0 ? f : f.slice(0, i)
}

function fileDims(ds: DataSet, sampleId: string): { width: number; height: number } {
  const f = ds.fileList.find((x) => x.id === sampleId)
  const w = f?.width || 0
  const h = f?.height || 0
  return { width: w, height: h }
}

function buildYoloContent(sample: CanonicalDataset['samples'][number]): string {
  if (sample.annotations.length === 0) return ''
  return sample.annotations.map((ann) => yoloLine(ann)).join('\n') + '\n'
}

function buildVocContent(
  sample: CanonicalDataset['samples'][number],
  ds: CanonicalDataset,
  w: number,
  h: number,
): string {
  const objs = sample.annotations
    .map((ann) => {
      const [xmin, ymin, xmax, ymax] = bboxAbsPx(ann, w, h)
      return `  <object>\n    <name>${xmlEscape(ds.classes[ann.classId]?.name || 'unknown')}</name>\n    <pose>Unspecified</pose>\n    <truncated>0</truncated>\n    <difficult>0</difficult>\n    <bndbox>\n      <xmin>${Math.round(xmin)}</xmin>\n      <ymin>${Math.round(ymin)}</ymin>\n      <xmax>${Math.round(xmax)}</xmax>\n      <ymax>${Math.round(ymax)}</ymax>\n    </bndbox>\n  </object>`
    })
    .join('\n')
  const fname = baseName(sample.sourcePath) + sample.imageExt
  return `<?xml version="1.0"?>\n<annotation>\n  <folder>JPEGImages</folder>\n  <filename>${xmlEscape(fname)}</filename>\n  <size>\n    <width>${Math.round(w)}</width>\n    <height>${Math.round(h)}</height>\n    <depth>3</depth>\n  </size>\n${objs}\n</annotation>\n`
}

function buildLabelMeContent(
  sample: CanonicalDataset['samples'][number],
  ds: CanonicalDataset,
  w: number,
  h: number,
): string {
  const W = w || 1
  const H = h || 1
  const rawTop = (sample as { rawTop?: Record<string, unknown> }).rawTop

  const shapes = sample.annotations.map((ann) => {
    const raw = (ann as { raw?: Record<string, unknown> }).raw
    const label = ds.classes[ann.classId]?.name || 'unknown'

    if (ann.type === 'bbox' || ann.type === 'obb') {
      const [cx, cy, bw, bh] = bboxNorm(ann)
      const tlX = (cx - bw / 2) * W
      const tlY = (cy - bh / 2) * H
      const pw = bw * W
      const ph = bh * H

      let shapeType: string
      let points: [number, number][]
      if (ann.type === 'obb') {
        // 旋转框：4 个旋转角点（TL,TR,BR,BL），与导入约定一致
        shapeType = 'rotated_rectangle'
        const angle = ann.rotation ?? 0
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const corners: [number, number][] = [
          [-pw / 2, -ph / 2],
          [pw / 2, -ph / 2],
          [pw / 2, ph / 2],
          [-pw / 2, ph / 2],
        ]
        points = corners.map(([lx, ly]) => [
          tlX + pw / 2 + lx * cos - ly * sin,
          tlY + ph / 2 + lx * sin + ly * cos,
        ])
      } else {
        // 矩形：保留原始 4 点（X-AnyLabeling）或 2 点（LabelMe）约定
        const rawPts = Array.isArray(raw?.points) ? (raw!.points as number[][]) : null
        shapeType = String(raw?.shape_type || 'rectangle')
        if (rawPts && rawPts.length >= 4) {
          points = [
            [tlX, tlY],
            [tlX + pw, tlY],
            [tlX + pw, tlY + ph],
            [tlX, tlY + ph],
          ]
        } else {
          points = [
            [tlX, tlY],
            [tlX + pw, tlY + ph],
          ]
        }
      }

      return {
        // 先展开原始 shape，保留 group_id/flags/difficult/attributes/kie_linking 等
        ...(raw && typeof raw === 'object' ? { ...raw } : {}),
        label,
        shape_type: shapeType,
        points,
        ...(ann.description ? { description: ann.description } : {}),
        ...(ann.confidence != null ? { score: ann.confidence } : {}),
      }
    }

    // polygon / segmentation / mask / keypoints → 多边形点序列
    const step = ann.type === 'keypoints' ? 3 : 2
    const pts: [number, number][] = []
    for (let i = 0; i + 1 < ann.coords.length; i += step) {
      pts.push([ann.coords[i] * W, ann.coords[i + 1] * H])
    }
    const shapeType = ann.type === 'keypoints' ? 'points' : String(raw?.shape_type || 'polygon')
    return {
      ...(raw && typeof raw === 'object' ? { ...raw } : {}),
      label,
      shape_type: shapeType,
      points: pts,
      ...(ann.description ? { description: ann.description } : {}),
      ...(ann.confidence != null ? { score: ann.confidence } : {}),
    }
  })

  // 完整 X-AnyLabeling / LabelMe 顶层结构，保留原始 version/flags/imageData 等字段
  const data: Record<string, unknown> = {
    ...(rawTop && typeof rawTop === 'object' ? { ...rawTop } : {}),
    version: rawTop?.version ?? '4.5.6',
    flags: rawTop?.flags ?? {},
    imagePath: baseName(sample.sourcePath) + sample.imageExt,
    imageData: rawTop?.imageData ?? null,
    imageHeight: Math.round(H),
    imageWidth: Math.round(W),
    description: rawTop?.description ?? '',
    shapes,
  }
  // X-AnyLabeling 顶层需有 checked 字段
  if (!('checked' in (rawTop ?? {}))) data.checked = false
  return JSON.stringify(data, null, 2)
}

/** 计算某脏样本应写回的标注相对路径（按格式约定） */
function relPathFor(sample: CanonicalDataset['samples'][number], format: string): string {
  const dir = dirName(sample.sourcePath)
  const stem = baseName(sample.sourcePath)
  const rel = (name: string) => (dir ? `${dir}/${name}` : name)
  if (format === 'yolo') return rel(`${stem}.txt`)
  if (format === 'voc') return rel(`${stem}.xml`)
  if (format === 'labelme') return rel(`${stem}.json`)
  if (format === 'dota') return rel(`labelTxt/${stem}.txt`)
  return rel(`${stem}.txt`)
}

export interface SaveFile {
  relPath: string
  content: string
  absPath?: string
}

/**
 * 为脏文件集合生成应写回的标注文件列表。
 * dataset 提供 classes / sourceFormat / rootAbsPath / labelRootAbsPath / annotationFiles / fileList。
 */
export function buildSaveFiles(dataset: DataSet, dirtyFileIds: string[]): SaveFile[] {
  const canonical = dataset.canonical
  if (!canonical) return []
  const format = canonical.sourceFormat
  const root = dataset.rootAbsPath
  const labelRoot = dataset.labelRootAbsPath || root
  const out: SaveFile[] = []

  const dirtySet = new Set(dirtyFileIds)
  const dirtySamples = canonical.samples.filter((s) => dirtySet.has(s.id))

  if (format === 'coco') {
    // 按 split 整文件重写
    const splits = Array.from(new Set(dirtySamples.map((s) => s.split)))
    for (const sp of splits) {
      const content = buildCocoSplitWithDims(dataset, canonical, sp)
      // 找对应 json 相对路径
      const jsonRel = (canonical.annotationFiles || []).find((p) => p.includes(`_${sp}.json`) || p.toLowerCase().includes(sp))
      const relPath = jsonRel || `annotations/instances_${sp}.json`
      const absPath = root ? `${root}/${relPath}` : undefined
      out.push({ relPath, content, absPath })
    }
    return out
  }

  if (format === 'dota') {
    for (const s of dirtySamples) {
      const { width, height } = fileDims(dataset, s.id)
      const lines = s.annotations
        .filter((a) => a.type === 'obb' || a.type === 'bbox')
        .map((a) => {
          const corners = cornersAbs(a, width, height)
          const name = canonical.classes[a.classId]?.name || 'object'
          return `${corners.join(' ')} ${name} 0`
        })
      const content = lines.join('\n') + (lines.length ? '\n' : '')
      const relPath = relPathFor(s, format)
      const absPath = labelRoot ? `${labelRoot}/${relPath}` : undefined
      out.push({ relPath, content, absPath })
    }
    return out
  }

  for (const s of dirtySamples) {
    const { width, height } = fileDims(dataset, s.id)
    let content = ''
    if (format === 'yolo') content = buildYoloContent(s)
    else if (format === 'voc') content = buildVocContent(s, canonical, width, height)
    else if (format === 'labelme') content = buildLabelMeContent(s, canonical, width, height)
    else continue
    const relPath = relPathFor(s, format)
    const absPath = labelRoot ? `${labelRoot}/${relPath}` : undefined
    out.push({ relPath, content, absPath })
  }
  return out
}

// COCO 需要像素尺寸：从 DataSet.fileList 取
function buildCocoSplitWithDims(dataset: DataSet, canonical: CanonicalDataset, split: SplitKey): string {
  const samples = canonical.samples.filter((s) => s.split === split)

  // 关键点类别需补充 keypoints 名称与 skeleton（取首条关键点标注的边）
  const hasKeypoints = canonical.samples.some((s) => s.annotations.some((a) => a.type === 'keypoints'))
  let skeleton: [number, number][] = []
  let kpCount = 0
  for (const s of canonical.samples) {
    const a = s.annotations.find((x) => x.type === 'keypoints' && x.coords.length >= 3)
    if (a) {
      kpCount = a.coords.length / 3
      skeleton = a.edges ?? []
      break
    }
  }
  const categories = canonical.classes.map((c) => {
    const cat: any = { id: c.id, name: c.name }
    if (hasKeypoints) {
      cat.keypoints = Array.from({ length: kpCount }, (_, i) => `k${i}`)
      cat.skeleton = skeleton
    }
    return cat
  })

  const images: any[] = []
  const annotations: any[] = []
  let imgSeq = 0
  let annSeq = 0
  for (const s of samples) {
    const { width, height } = fileDims(dataset, s.id)
    const id = ++imgSeq
    images.push({ id, file_name: s.sourcePath, width: Math.round(width), height: Math.round(height) })
    for (const ann of s.annotations) {
      const coco = toCocoAnn(ann, width, height)
      coco.id = ++annSeq
      coco.image_id = id
      annotations.push(coco)
    }
  }
  return JSON.stringify({ info: { description: 'Exported by dataset-manager' }, licenses: [], images, annotations, categories }, null, 2)
}

/**
 * 保存编辑：Tauri 写回原文件；浏览器下载脏文件 ZIP。
 * 返回写入/下载的文件数。
 */
export async function saveAnnotations(dataset: DataSet, dirtyFileIds: string[]): Promise<number> {
  const files = buildSaveFiles(dataset, dirtyFileIds)
  if (files.length === 0) return 0

  if (env === 'tauri') {
    let ok = 0
    for (const f of files) {
      if (!f.absPath) continue
      try {
        await invoke('write_text_file', { path: f.absPath, content: f.content })
        ok++
      } catch (e) {
        console.error('写回失败', f.absPath, e)
      }
    }
    return ok
  }

  // 浏览器：focused ZIP 下载（桌面端经 saveFile 弹保存对话框）
  const zip = new JSZip()
  for (const f of files) zip.file(f.relPath, f.content)
  const blob = await zip.generateAsync({ type: 'blob' })
  await saveFile(`${dataset.name || 'dataset'}-edited-annotations.zip`, blob, {
    title: '保存标注（编辑后）',
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })
  return files.length
}
