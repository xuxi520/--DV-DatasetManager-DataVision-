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
  env,
  pickDirectoryBrowser,
  pickDirectoryTauri,
  readDirBrowser,
  parseImageSize,
} from '../env'
import { importDataset, detectDatasetFormat } from './importers'
import type { VirtualFile } from './importers/shared'
import { normSlash } from './importers/shared'
import { collectAnnotationCandidates } from './annotationCandidates'
import type { AnnotationCandidate } from './annotationCandidates'
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

/**
 * 取图尺寸时只读取的头部字节上限（256KB）。
 * parseImageSize 仅靠文件头 16~30 字节即可解析尺寸（零解码），
 * 该切片为惰性读取（File.slice 不加载整图），可覆盖含 EXIF 的常规 JPEG/PNG/WebP。
 * 极少数 EXIF 极长 / 罕见格式解析不到时，再回退读全量字节保正确性。
 */
const HEADER_READ_LIMIT = 256 * 1024

export type ProgressFn = (current: number, total: number, status: string) => void

/**
 * 标注文件选择器（由 UI 层注入）。当 COCO 目录下存在多个候选标注文件时调用，
 * 返回用户选中的相对路径数组（可多选叠加），或 null 表示取消加载。
 * 未注入（测试 / 静默恢复）时不弹窗，走默认/合并行为。
 */
export type AnnotationChooser = (
  candidates: AnnotationCandidate[],
) => Promise<string[] | null>
let annotationChooser: AnnotationChooser | null = null
export function setAnnotationChooser(fn: AnnotationChooser | null): void {
  annotationChooser = fn
}

/**
 * 解析最终用于导入的标注文件过滤集合：
 * - 显式指定（annotationFilter）时直接采用，跳过选择弹窗；
 * - 静默 / 无 UI 注入时不弹窗；
 * - 否则当候选多于 1 个时调用 UI 选择，用户取消则抛出以中止加载。
 */
async function resolveAnnotationFilter(
  vfiles: VirtualFile[],
  explicit?: string[],
  silent?: boolean,
): Promise<Set<string> | undefined> {
  if (explicit !== undefined) {
    return explicit.length ? new Set(explicit.map(normSlash)) : undefined
  }
  if (silent || !annotationChooser) return undefined
  const candidates = await collectAnnotationCandidates(vfiles)
  if (candidates.length <= 1) return undefined
  const chosen = await annotationChooser(candidates)
  if (chosen === null) throw new Error('用户取消选择')
  return chosen.length ? new Set(chosen.map(normSlash)) : undefined
}

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
    size: file.size,
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
        classId: a.classId,
        normalized: true,
        color,
        description: a.description,
        confidence: a.confidence,
      } as ParsedAnnotation
    }

    if (a.type === 'obb') {
      const [cx, cy, w, h] = a.coords
      const angle = a.rotation ?? 0
      const corners = obbCorners(cx, cy, w, h, angle)
      return {
        type: 'obb',
        bbox: [cx - w / 2, cy - h / 2, w, h],
        points: corners,
        rotation: angle,
        bboxType: 'obb',
        category,
        classId: a.classId,
        normalized: true,
        color,
        description: a.description,
        confidence: a.confidence,
      } as ParsedAnnotation
    }

    if (a.type === 'keypoints') {
      const kps: { x: number; y: number; v: number }[] = []
      for (let i = 0; i + 2 < a.coords.length; i += 3) {
        kps.push({ x: a.coords[i], y: a.coords[i + 1], v: a.coords[i + 2] })
      }
      const vis = kps.filter((k) => k.v > 0)
      let bbox: [number, number, number, number] = [0, 0, 0, 0]
      if (vis.length) {
        const xs = vis.map((k) => k.x)
        const ys = vis.map((k) => k.y)
        const minx = Math.min(...xs), miny = Math.min(...ys)
        bbox = [minx, miny, Math.max(...xs) - minx, Math.max(...ys) - miny]
      }
      return {
        type: 'keypoint',
        keypoints: kps,
        edges: a.edges ? [...a.edges] : undefined,
        bbox,
        category,
        classId: a.classId,
        normalized: true,
        color,
        description: a.description,
        confidence: a.confidence,
      } as ParsedAnnotation
    }

    if (a.type === 'mask' || a.type === 'segmentation') {
      const pts: [number, number][] = []
      for (let i = 0; i + 1 < a.coords.length; i += 2) {
        pts.push([a.coords[i], a.coords[i + 1]])
      }
      let bbox: [number, number, number, number] = [0, 0, 0, 0]
      if (pts.length) {
        const xs = pts.map((p) => p[0])
        const ys = pts.map((p) => p[1])
        const minx = Math.min(...xs), miny = Math.min(...ys)
        bbox = [minx, miny, Math.max(...xs) - minx, Math.max(...ys) - miny]
      } else if (a.rle) {
        bbox = [0, 0, 1, 1]
      }
      return {
        type: a.type === 'mask' ? 'mask' : 'polygon',
        points: pts,
        rle: a.rle ? { size: [...a.rle.size], counts: a.rle.counts } : undefined,
        iscrowd: a.iscrowd,
        bbox,
        category,
        classId: a.classId,
        normalized: true,
        color,
        description: a.description,
        confidence: a.confidence,
      } as ParsedAnnotation
    }

    // polygon：平铺点序列 -> [(x,y),...]
    const pts: [number, number][] = []
    for (let i = 0; i + 1 < a.coords.length; i += 2) {
      pts.push([a.coords[i], a.coords[i + 1]])
    }
    return {
      type: 'polygon',
      points: pts,
      category,
      classId: a.classId,
      normalized: true,
      color,
      description: a.description,
      confidence: a.confidence,
    } as ParsedAnnotation
  })
}

