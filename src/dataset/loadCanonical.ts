/**
 * 数据集加载（统一管线入口）
 *
 * 把「浏览器目录选择」接进 src/dataset 的规范中间模型（importDataset），
 * 再将 CanonicalDataset 适配成现有 UI 所消费的 DataSet / ParsedAnnotation 结构，
 * 从而使浏览、去重、重划分、导出共用同一份归一化数据。
 *
 * 流程：
 *   pickDirectoryBrowser → readDirBrowser → VirtualFile[] → importDataset
 *   → 逐样本读字节/取尺寸/生成缩略图 → CanonicalDataset → DataSet + ParsedAnnotation
 */

import {
  pickDirectoryBrowser,
  readDirBrowser,
  parseImageSize,
} from '../env'
import { importDataset } from './importers'
import type { VirtualFile } from './importers/shared'
import type {
  CanonicalDataset,
  CanonicalSample,
} from './types'
import type { DataSet, ImageFile, ParsedAnnotation } from '../types'

/** 类别调色板（与旧 loader 一致，按顺序分配，保证稳定） */
const CATEGORY_COLOR_LIST = [
  '#F59E0B', '#3B82F6', '#10B981', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
]

export type ProgressFn = (current: number, total: number, status: string) => void

export interface CanonicalLoadResult {
  /** 适配后的 UI 数据集（含 canonical 字段，供后续去重/重划分/导出） */
  dataset: DataSet
  /** 以 ImageFile.path 为键的标注表 */
  annotations: Map<string, ParsedAnnotation[]>
  /** 类别名 -> 颜色 */
  categoryColors: Map<string, string>
  /** 规范中间模型（唯一数据源） */
  canonical: CanonicalDataset
  /** 导入过程中的告警（缺标签、类越界、大小写冲突等） */
  warnings: string[]
}

/** 浏览器目录句柄 -> VirtualFile[]（路径相对根，如 train/images/x.jpg） */
function toVirtualFiles(
  entries: { path: string; file: File }[]
): VirtualFile[] {
  return entries.map(({ path, file }) => ({
    path,
    getText: () => file.text(),
    getBytes: async () => new Uint8Array(await file.arrayBuffer()),
  }))
}

function fileName(p: string): string {
  return p.split('/').pop() || p
}

function uid(): string {
  return 'ds_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * 把单个规范样本的标注转换为 UI 用的 ParsedAnnotation。
 * 规范模型里 bbox 统一为「归一化 [cx,cy,w,h]」，这里换算成 UI 渲染所需的
 * 「归一化 [x_tl, y_tl, w, h]」（与旧 parseYolo 输出一致），normalized=true。
 * polygon / segmentation 的 coords 为平铺的归一化点序列 [(x,y),...]。
 */
export function sampleToAnnotations(
  sample: CanonicalSample,
  dataset: CanonicalDataset,
  colors: Map<string, string>
): ParsedAnnotation[] {
  return sample.annotations.map((a) => {
    const cls = dataset.classes[a.classId]
    const category = cls ? cls.name : `class_${a.classId}`
    const color = colors.get(category) || '#909399'

    if (a.type === 'bbox') {
      const [cx, cy, w, h] = a.coords
      return {
        type: 'bbox',
        bbox: [cx - w / 2, cy - h / 2, w, h],
        category,
        normalized: true,
        color,
        description: a.description,
        confidence: a.confidence,
      } as ParsedAnnotation
    }

    // polygon / segmentation：平铺点序列 -> [(x,y),...]
    const pts: [number, number][] = []
    for (let i = 0; i + 1 < a.coords.length; i += 2) {
      pts.push([a.coords[i], a.coords[i + 1]])
    }
    return {
      type: 'polygon',
      points: pts,
      category,
      normalized: true,
      color,
      description: a.description,
      confidence: a.confidence,
    } as ParsedAnnotation
  })
}

/** 主入口：选择目录并以规范模型加载，返回 UI 就绪的数据 */
export async function loadDatasetCanonical(
  onProgress?: ProgressFn
): Promise<CanonicalLoadResult> {
  const handle = await pickDirectoryBrowser()
  if (!handle) throw new Error('用户取消选择')

  onProgress?.(5, 100, '正在扫描文件...')
  const entries = await readDirBrowser(handle)
  onProgress?.(15, 100, `找到 ${entries.length} 个文件，正在识别格式...`)

  const vfiles = toVirtualFiles(entries)
  const canonical = await importDataset(vfiles)
  onProgress?.(
    50,
    100,
    `识别为 ${canonical.sourceFormat} 格式，正在读取图片...`
  )

  const categoryColors = new Map<string, string>()
  canonical.classes.forEach((c, i) => {
    categoryColors.set(c.name, CATEGORY_COLOR_LIST[i % CATEGORY_COLOR_LIST.length])
  })

  const fileList: ImageFile[] = []
  const files = new Map<string, ImageFile>()
  const annotations = new Map<string, ParsedAnnotation[]>()

  const total = canonical.samples.length

  for (let i = 0; i < total; i++) {
    const s = canonical.samples[i]
    const key = s.id
    let blob: Blob | undefined
    let width = 0
    let height = 0

    try {
      const bytes = await s.getBytes()
      if (bytes.length > 0) {
        blob = new Blob([bytes])
        // 从字节头部解析尺寸，零解码（主线程零开销，超低延迟加载）
        const dims = parseImageSize(bytes)
        width = dims?.width ?? 0
        height = dims?.height ?? 0
      }
    } catch {
      // 损坏图片或 COCO 缺图：跳过尺寸，保留样本占位
    }

    const imgFile: ImageFile = {
      id: key,
      name: fileName(s.sourcePath) || key,
      // path 使用真实相对路径：Tauri 下删除 / 读字节依赖真实路径
      path: s.sourcePath,
      size: blob ? blob.size : 0,
      width,
      height,
      blob,
      url: blob ? URL.createObjectURL(blob) : undefined,
    }

    fileList.push(imgFile)
    files.set(key, imgFile)
    annotations.set(key, sampleToAnnotations(s, canonical, categoryColors))

    if (i % 30 === 0) {
      onProgress?.(
        50 + Math.round(((i + 1) / total) * 40),
        100,
        `正在读取图片 (${i + 1}/${total})`
      )
    }
  }

  const dataset: DataSet = {
    id: uid(),
    name: handle.name,
    files,
    fileList,
    totalCount: total,
    dupCount: 0,
    uniqueCount: total,
  }
  // 挂载规范中间模型，供去重 / 重划分 / 导出共享同一份数据
  dataset.canonical = canonical

  onProgress?.(100, 100, '加载完成！')
  return { dataset, annotations, categoryColors, canonical, warnings: canonical.warnings }
}
