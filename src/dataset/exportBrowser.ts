/**
 * 浏览器端导出（统一管线出口）
 *
 * 消费 CanonicalDataset（唯一数据源），复用 src/dataset/exporters 生成规范目录，
 * 再用 jszip 打包为单个 ZIP 下载。COCO/VOC 需绝对像素坐标时用 dimsReader 解码尺寸。
 *
 * 重划分（rebalanceSplits）在一份克隆上进行，避免污染正在浏览的数据集 split；
 * 若用户希望把重划分结果落到当前浏览视图，可另行 applyRebalance。
 */

import { getImageDimensions, env } from '../env'
import { normSlash } from './importers/shared'
import { readPathsBytes } from '../dedup/fileOps'
import { exportYolo, exportCoco, exportVoc, exportDota } from './exporters'
import type { ExportFile } from './exporters'
import { packZip, downloadZip } from './exportCore'
import type { NamingPolicy } from './naming'
import { rebalanceSplits, splitCounts } from './split'
import type { SplitTargets, ReSplitOptions } from './split'
import type { CanonicalDataset, SplitKey } from './types'
import {
  generateTrainingConfigFiles,
  datasetFormatForFramework,
  type TrainingFramework,
  type TrainingHyper,
} from './trainingConfig'

export type ExportFormat = 'yolo' | 'coco' | 'voc' | 'dota'

export { splitCounts, rebalanceSplits }
export type { SplitTargets, ReSplitOptions, SplitKey, NamingPolicy }
export type { TrainingFramework, TrainingHyper } from './trainingConfig'
export { frameworkLabel } from './trainingConfig'

/** 标注 CSV / JSON 导出（IExportService 落地项） */
export { exportAnnotations } from './exportAnnotations'
export type { AnnotationFormat, AnnotationExportOptions } from './exportAnnotations'

/** 用图片字节解码尺寸（COCO/VOC 换算像素坐标用） */
async function dimsReader(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const blob = new Blob([bytes])
  return getImageDimensions(blob)
}

/** 清洗为安全文件名片段 */
function safe(s: string): string {
  return (s || 'dataset').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'dataset'
}

/**
 * 浅克隆 canonical：复制 samples 数组与每个 sample（split 为原始值），
 * 使重划分改动隔离在克隆上，不影响正在浏览的原数据集。
 * annotations / getBytes 等按引用共享（只读，安全）。
 */
export function cloneCanonical(ds: CanonicalDataset): CanonicalDataset {
  return {
    ...ds,
    classes: ds.classes.map((c) => ({ ...c })),
    samples: ds.samples.map((s) => ({ ...s })),
  }
}

async function runExporter(
  ds: CanonicalDataset,
  format: ExportFormat,
  policy: NamingPolicy,
  imageRootAbs?: string
): Promise<ExportFile[]> {
  // Tauri：导出前一次性批量读出所有图片字节（分块 IPC），避免逐个 sample 的 N 次往返
  let imageBytesMap: Map<string, Uint8Array> | undefined
  if (env === 'tauri' && imageRootAbs) {
    const root = normSlash(imageRootAbs)
    const absPaths = ds.samples.map((s) => `${root}/${s.sourcePath}`)
    const byAbs = await readPathsBytes(absPaths)
    imageBytesMap = new Map()
    ds.samples.forEach((s, i) => {
      const b = byAbs.get(absPaths[i])
      if (b) imageBytesMap!.set(s.sourcePath, b)
    })
  }
  const opts = { dimsReader, imageBytesMap }
  if (format === 'yolo') return exportYolo(ds, policy, opts)
  if (format === 'coco') return exportCoco(ds, policy, opts)
  if (format === 'dota') return exportDota(ds, policy, opts)
  return exportVoc(ds, policy, opts)
}

export interface ExportZipOptions {
  format: ExportFormat
  policy: NamingPolicy
  datasetName?: string
  /** Tauri 端：数据集根目录绝对路径，用于批量读出图片字节（消除逐图 IPC 往返） */
  imageRootAbs?: string
  /** 若提供则先在克隆上按比例重划分，再导出 */
  rebalance?: { targets: SplitTargets; options?: ReSplitOptions }
}

export type ExportProgressFn = (pct: number, status: string) => void

/**
 * 生成并下载数据集 ZIP。
 * @returns 导出的文件数量
 */
