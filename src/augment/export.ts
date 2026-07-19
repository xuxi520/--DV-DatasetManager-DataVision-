/**
 * 增强数据集导出：把预览用的增强引擎落地为「增强扩增数据集」生成。
 *
 * 设计：
 * - 复用预览引擎 transforms.applyAugmentationChain（单一仿射同时作用于像素与标注，保证框/点/多边形对齐）。
 * - 每张原图按策略生成 N 份增强变体（固定链路 / 随机子集 + 随机参数）。
 * - 变体 canvas 落盘为图片字节；变换后的 ParsedAnnotation 转回 CanonicalAnnotation。
 * - 与「原图」合并后复用 annotationIO.buildSaveFiles 序列化标注（YOLO/COCO/VOC/DOTA/LabelMe 全格式），
 *   再按 images/ + labels/ 布局写出（Tauri 写所选目录 / 浏览器打包 ZIP）。
 */
import { env, pickDirectoryTauri } from '../env'
import { sampleToAnnotations } from '../dataset/loadCanonical'
import { buildSaveFiles } from '../dataset/annotationIO'
import { packZip, downloadZip, writeFilesBatchTauri } from '../dataset/exportCore'
import { readPathsBytes } from '../dedup/fileOps'
import { normSlash } from '../dataset/importers/shared'
import { applyAugmentationChain, AUG_MAP, type AugId, type AugStep } from './transforms'
import { decodeImageFile } from './decode'
import type {
  CanonicalDataset, CanonicalSample, CanonicalAnnotation,
} from '../dataset/types'
import type { DataSet, ParsedAnnotation, ImageFile } from '../types'
import type { ExportFormat } from '../dataset/exportBrowser'

export interface AugStepConfig {
  id: AugId
  enabled: boolean
  param: number
}

export interface AugPolicy {
  steps: AugStepConfig[]
  strategy: 'fixed' | 'random'
  copies: number
  outFormat: ExportFormat
  imageExt: 'jpg' | 'png'
  includeOriginals: boolean
}

export type AugProgressFn = (pct: number, status: string) => void

// ---------- 工具 ----------

function baseName(p: string): string {
  const f = p.replace(/\\/g, '/').split('/').pop() || ''
  const i = f.lastIndexOf('.')
  return i < 0 ? f : f.slice(0, i)
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function safeName(s: string): string {
  return (s || 'dataset').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'dataset'
}

/** 由启用的增强项 + 策略生成本次应用的步骤序列 */
function buildSteps(policy: AugPolicy): AugStep[] {
  const enabled = policy.steps.filter((s) => s.enabled)
  if (enabled.length === 0) return []
  if (policy.strategy === 'fixed') {
    return enabled.map((s) => ({ id: s.id, param: s.param }))
  }
  // 随机：乱序后取 1..N 个子集，参数在定义范围内随机取值
  const shuffled = [...enabled].sort(() => Math.random() - 0.5)
  const k = 1 + Math.floor(Math.random() * enabled.length)
  return shuffled.slice(0, k).map((s) => {
    const def = AUG_MAP[s.id]
    const param = def.param ? randRange(def.param.min, def.param.max) : 0
    return { id: s.id, param }
  })
}

/** ParsedAnnotation（预览归一化，bbox 为 [x_tl,y_tl,w,h]）-> CanonicalAnnotation */
function parsedToCanonical(ann: ParsedAnnotation): CanonicalAnnotation | null {
  const base = {
    classId: ann.classId ?? 0,
    description: ann.description,
    confidence: ann.confidence,
  }
  if (ann.type === 'bbox' || ann.type === 'obb' || ann.bboxType === 'obb') {
    if (!ann.bbox) return null
    const [x, y, bw, bh] = ann.bbox
    const cx = x + bw / 2
    const cy = y + bh / 2
    if (ann.type === 'obb' || ann.bboxType === 'obb') {
      const pts = ann.points
      if (pts && pts.length >= 4) {
        const fit = fitObbFromCorners(pts)
        return { type: 'obb', coords: fit, rotation: fit[4], ...base }
      }
      return { type: 'obb', coords: [cx, cy, bw, bh], rotation: ann.rotation ?? 0, ...base }
    }
    return { type: 'bbox', coords: [cx, cy, bw, bh], ...base }
  }
  if (ann.type === 'keypoint') {
    if (!ann.keypoints) return null
    const coords: number[] = []
    for (const k of ann.keypoints) coords.push(k.x, k.y, k.v)
    return { type: 'keypoints', coords, edges: ann.edges ? [...ann.edges] : undefined, ...base }
  }
  if (ann.type === 'mask') {
    const coords: number[] = []
    if (ann.points) for (const p of ann.points) coords.push(p[0], p[1])
    return {
      type: 'mask',
      coords,
      rle: ann.rle ? { size: [...ann.rle.size], counts: ann.rle.counts } : undefined,
      iscrowd: ann.iscrowd,
      ...base,
    }
  }
  if (ann.points) {
    const coords: number[] = []
    for (const p of ann.points) coords.push(p[0], p[1])
    return { type: 'polygon', coords, ...base }
  }
  return null
}

/** 由 4 个角点（归一化，顺序 TL,TR,BR,BL）拟合 [cx,cy,w,h,rotation(弧度 CCW)] */
function fitObbFromCorners(pts: [number, number][]): [number, number, number, number, number] {
  const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4
  const cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4
  const e0x = pts[1][0] - pts[0][0]
  const e0y = pts[1][1] - pts[0][1]
  const e1x = pts[3][0] - pts[0][0]
  const e1y = pts[3][1] - pts[0][1]
  const w = Math.hypot(e0x, e0y)
  const h = Math.hypot(e1x, e1y)
  const rotation = Math.atan2(e0y, e0x)
  return [cx, cy, w, h, rotation]
}

function encodeCanvas(canvas: HTMLCanvasElement, ext: 'jpg' | 'png'): Promise<Uint8Array> {
  const type = ext === 'jpg' ? 'image/jpeg' : 'image/png'
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) return reject(new Error('canvas 编码失败'))
        const buf = await blob.arrayBuffer()
        resolve(new Uint8Array(buf))
      },
      type,
      ext === 'jpg' ? 0.92 : undefined,
    )
  })
}