/** 由归一化 [cx,cy,w,h] + 弧度角求 obb 四个角（归一化坐标，CCW 顺序） */
export function obbCorners(
  cx: number, cy: number, w: number, h: number, angle: number
): [number, number][] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const hw = w / 2
  const hh = h / 2
  const local: [number, number][] = [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
  ]
  return local.map(([lx, ly]) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos])
}

/** 加载选项（纠错回路 + 独立图片/标注根） */
export interface LoadOptions {
  /** 覆盖自动识别出的格式（用户纠错） */
  format?: CanonicalDataset['sourceFormat']
  /** 图片根目录句柄（不传则弹出选择）；分目录加载时必传 */
  imageHandle?: FileSystemDirectoryHandle | null
  /** 标注根目录句柄（与图片分属不同目录时传入；同目录可省略） */
  labelHandle?: FileSystemDirectoryHandle | null
  /** Tauri 端：已选中的图片根目录绝对路径（不传则弹出对话框选择） */
  root?: string
  /** Tauri 端：分目录加载时，图片根绝对路径（不传则复用 root） */
  imageRoot?: string
  /** Tauri 端：分目录加载时，标注根绝对路径（与图片分属不同目录） */
  labelRoot?: string
  /** 已明确选定的标注文件相对路径（多选叠加）；提供后跳过选择弹窗 */
  annotationFilter?: string[]
  /** 静默加载（恢复工作区 / 纠错回路），不弹选择框，按全部或已指定合并 */
  silent?: boolean
}

export type DirHandle = FileSystemDirectoryHandle | null

/** 记录最近一次加载使用的目录信息，供「纠错回路」复用、免重复选目录 */
const lastLoadHandles = new Map<
  string,
  { imageHandle: DirHandle; labelHandle: DirHandle; root?: string; labelRoot?: string; annotationFilter?: string[] }
>()

/**
 * 核心加载：给定图片根 + 标注根句柄，读文件 -> 归一化 -> 适配 UI。
 * 图片根与标注根可不同（分目录加载），二者 VirtualFile 合并后交给导入器；
 * 导入器按 stem / basename 跨根配对图片与标注，路径仍相对各自根，split/类别按图片路径推断。
 */
