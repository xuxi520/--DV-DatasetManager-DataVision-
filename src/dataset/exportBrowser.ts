/**
 * 浏览器端导出（统一管线出口）
 *
 * 消费 CanonicalDataset（唯一数据源），复用 src/dataset/exporters 生成规范目录，
 * 再用 jszip 打包为单个 ZIP 下载。COCO/VOC 需绝对像素坐标时用 dimsReader 解码尺寸。
 *
 * 重划分（rebalanceSplits）在一份克隆上进行，避免污染正在浏览的数据集 split；
 * 若用户希望把重划分结果落到当前浏览视图，可另行 applyRebalance。
 */

import JSZip from 'jszip'
import { getImageDimensions } from '../env'
import { exportYolo, exportCoco, exportVoc } from './exporters'
import type { ExportFile } from './exporters'
import type { NamingPolicy } from './naming'
import { rebalanceSplits, splitCounts } from './split'
import type { SplitTargets, ReSplitOptions } from './split'
import type { CanonicalDataset, SplitKey } from './types'

export type ExportFormat = 'yolo' | 'coco' | 'voc'

export { splitCounts, rebalanceSplits }
export type { SplitTargets, ReSplitOptions, SplitKey, NamingPolicy }

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
  policy: NamingPolicy
): Promise<ExportFile[]> {
  const opts = { dimsReader }
  if (format === 'yolo') return exportYolo(ds, policy, opts)
  if (format === 'coco') return exportCoco(ds, policy, opts)
  return exportVoc(ds, policy, opts)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export interface ExportZipOptions {
  format: ExportFormat
  policy: NamingPolicy
  datasetName?: string
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
  const files = await runExporter(ds, opts.format, opts.policy)

  // 3) 打包
  onProgress?.(55, `正在打包 ${files.length} 个文件...`)
  const zip = new JSZip()
  const root = `${safe(opts.datasetName ?? '')}_${opts.format}`
  for (const f of files) zip.file(`${root}/${f.path}`, f.bytes)

  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => {
      onProgress?.(55 + Math.round(meta.percent * 0.4), `压缩中 ${meta.percent.toFixed(0)}%`)
    }
  )

  downloadBlob(blob, `${root}_${Date.now()}.zip`)
  onProgress?.(100, '导出完成')
  return files.length
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