export async function exportDatasetZip(
  source: CanonicalDataset,
  opts: ExportZipOptions,
  onProgress?: ExportProgressFn
): Promise<number> {
  // 1) 克隆并（可选）重划分，隔离对原数据集的影响
  const ds = cloneCanonical(source)
  if (opts.rebalance) {
    onProgress?.(5, '正在按比例重新划分子集...')
    rebalanceSplits(ds, opts.rebalance.targets, opts.rebalance.options)
  }

  // 2) 生成规范目录文件
  onProgress?.(15, '正在生成导出文件（读图 / 换算坐标）...')
  const files = await runExporter(ds, opts.format, opts.policy, opts.imageRootAbs)

  // 3) 打包
  onProgress?.(55, `正在打包 ${files.length} 个文件...`)
  const root = `${safe(opts.datasetName ?? '')}_${opts.format}`
  const blob = await packZip(files, root, (p) =>
    onProgress?.(55 + Math.round(p * 0.4), `压缩中 ${p.toFixed(0)}%`),
  )

  await downloadZip(blob, `${root}_${Date.now()}.zip`)
  onProgress?.(100, '导出完成')
  return files.length
}

export interface TrainingConfigExportOptions {
  framework: TrainingFramework
  datasetName?: string
  policy: NamingPolicy
  /** Tauri 端：数据集根目录绝对路径，用于批量读出图片字节 */
  imageRootAbs?: string
  /** 训练超参（模型规模 / epochs / imgsz / batch / lr 等），缺省走合理默认 */
  hyper?: TrainingHyper
  /** 若提供则先在克隆上按比例重划分，再导出 */
  rebalance?: { targets: SplitTargets; options?: ReSplitOptions }
}

/**
 * 生成训练框架工程配置 ZIP：数据（按框架匹配格式）+ 工程配置 + 类别 yaml/txt。
 * - YOLOv8   → YOLO 格式数据 + data.yaml + train.py
 * - MMDetection / Detectron2 → COCO 格式数据 + 各自配置 + classes.txt
 *
 * @returns 导出文件数量
 */
export async function exportTrainingConfig(
  source: CanonicalDataset,
  opts: TrainingConfigExportOptions,
  onProgress?: ExportProgressFn
): Promise<number> {
  const ds = cloneCanonical(source)
  if (opts.rebalance) {
    onProgress?.(5, '正在按比例重新划分子集...')
    rebalanceSplits(ds, opts.rebalance.targets, opts.rebalance.options)
  }

  onProgress?.(15, '正在生成数据集文件（读图 / 换算坐标）...')
  const fmt = datasetFormatForFramework(opts.framework)
  let dataFiles = await runExporter(ds, fmt, opts.policy, opts.imageRootAbs)

  onProgress?.(45, '正在生成训练工程配置...')
  const configFiles = generateTrainingConfigFiles({
    framework: opts.framework,
    datasetName: opts.datasetName ?? 'dataset',
    classes: ds.classes.map((c) => c.name),
    splitCounts: splitCounts(ds),
    hyper: opts.hyper,
  })

  // YOLOv8 用自带的 data.yaml 覆盖 exportYolo 生成的（Ultralytics 约定 path:'./'）
  let dataList = dataFiles
  if (opts.framework === 'yolov8') {
    dataList = dataFiles.filter((f) => f.path !== 'data.yaml')
  }

  const merged = [...dataList, ...configFiles]

  onProgress?.(60, `正在打包 ${merged.length} 个文件...`)
  const root = `${safe(opts.datasetName ?? 'dataset')}_${opts.framework}`
  const blob = await packZip(merged, root, (p) =>
    onProgress?.(60 + Math.round(p * 0.38), `压缩中 ${p.toFixed(0)}%`),
  )

  await downloadZip(blob, `${root}_${Date.now()}.zip`)
  onProgress?.(100, '导出完成')
  return merged.length
}

/**
 * 预览重划分结果（不改动原数据集）：返回重划分后的各子集数量。
 */
export function previewRebalance(
  source: CanonicalDataset,
  targets: SplitTargets,
  options?: ReSplitOptions
): Record<SplitKey, number> {
  const ds = cloneCanonical(source)
  rebalanceSplits(ds, targets, options)
  return splitCounts(ds)
}