async function runLoad(
  imageHandle: DirHandle,
  labelHandle: DirHandle,
  formatOverride: CanonicalDataset['sourceFormat'] | undefined,
  onProgress?: ProgressFn,
  annotationFilter?: string[],
  silent?: boolean,
): Promise<CanonicalLoadResult & { handles: { imageHandle: DirHandle; labelHandle: DirHandle; annotationFilter?: string[] } }> {
  if (!imageHandle) throw new Error('未提供图片目录')

  onProgress?.(5, 100, '正在扫描文件...')
  const imageEntries = await readDirBrowser(imageHandle)
  const labelEntries = labelHandle ? await readDirBrowser(labelHandle) : []
  const entries = [...imageEntries, ...labelEntries]
  onProgress?.(15, 100, `找到 ${entries.length} 个文件，正在识别格式...`)

  // 路径 -> 原始 File 句柄（轻量引用，不持有字节；切图时由 selectFile 懒生成预览 URL）
  const pathToFile = new Map<string, File>()
  for (const e of entries) pathToFile.set(e.path, e.file)

  const vfiles = toVirtualFiles(entries)
  const detection = formatOverride
    ? { format: formatOverride }
    : await detectDatasetFormat(vfiles)
  const fmt = detection.format
  // 仅 COCO 这类「多任务 json 共置」的格式需要让用户选择标注文件
  const annotationFilterSet = fmt === 'coco'
    ? await resolveAnnotationFilter(vfiles, annotationFilter, silent)
    : undefined
  const canonical = await importDataset(vfiles, { format: fmt, annotationFilter: annotationFilterSet })
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
    const src = pathToFile.get(s.sourcePath)
    let width = 0
    let height = 0

    // 仅读取【文件头部】字节解析尺寸（parseImageSize 零解码、只需文件头），
    // 避免把整张图读入内存。数百张图逐张读全量字节会触发巨量内存分配与 GC，
    // 显著拖慢导入（实测 300+ 张「脚本执行」高达 ~18s）。头部切片为惰性读取，
    // 不加载整图；极罕见 EXIF 超长 / 罕见格式解析不到时，再回退读全量字节保正确性。
    try {
      if (src) {
        const head = new Uint8Array(await src.slice(0, HEADER_READ_LIMIT).arrayBuffer())
        const dims = parseImageSize(head)
        if (dims) {
          width = dims.width
          height = dims.height
        } else {
          const bytes = await s.getBytes()
          const fb = parseImageSize(bytes)
          if (fb) {
            width = fb.width
            height = fb.height
          }
        }
      }
    } catch {
      // 损坏图片或 COCO 缺图：跳过尺寸，保留样本占位
    }

    const imgFile: ImageFile = {
      id: key,
      name: fileName(s.sourcePath) || key,
      // path 使用真实相对路径：Tauri 下删除 / 读字节依赖真实路径
      path: s.sourcePath,
      size: src ? src.size : 0,
      width,
      height,
      // sourceFile 为轻量文件句柄；预览 URL 在切到该图时由 selectFile 懒生成并立即释放
      sourceFile: src,
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
    name: imageHandle.name,
    files,
    fileList,
    totalCount: total,
    dupCount: 0,
    uniqueCount: total,
  }
  // 若用户指定了标注文件（多任务共置场景），以标注文件名命名数据集，便于区分不同任务类型
  if (annotationFilterSet && annotationFilterSet.size) {
    dataset.name = fileName([...annotationFilterSet][0])
  }
  // 挂载规范中间模型，供去重 / 重划分 / 导出共享同一份数据
  dataset.canonical = canonical

  onProgress?.(100, 100, '加载完成！')
  return {
    dataset,
    annotations,
    categoryColors,
    canonical,
    warnings: canonical.warnings,
    handles: {
      imageHandle,
      labelHandle,
      annotationFilter: annotationFilterSet ? [...annotationFilterSet] : undefined,
    },
  }
}

