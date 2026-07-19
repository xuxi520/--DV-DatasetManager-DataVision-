/**
 * 模型输出（业界通用 JSON）导入为 PredictionSet 覆盖层。
 *
 * 支持的 JSON 形态（自动识别）：
 *  1) 数组形式（COCO predictions）：[{ image_id | file_name, category_id | class, bbox, score }, ...]
 *  2) 对象形式（通用）：{ "图片键": [ 检测..., ], ... }（顶层其余键视为元信息跳过）
 *  3) 信封形式：{ model, classes, bbox_format, predictions: [ { image, boxes: [...] } ] }
 *
 * 单条检测可含：class/label/category（字符串或类别 id）、bbox/box（4 数）、
 *               confidence/score/prob（0~1）、可选 points/polygon/segmentation（多边形）。
 *
 * bbox 归一化（经顶层 bbox_format 指定，缺省 auto 推断）：
 *  - 'yolo'      : [cx,cy,w,h] 归一化（已是规范坐标）
 *  - 'coco'      : [x,y,w,h] 像素左上角
 *  - 'tl_norm'   : [x,y,w,h] 归一化左上角
 *  - 'tl_px'     : [x,y,w,h] 像素左上角（等同 coco）
 *  - 'auto'      : 任一值 >1 视为像素左上角，否则视为归一化 YOLO 中心
 *
 * 预测覆盖层不回写 annotations，仅读取 samples 做路径对齐。
 */
import type { CanonicalAnnotation, CanonicalDataset, CanonicalSample, ClassDef } from '../dataset/types'
import { normSlash, baseName } from '../dataset/importers/shared'
import type { BboxFormat, PredictionItem, PredictionSample, PredictionSet } from './types'

function buildNameMap(classes: ClassDef[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of classes) {
    m.set(c.name.toLowerCase(), c.id)
    for (const a of c.aliases) m.set(a.toLowerCase(), c.id)
  }
  return m
}

/** 在数据集样本里按 key（相对路径 / 文件名）定位样本 */
function findSample(ds: CanonicalDataset, key: string): CanonicalSample | undefined {
  const k = normSlash(key.trim())
  const byPath = ds.samples.find((s) => normSlash(s.sourcePath) === k)
  if (byPath) return byPath
  const bySuffix = ds.samples.find((s) => normSlash(s.sourcePath).endsWith('/' + k))
  if (bySuffix) return bySuffix
  const kb = baseName(k)
  return ds.samples.find((s) => baseName(normSlash(s.sourcePath)) === kb)
}

/** 把 [x,y,w,h] 像素或归一化左上角 → 规范 [cx,cy,w,h] 归一化 */
function toCanonicalBbox(
  raw: number[],
  sample: CanonicalSample,
  fmt: Exclude<BboxFormat, 'auto'>,
): [number, number, number, number] {
  const [a, b, c, d] = raw
  if (fmt === 'yolo') return [a, b, c, d]
  const W = sample.width || 1
  const H = sample.height || 1
  if (fmt === 'tl_norm') return [a + c / 2, b + d / 2, c, d]
  // coco / tl_px：像素左上角
  return [(a + c / 2) / W, (b + d / 2) / H, c / W, d / H]
}

interface RawDetection {
  class?: string | number
  label?: string | number
  category?: string | number
  category_id?: number
  bbox?: number[]
  box?: number[]
  points?: number[]
  polygon?: number[]
  segmentation?: number[] | number[][]
  confidence?: number
  score?: number
  prob?: number
  type?: CanonicalAnnotation['type']
}

function detectFmt(raw: unknown, declared?: string): Exclude<BboxFormat, 'auto'> {
  if (declared === 'yolo' || declared === 'coco' || declared === 'tl_norm' || declared === 'tl_px') {
    return declared
  }
  if (Array.isArray(raw) && raw.length >= 4 && raw.slice(0, 4).some((n) => typeof n === 'number' && Math.abs(n) > 1)) {
    return 'coco'
  }
  return 'yolo'
}

function parseItem(
  d: RawDetection,
  nameMap: Map<string, number>,
  sample: CanonicalSample,
  fmt: Exclude<BboxFormat, 'auto'>,
): PredictionItem | null {
  // 类别解析：数字视为类别 id / 索引；字符串查 nameMap
  let classId: number | undefined
  const clsRaw = (d.class ?? d.label ?? d.category ?? d.category_id) as string | number | undefined
  if (clsRaw == null) return null
  if (typeof clsRaw === 'number') classId = clsRaw
  else classId = nameMap.get(String(clsRaw).toLowerCase())
  if (classId == null) return null

  const conf = (d.confidence ?? d.score ?? d.prob) as number | undefined
  const bbox = d.bbox ?? d.box
  const poly = d.points ?? d.polygon ?? (Array.isArray(d.segmentation) && Array.isArray(d.segmentation[0]) ? undefined : (d.segmentation as number[] | undefined))

  if (bbox && bbox.length === 4) {
    const [cx, cy, w, h] = toCanonicalBbox(bbox, sample, fmt)
    return { type: 'bbox', coords: [cx, cy, w, h], classId, confidence: conf }
  }
  if (poly && poly.length >= 6) {
    // 归一化多边形（若值普遍 >1 且样本尺寸可用，则按像素归一并平移中心）
    const coords = poly.map((n) => (fmt === 'coco' || fmt === 'tl_px') && sample.width ? n / (poly.length % 2 === 0 ? (isFinite(poly[0] as number) && (poly[0] as number) > 1 ? sample.width : 1) : 1) : n)
    return { type: 'polygon', coords: coords as number[], classId, confidence: conf }
  }
  return null
}

