/**
 * 导入器共享层：环境无关的文件抽象与通用工具
 *
 * VirtualFile 屏蔽浏览器(FileList) 与 Tauri(本地路径) 差异：
 * 两环境各自把文件适配成 VirtualFile[] 后交给导入器，导入器不关心来源。
 */
import type { SplitKey } from '../types'

export interface VirtualFile {
  /** 相对根路径，统一使用 '/' */
  path: string
  getText(): Promise<string>
  getBytes(): Promise<Uint8Array>
  /** 文件字节大小（可选，用于安全跳过巨型文件、避免全量读取卡死主线程） */
  size?: number
}

/**
 * 内容窥探安全上限：仅对小于该尺寸的 json 做全文读取判定，
 * 超过则依赖文件名推断，避免读取上百 MB 的 COCO 标注文件卡死主线程。
 */
export const SAFE_PEEK_BYTES = 4 * 1024 * 1024

/**
 * 按文件名判断是否为 COCO 多任务标注（无需读取内容）。
 * 覆盖官方约定：instances_* / person_keypoints_* / keypoints_* / captions_* / panoptic_*。
 */
export function looksLikeCocoByFilename(name: string): boolean {
  return /(^|[._-])(instances|person_keypoints|keypoints|captions|panoptic)([._-]|$)/i.test(name)
}

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff']
const LABEL_EXTS = ['.txt', '.xml', '.json']

export function isImagePath(p: string): boolean {
  const e = ext(p).toLowerCase()
  return IMAGE_EXTS.includes(e)
}
export function isLabelPath(p: string): boolean {
  const e = ext(p).toLowerCase()
  return LABEL_EXTS.includes(e)
}
export function ext(p: string): string {
  const i = p.lastIndexOf('.')
  return i < 0 ? '' : p.slice(i)
}
export function baseName(p: string): string {
  const i = p.lastIndexOf('.')
  const j = p.lastIndexOf('/')
  return p.slice(j + 1, i < 0 ? undefined : i)
}
export function dirName(p: string): string {
  const j = p.lastIndexOf('/')
  return j < 0 ? '' : p.slice(0, j)
}
export function normSlash(p: string): string {
  return p.replace(/\\/g, '/')
}

const SPLIT_RE: Array<{ key: SplitKey; re: RegExp }> = [
  { key: 'train', re: /(^|[/\\])(train|training|trainset)([/\\]|$)/i },
  { key: 'val', re: /(^|[/\\])(val|valid|validation|valset)([/\\]|$)/i },
  { key: 'test', re: /(^|[/\\])(test|testing|testset)([/\\]|$)/i },
]

/** 从路径识别 train/val/test 子集 */
export function detectSplit(path: string): SplitKey {
  const n = normSlash(path)
  for (const s of SPLIT_RE) if (s.re.test(n)) return s.key
  return 'unknown'
}

/**
 * 识别类别文件夹名：
 * 在 'images'（或 'image'/'JPEGImages'）与文件之间的那个「非 split」段。
 *   train/images/cat/x.jpg        -> cat
 *   images/train/cat/x.jpg        -> cat
 *   train/images/x.jpg            -> ''（无类别子目录）
 */
export function detectCategory(path: string): string {
  const segs = normSlash(path).split('/').filter(Boolean)
  const imgIdx = segs.findIndex((s) => /^(image|images|jpegimages)$/i.test(s))
  if (imgIdx < 0) return ''
  // 候选：img 前后相邻段（取存在且非 split 的）
  const candidates = [segs[imgIdx - 1], segs[imgIdx + 1]].filter(Boolean) as string[]
  for (const c of candidates) {
    if (!SPLIT_RE.some((s) => s.re.test('/' + c + '/'))) return c
  }
  return ''
}

/**
 * 给定图片路径，推导其标注文件的若干候选路径。
 * 覆盖：同目录、images<->labels 互换、train/images<->train/labels、
 * images/train<->labels/train 等常见 YOLO 布局。
 */
export function candidateLabelPaths(imagePath: string): string[] {
  const dir = dirName(imagePath)
  const base = baseName(imagePath)
  const out: string[] = []
  const push = (p: string) => {
    // 归一化：去掉可能产生的多余前导斜杠（扁平数据集 dir 为空时会多出 "/"）
    p = p.replace(/^\/+/, '')
    if (p && !out.includes(p)) out.push(p)
  }

  // 1) 同目录同名 .txt
  push(`${dir}/${base}.txt`)

  // 2) images <-> labels 段互换（含 image/Image 等变体）
  const swap = (d: string, from: RegExp, to: string) =>
    d.replace(new RegExp(`(^|/)(${from.source.replace(/^\^|\$$/g, '')})(?=/|$)`, 'i'), `$1${to}`)
  push(`${swap(dir, /images/, 'labels')}/${base}.txt`)
  push(`${swap(dir, /image/, 'label')}/${base}.txt`)
  push(`${swap(dir, /jpegimages/, 'annotations')}/${base}.xml`)

  // 3) train/images <-> train/labels 与 images/train <-> labels/train
  //    （处理 <split>/images 变体：把 images 换成 labels）
  // 上面 swap(images->labels) 已覆盖 train/images->train/labels；
  // 对于 images/train，需要 images/train -> labels/train：
  push(`${dir.replace(/(^|\/)images(?=\/train)/i, '$1labels')}/${base}.txt`)

  return out
}

/** 在一组标注文件路径集合中查找图片对应的标注 */
export function findLabelPath(imagePath: string, labelSet: Set<string>): string | undefined {
  for (const c of candidateLabelPaths(imagePath)) {
    if (labelSet.has(normSlash(c))) return normSlash(c)
  }
  return undefined
}

/**
 * 解析一行 YOLO 标注，按列数区分三种变体：
 *  - bbox ：`<classId> <cx> <cy> <w> <h>`            → kind 'bbox'
 *  - obb  ：`<classId> <cx> <cy> <w> <h> <angle>`    → kind 'obb'（angle 角度，转弧度）
 *  - pose ：`<classId> <cx> <cy> <w> <h> <kx1> <ky1> <kv1> ...`（(n-5)%3==0）→ kind 'pose'
 * 坐标均为归一化 0~1。非法行返回 null。
 */
export type YoloParsed =
  | { kind: 'bbox'; classId: number; coords: number[] }
  | { kind: 'obb'; classId: number; coords: number[]; rotation: number }
  | { kind: 'pose'; classId: number; coords: number[]; keypoints: number[] }

export function parseYoloLine(line: string): YoloParsed | null {
  const parts = line.trim().split(/\s+/)
  if (parts.length < 5) return null
  const nums = parts.map(Number)
  if (nums.slice(0, 5).some((n) => !isFinite(n))) return null
  const [classId, cx, cy, w, h] = nums

  // OBB：恰好 6 列（第 6 列为角度，角度制）
  if (parts.length === 6 && isFinite(nums[5])) {
    return { kind: 'obb', classId, coords: [cx, cy, w, h], rotation: (nums[5] * Math.PI) / 180 }
  }
  // Pose：>= 8 列且 (n-5) 为 3 的倍数（每个关键点 3 值）
  if (parts.length >= 8 && (parts.length - 5) % 3 === 0) {
    const keypoints = nums.slice(5)
    if (keypoints.every((n) => isFinite(n))) {
      return { kind: 'pose', classId, coords: [cx, cy, w, h], keypoints }
    }
  }
  // 兜底：bbox（多余列忽略）
  return { kind: 'bbox', classId, coords: [cx, cy, w, h] }
}