/** 主入口：选择目录并以规范模型加载，返回 UI 就绪的数据 */
export async function loadDatasetCanonical(
  onProgress?: ProgressFn,
  opts?: LoadOptions,
): Promise<CanonicalLoadResult> {
  if (env === 'tauri') {
    return loadDatasetTauri(onProgress, opts)
  }

  let imageHandle = opts?.imageHandle ?? null
  let labelHandle = opts?.labelHandle ?? null

  if (!imageHandle) {
    imageHandle = await pickDirectoryBrowser()
    if (!imageHandle) throw new Error('用户取消选择')
  }

  const result = await runLoad(
    imageHandle,
    labelHandle,
    opts?.format,
    onProgress,
    opts?.annotationFilter,
    opts?.silent,
  )
  lastLoadHandles.set(result.dataset.id, result.handles)
  return result
}

/**
 * Tauri 加载：用 Rust 命令递归扫描目录（零 JS 拷贝），规范模型只持有相对路径，
 * 但每个 ImageFile 同时记录 absPath（绝对路径）供 asset 协议直读 / 直接删除。
 * 支持分目录：imageRoot 与 labelRoot 可不同（标注落在其自身根）。
 */
async function runLoadTauri(args: {
  imageRoot: string
  labelRoot?: string
  formatOverride?: CanonicalDataset['sourceFormat']
  onProgress?: ProgressFn
  annotationFilter?: string[]
  silent?: boolean
}): Promise<CanonicalLoadResult & { handles: { imageHandle: DirHandle; labelHandle: DirHandle; annotationFilter?: string[] } }> {
  const { imageRoot, labelRoot, formatOverride, onProgress, annotationFilter, silent } = args
  const t0 = performance.now()
  onProgress?.(5, 100, '正在扫描目录...')
  const { invoke } = await import('@tauri-apps/api/core')
  const imgScan = await invoke<{
    images: { relative_path: string; absolute_path: string; size: number; width: number; height: number }[]
    annotations: { relative_path: string; absolute_path: string; size: number }[]
  }>('scan_dataset_dir', { root: imageRoot })
  // 分目录：标注根独立于图片根，单独扫描；否则标注与图片同根
  const separateLabels = !!labelRoot && normSlash(labelRoot) !== normSlash(imageRoot)
  const annEntries = separateLabels
    ? (
        await invoke<{
          images: { relative_path: string; absolute_path: string; size: number }[]
          annotations: { relative_path: string; absolute_path: string; size: number }[]
        }>('scan_dataset_dir', { root: labelRoot })
      ).annotations
    : imgScan.annotations
  const imageEntries = imgScan.images
  onProgress?.(
    20,
    100,
    `找到 ${imageEntries.length} 张图片，${annEntries.length} 个标注`,
  )

  const relToAbs = new Map<string, string>()
  const relToSize = new Map<string, number>()
  const relToDims = new Map<string, { width: number; height: number }>()
  for (const e of imageEntries) {
    relToAbs.set(e.relative_path, e.absolute_path)
    relToSize.set(e.relative_path, e.size)
    // 尺寸已由 Rust 扫描期解析好，直接拿来用，零 IPC 往返
    if (e.width > 0 && e.height > 0) {
      relToDims.set(e.relative_path, { width: e.width, height: e.height })
    }
  }
  // 标注绝对路径：分目录时落在其自身根（labelRoot），单根时与图片同根
  for (const e of annEntries) relToAbs.set(e.relative_path, e.absolute_path)

  const normRoot = normSlash(imageRoot)
  const vfiles: VirtualFile[] = [...imageEntries, ...annEntries].map((e) => ({
    path: e.relative_path,
    getText: () => invoke<string>('read_file_text', { path: e.absolute_path }),
    getBytes: () =>
      invoke<number[]>('read_file_bytes', { path: e.absolute_path }).then((a) =>
        Uint8Array.from(a),
      ),
    size: e.size,
  }))

  const detection = formatOverride
    ? { format: formatOverride }
    : await detectDatasetFormat(vfiles)
  const fmt = detection.format
  // 仅 COCO 这类「多任务 json 共置」的格式需要让用户选择标注文件
  const annotationFilterSet = fmt === 'coco'
    ? await resolveAnnotationFilter(vfiles, annotationFilter, silent)
    : undefined
  const canonical = await importDataset(vfiles, { format: fmt, annotationFilter: annotationFilterSet })
  onProgress?.(50, 100, `识别为 ${canonical.sourceFormat} 格式，正在读取图片...`)

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

    // 尺寸直接取自 Rust 扫描结果，不再逐图 read_file_bytes（彻底消除 N 次 IPC 往返）
    const dims = relToDims.get(s.sourcePath)
    const width = dims?.width ?? 0
    const height = dims?.height ?? 0

    const absPath = relToAbs.get(s.sourcePath) ?? `${normRoot}/${s.sourcePath}`
    const imgFile: ImageFile = {
      id: key,
      name: fileName(s.sourcePath) || key,
      // path 使用相对 sourcePath（规范模型/导出/标注推导一致）；Tauri 的 fs 操作走 absPath
      path: s.sourcePath,
      size: relToSize.get(s.sourcePath) ?? 0,
      width,
      height,
      // absPath：磁盘绝对路径，供 asset 协议零拷贝直读与直接删除
      absPath,
    }

    fileList.push(imgFile)
    files.set(key, imgFile)
    annotations.set(key, sampleToAnnotations(s, canonical, categoryColors))

    if (i % 50 === 0) {
      onProgress?.(
        50 + Math.round(((i + 1) / total) * 40),
        100,
        `正在构建索引 (${i + 1}/${total})`,
      )
    }
  }

  const dataset: DataSet = {
    id: uid(),
    name: fileName(normRoot) || 'dataset',
    files,
    fileList,
    totalCount: total,
    dupCount: 0,
    uniqueCount: total,
    rootAbsPath: normRoot,
    // 分目录时记录标注根，删除标注文件按其定位（与图片根可能不同）
    ...(separateLabels ? { labelRootAbsPath: normSlash(labelRoot!) } : {}),
  }
  // 若用户指定了标注文件（多任务共置场景），以标注文件名命名数据集，便于区分不同任务类型
  if (annotationFilterSet && annotationFilterSet.size) {
    dataset.name = fileName([...annotationFilterSet][0])
  }
  // 挂载规范中间模型，供去重 / 重划分 / 导出共享同一份数据
  dataset.canonical = canonical

  const ms = Math.round(performance.now() - t0)
  console.log(
    `[load-tauri] 扫描 ${imageEntries.length} 图 / ${annEntries.length} 标注，构建 ${total} 样本，耗时 ${ms}ms`,
  )
  onProgress?.(100, 100, '加载完成！')
  return {
    dataset,
    annotations,
    categoryColors,
    canonical,
    warnings: canonical.warnings,
    handles: {
      imageHandle: null,
      labelHandle: null,
      annotationFilter: annotationFilterSet ? [...annotationFilterSet] : undefined,
    },
  }
}