async function getOriginalImageBytes(ds: DataSet, sample: CanonicalSample): Promise<Uint8Array | null> {
  if (env === 'tauri') {
    const root = ds.rootAbsPath
    if (!root) return null
    const abs = `${normSlash(root)}/${sample.sourcePath}`
    const byAbs = await readPathsBytes([abs])
    return byAbs.get(abs) || null
  }
  const f = ds.fileList.find((x) => x.id === sample.id)
  if (!f) return null
  if (f.sourceFile) return new Uint8Array(await f.sourceFile.arrayBuffer())
  if (f.blob) return new Uint8Array(await f.blob.arrayBuffer())
  if (f.url) {
    const r = await fetch(f.url)
    const b = await r.blob()
    return new Uint8Array(await b.arrayBuffer())
  }
  return null
}

/** 标注相对路径归一化：yolo/voc/dota/labelme 统一落到 labels/，coco 保留 annotations/ */
function relabelPath(rel: string, format: ExportFormat): string {
  if (format === 'coco') return rel
  const base = rel.split('/').pop() || rel
  return `labels/${base}`
}

// ---------- 主流程 ----------

/**
 * 对数据集应用增强策略并生成「增强扩增数据集」。
 * @returns 写出/打包的文件总数
 */
export async function runAugmentExport(
  src: { ds: DataSet; canonical: CanonicalDataset },
  policy: AugPolicy,
  onProgress?: AugProgressFn,
): Promise<number> {
  const { ds, canonical } = src
  const samples = canonical.samples
  if (samples.length === 0) throw new Error('数据集中没有可增强的图片')
  if (policy.copies < 1) throw new Error('每图生成份数必须 ≥ 1')
  if (policy.steps.filter((s) => s.enabled).length === 0) throw new Error('请至少启用一种增强')

  const idToFile = new Map<string, ImageFile>()
  for (const f of ds.fileList) idToFile.set(f.id, f)

  const ext = policy.imageExt
  const augSamples: CanonicalSample[] = []
  const augImageBytes = new Map<string, Uint8Array>()

  const total = samples.length * policy.copies
  let done = 0
  const tick = (status: string) => {
    done++
    onProgress?.(Math.round((done / total) * 90), status)
  }

  for (const sample of samples) {
    const file = idToFile.get(sample.id)
    if (!file) {
      for (let c = 0; c < policy.copies; c++) tick(`跳过无法定位的原图 ${sample.sourcePath}`)
      continue
    }
    let img: HTMLImageElement
    try {
      img = await decodeImageFile(file)
    } catch {
      for (let c = 0; c < policy.copies; c++) tick(`解码失败，跳过 ${sample.sourcePath}`)
      continue
    }

    const parsed = sampleToAnnotations(sample, canonical, new Map<string, string>())

    for (let c = 0; c < policy.copies; c++) {
      const steps = buildSteps(policy)
      const result = applyAugmentationChain(img, parsed, steps)
      if (!result) { tick('无增强步骤，跳过'); continue }

      const outName = `${baseName(sample.sourcePath)}_aug${c + 1}`
      const bytes = await encodeCanvas(result.canvas, ext)
      const anns = result.annotations
        .map((a) => parsedToCanonical(a))
        .filter((a): a is CanonicalAnnotation => a !== null)

      const id = `aug_${sample.id}_${c + 1}`
      augSamples.push({
        id,
        sourcePath: `images/${outName}.${ext}`,
        split: sample.split,
        category: sample.category,
        imageExt: `.${ext}`,
        getBytes: async () => bytes,
        annotations: anns,
        width: result.width,
        height: result.height,
      })
      augImageBytes.set(id, bytes)
      tick(`增强中 ${done + 1}/${total}`)
    }
  }

  // 合并原图（可选）
  const combinedSamples: CanonicalSample[] = [...augSamples]
  if (policy.includeOriginals) {
    for (const s of samples) {
      const f = ds.fileList.find((x) => x.id === s.id)
      combinedSamples.push({
        ...s,
        width: s.width || f?.width || 0,
        height: s.height || f?.height || 0,
      })
    }
  }

  // 序列化标注（复用 annotationIO，覆盖全部格式）
  const syntheticDs: DataSet = {
    id: 'aug',
    name: ds.name || 'augmented',
    files: new Map(),
    fileList: combinedSamples.map((s) => ({
      id: s.id,
      name: s.sourcePath,
      path: s.sourcePath,
      size: 0,
      width: s.width || 0,
      height: s.height || 0,
    })),
    totalCount: combinedSamples.length,
    dupCount: 0,
    uniqueCount: combinedSamples.length,
    canonical: {
      classes: canonical.classes,
      samples: combinedSamples,
      sourceFormat: policy.outFormat,
      warnings: [],
    },
    rootAbsPath: ds.rootAbsPath,
    labelRootAbsPath: ds.labelRootAbsPath,
  }

  onProgress?.(92, '正在序列化标注...')
  const labelFiles = buildSaveFiles(syntheticDs, combinedSamples.map((s) => s.id))

  // 原图字节（追加原图时需要）
  const originalBytes = new Map<string, Uint8Array>()
  if (policy.includeOriginals) {
    onProgress?.(95, '正在读取原图字节...')
    for (const s of samples) {
      const b = await getOriginalImageBytes(ds, s)
      if (b) originalBytes.set(s.id, b)
    }
  }

  // 汇总写出文件
  const imageFiles: { rel: string; bytes: Uint8Array }[] = []
  for (const s of augSamples) {
    const b = augImageBytes.get(s.id)
    if (b) imageFiles.push({ rel: s.sourcePath, bytes: b })
  }
  if (policy.includeOriginals) {
    for (const s of samples) {
      const b = originalBytes.get(s.id)
      if (b) imageFiles.push({ rel: `images/${baseName(s.sourcePath)}${s.imageExt}`, bytes: b })
    }
  }

  const fileCount = imageFiles.length + labelFiles.length

  // 汇总待写出文件（图片 + 标注）；图片字节直接以 Uint8Array 保留（Tauri 二进制载荷 / ZIP STORE）
  const outFiles: { rel: string; bytes: Uint8Array }[] = []
  for (const im of imageFiles) outFiles.push({ rel: im.rel, bytes: im.bytes })
  for (const lf of labelFiles) outFiles.push({ rel: relabelPath(lf.relPath, policy.outFormat), bytes: new TextEncoder().encode(lf.content) })

  if (env === 'tauri') {
    const outDir = await pickDirectoryTauri()
    if (!outDir) return 0
    // 一次 IPC 批量写盘：图片字节直接传 Uint8Array（Tauri v2 二进制载荷），替代逐文件 Array.from + N 次往返
    await writeFilesBatchTauri(outDir, outFiles)
    onProgress?.(100, '导出完成')
    return fileCount
  }

  // 浏览器：打包 ZIP 下载（图片已压缩，packZip 内走 STORE 跳过 DEFLATE 重压以省 CPU）
  const blob = await packZip(outFiles.map((f) => ({ path: f.rel, bytes: f.bytes })))
  await downloadZip(blob, `${safeName(ds.name || 'dataset')}_augmented_${Date.now()}.zip`)
  onProgress?.(100, '导出完成')
  return fileCount
}