/** 解析单个模型输出的检测数组为 PredictionSample[]，并对齐样本 */
function buildSamples(
  rawRecords: { key: string; detections: RawDetection[]; probs?: number[] }[],
  ds: CanonicalDataset,
  nameMap: Map<string, number>,
  classOrder: string[],
  fmt: Exclude<BboxFormat, 'auto'>,
): PredictionSample[] {
  const out: PredictionSample[] = []
  for (const rec of rawRecords) {
    const sample = findSample(ds, rec.key)
    const sampleId = sample?.id ?? ''
    const items = rec.detections
      .map((d) => (sample ? parseItem(d, nameMap, sample, fmt) : null))
      .filter((x): x is PredictionItem => x != null)
    if (items.length === 0 && !rec.probs?.length) continue
    out.push({
      imagePath: rec.key,
      sampleId,
      items,
      classProbs: rec.probs,
    })
  }
  return out
}

/** 解析顶层 JSON，输出 { records, bboxFormat, classOrder } */
function extractRecords(
  data: any,
  ds: CanonicalDataset,
): { records: { key: string; detections: RawDetection[]; probs?: number[] }[]; bboxFormat: string | undefined; classOrder: string[] } {
  const declaredFmt = typeof data?.bbox_format === 'string' ? data.bbox_format : undefined
  const classOrder: string[] = Array.isArray(data?.classes)
    ? data.classes.map((c: any) => String(c))
    : ds.classes.map((c) => c.name)

  // 严格 COCO API：顶层 images 数组把数值 image_id → file_name。
  // 预测里若用 image_id（数字）而非 file_name，则经此映射还原成文件名，
  // 以便后续按 sourcePath / 文件名对齐数据集样本。
  const imageIdMap = new Map<string, string>()
  if (Array.isArray(data?.images)) {
    for (const img of data.images as any[]) {
      if (img?.id != null && img.file_name) imageIdMap.set(String(img.id), String(img.file_name))
    }
  }
  const resolveKey = (raw: any): string => {
    if (raw?.file_name) return String(raw.file_name)
    if (raw?.image_path) return String(raw.image_path)
    if (raw?.image) return String(raw.image)
    if (raw?.image_id != null) {
      const mapped = imageIdMap.get(String(raw.image_id))
      if (mapped) return mapped
      return String(raw.image_id)
    }
    return ''
  }

  // 1) COCO predictions 数组（顶层即数组）
  if (Array.isArray(data)) {
    const records = new Map<string, RawDetection[]>()
    for (const det of data as any[]) {
      const key = resolveKey(det)
      if (!key) continue
      const d: RawDetection = {
        category_id: det.category_id,
        class: det.category_id,
        bbox: det.bbox,
        segmentation: det.segmentation,
        score: det.score,
        confidence: det.score,
      }
      const arr = records.get(key) ?? []
      arr.push(d)
      records.set(key, arr)
    }
    return {
      records: [...records.entries()].map(([key, detections]) => ({ key, detections })),
      bboxFormat: declaredFmt,
      classOrder,
    }
  }

  // 2) 信封形式：predictions 数组
  if (Array.isArray(data?.predictions)) {
    const records = (data.predictions as any[]).map((p) => ({
      key: resolveKey(p),
      detections: (p.boxes ?? p.detections ?? p.annotations ?? p.predictions ?? []) as RawDetection[],
      probs: p.probs as number[] | undefined,
    }))
    return { records, bboxFormat: declaredFmt, classOrder }
  }

  // 3) 对象映射形式：顶层每个「值为数组」的键当作一张图的检测列表
  //    跳过已知的元信息键，避免 classes/model 等被误当作检测
  const META_KEYS = new Set(['model', 'classes', 'bbox_format', 'predictions', 'annotations', 'images', 'schemaVersion', 'probs'])
  const records: { key: string; detections: RawDetection[]; probs?: number[] }[] = []
  for (const [key, val] of Object.entries(data)) {
    if (META_KEYS.has(key)) continue
    if (Array.isArray(val)) {
      records.push({ key, detections: val as RawDetection[] })
    }
  }
  return { records, bboxFormat: declaredFmt, classOrder }
}

/**
 * 把模型输出的 JSON 文本解析为 PredictionSet。
 * @returns 解析结果与未对齐数量（用于 UI 提示）
 */
export function importPredictionsJson(
  text: string,
  ds: CanonicalDataset,
  sourceName: string,
): { set: PredictionSet; unmatched: number; totalDetections: number } {
  const data = JSON.parse(text)
  const nameMap = buildNameMap(ds.classes)
  const { records, bboxFormat, classOrder } = extractRecords(data, ds)
  const fmt = detectFmt(records[0]?.detections[0]?.bbox, bboxFormat) as Exclude<BboxFormat, 'auto'>
  const samples = buildSamples(records, ds, nameMap, classOrder, fmt)

  const predictions = new Map<string, PredictionSample>()
  let unmatched = 0
  let totalDetections = 0
  for (const s of samples) {
    predictions.set(s.imagePath, s)
    totalDetections += s.items.length
    if (!s.sampleId) unmatched++
  }

  const set: PredictionSet = {
    datasetId: '',
    sourceName,
    predictions,
    classOrder,
    bboxFormat: (bboxFormat as BboxFormat) ?? 'auto',
    importedAt: Date.now(),
  }
  return { set, unmatched, totalDetections }
}