/** Tauri 入口：选择目录（或复用 opts.imageRoot/root）并以规范模型加载，支持分目录 */
async function loadDatasetTauri(
  onProgress?: ProgressFn,
  opts?: LoadOptions,
): Promise<CanonicalLoadResult> {
  let imageRoot = opts?.imageRoot ?? opts?.root ?? null
  let labelRoot = opts?.labelRoot ?? null
  if (!imageRoot) {
    imageRoot = await pickDirectoryTauri()
    if (!imageRoot) throw new Error('用户取消选择')
  }

  const result = await runLoadTauri({
    imageRoot,
    labelRoot: labelRoot ?? undefined,
    formatOverride: opts?.format,
    onProgress,
    annotationFilter: opts?.annotationFilter,
    silent: opts?.silent,
  })
  lastLoadHandles.set(result.dataset.id, {
    imageHandle: null,
    labelHandle: null,
    root: imageRoot,
    labelRoot: labelRoot ?? undefined,
    annotationFilter: result.handles.annotationFilter,
  })
  return result
}

/**
 * 读取某数据集上次加载时缓存的目录信息（路径 / 句柄），供工作区持久化捕获来源元信息。
 * 仅在本次会话内有效（内存），跨会话由工作区配置重建。
 */
export function peekLoadHandles(
  datasetId: string,
): { imageHandle: DirHandle; labelHandle: DirHandle; root?: string; labelRoot?: string } | undefined {
  return lastLoadHandles.get(datasetId)
}

/**
 * 写入某数据集的目录信息（路径 / 句柄），供「恢复工作区」后纠错回路（reloadActiveWithFormat）
 * 仍能复用同一批目录，无需重新选择。
 */
export function recordLoadHandles(
  datasetId: string,
  handles: { imageHandle: DirHandle; labelHandle: DirHandle; root?: string; labelRoot?: string },
): void {
  lastLoadHandles.set(datasetId, handles)
}

/** 关闭数据集时调用，释放其目录句柄记录，避免 id 复用串味与内存泄漏 */
export function forgetLoadHandles(datasetId: string): void {
  lastLoadHandles.delete(datasetId)
}

/**
 * 从持久化的绝对路径重建数据集（Tauri 端，不弹选择框）。
 * 复用 runLoadTauri 的目录扫描 + 规范模型导入，仅省去「选目录」步骤。
 */
export async function reloadDatasetFromPaths(args: {
  imageRoot: string
  labelRoot?: string
  formatOverride?: CanonicalDataset['sourceFormat']
  onProgress?: ProgressFn
}): Promise<CanonicalLoadResult> {
  if (env !== 'tauri') throw new Error('reloadDatasetFromPaths 仅用于 Tauri 端')
  return runLoadTauri({ ...args, silent: true })
}

/**
 * 从持久化的目录句柄重建数据集（浏览器端，不弹选择框）。
 * 调用方需在外部已通过 handle.requestPermission 重新取得读权限。
 */
export async function reloadDatasetFromHandles(args: {
  imageHandle: DirHandle
  labelHandle: DirHandle
  formatOverride?: CanonicalDataset['sourceFormat']
  onProgress?: ProgressFn
}): Promise<CanonicalLoadResult> {
  if (!args.imageHandle) throw new Error('未提供图片目录句柄')
  return runLoad(args.imageHandle, args.labelHandle, args.formatOverride, args.onProgress, undefined, true)
}

/**
 * 纠错回路：用同一批目录信息以指定格式重新导入（免重复选目录）。
 * 返回新数据集（新 id），由调用方替换旧数据集。
 */
export async function reimportDataset(
  datasetId: string,
  format: CanonicalDataset['sourceFormat'],
  onProgress?: ProgressFn,
): Promise<CanonicalLoadResult> {
  const handles = lastLoadHandles.get(datasetId)
  if (!handles) {
    throw new Error('无可复用的目录信息，请重新选择目录后加载')
  }
  let result: CanonicalLoadResult & {
    handles: { imageHandle: DirHandle; labelHandle: DirHandle; annotationFilter?: string[] }
  }
  if (handles.labelRoot) {
    // 分目录纠错：分别用图片根与标注根重新扫描
    result = await runLoadTauri(
      { imageRoot: handles.root!, labelRoot: handles.labelRoot, formatOverride: format, onProgress, annotationFilter: handles.annotationFilter, silent: true },
    )
  } else if (handles.root) {
    result = await runLoadTauri({ imageRoot: handles.root, formatOverride: format, onProgress, annotationFilter: handles.annotationFilter, silent: true })
  } else if (handles.imageHandle) {
    result = await runLoad(handles.imageHandle, handles.labelHandle, format, onProgress, handles.annotationFilter, true)
  } else {
    throw new Error('无可复用的目录信息，请重新选择目录后加载')
  }
  lastLoadHandles.set(result.dataset.id, {
    imageHandle: null,
    labelHandle: null,
    root: handles.root,
    labelRoot: handles.labelRoot,
    annotationFilter: result.handles.annotationFilter,
  })
  return result
}
