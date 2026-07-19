/**
 * DOTA 格式导入器（旋转框目标检测）
 *
 * 布局：images/<name>.png + labelTxt/<name>.txt（每张图一个标注文件）
 * 标注行：`x1 y1 x2 y2 x3 y3 x4 y4 class_name difficult`（可选末尾 score）。
 * 四个角点为像素坐标，按图尺寸归一化为规范 obb [cx, cy, w, h]（0~1）+ rotation（弧度，CCW）。
 */
import { ClassRegistry } from '../classRegistry'
import type { CanonicalSample, SplitKey } from '../types'
import { parseImageSize } from '../../env'
import {
  VirtualFile,
  normSlash,
  isImagePath,
  ext,
  baseName,
  detectSplit,
} from './shared'

const META_NAMES = new Set(['classes', 'split'])

/** DOTA 行：8 个数字角点 + 类别名 + 可选 difficult/score */
function parseDotaLine(line: string): { corners: number[]; cls: string } | null {
  const parts = line.trim().split(/\s+/)
  if (parts.length < 9) return null
  const nums = parts.slice(0, 8).map(Number)
  if (nums.some((n) => !isFinite(n))) return null
  const cls = parts[8]
  if (!cls || /^\d+$/.test(cls)) return null // 第 9 段必须是类别名（非纯数字）
  return { corners: nums, cls }
}

/** 由 4 个像素角点求 obb [cx,cy,w,h,angle(弧度)]（归一化 0~1） */
function cornersToObb(
  corners: number[],
  W: number,
  H: number,
): { coords: number[]; rotation: number } {
  const w = W || 1
  const h = H || 1
  const pts: [number, number][] = []
  for (let i = 0; i < 8; i += 2) pts.push([corners[i] / w, corners[i + 1] / h])
  // 相邻边向量
  const e1x = pts[1][0] - pts[0][0]
  const e1y = pts[1][1] - pts[0][1]
  const e2x = pts[3][0] - pts[0][0]
  const e2y = pts[3][1] - pts[0][1]
  const cx = (pts[0][0] + pts[2][0]) / 2
  const cy = (pts[0][1] + pts[2][1]) / 2
  const bw = Math.hypot(e1x, e1y)
  const bh = Math.hypot(e2x, e2y)
  const angle = Math.atan2(e1y, e1x)
  return { coords: [cx, cy, bw, bh], rotation: angle }
}

export async function importDota(
  files: VirtualFile[],
): Promise<{ samples: CanonicalSample[]; registry: ClassRegistry; warnings: string[] }> {
  const norm = files.map((f) => ({ ...f, path: normSlash(f.path) }))
  const registry = new ClassRegistry()
  const warnings: string[] = []

  const images = norm.filter((f) => isImagePath(f.path))
  const labelFiles = norm.filter(
    (f) =>
      ext(f.path).toLowerCase() === '.txt' &&
      !META_NAMES.has(baseName(f.path).toLowerCase()),
  )
  const labelByStem = new Map<string, VirtualFile>()
  for (const lf of labelFiles) {
    const s = baseName(lf.path).toLowerCase()
    if (!labelByStem.has(s)) labelByStem.set(s, lf)
  }

  const samples: CanonicalSample[] = []
  for (const img of images) {
    const split: SplitKey = detectSplit(img.path)
    const category = ''
    const stem = baseName(img.path).toLowerCase()
    const lf = labelByStem.get(stem)
    // 读取图片尺寸以把像素角点归一化为 0~1
    let W = 1
    let H = 1
    try {
      const bytes = await img.getBytes()
      const dims = parseImageSize(bytes)
      if (dims && dims.width > 0 && dims.height > 0) {
        W = dims.width
        H = dims.height
      } else {
        warnings.push(`DOTA 图片尺寸解析失败，角点未归一化：${img.path}`)
      }
    } catch {
      warnings.push(`DOTA 图片读取失败，角点未归一化：${img.path}`)
    }
    const anns: any[] = []
    if (lf) {
      const text = await lf.getText()
      for (const raw of text.split(/\r?\n/)) {
        const parsed = parseDotaLine(raw)
        if (!parsed) continue
        let classId = registry.classes.findIndex((c) => c.name === parsed.cls)
        if (classId < 0) classId = registry.add(parsed.cls)
        const { coords, rotation } = cornersToObb(parsed.corners, W, H)
        anns.push({ type: 'obb' as const, coords, rotation, classId })
      }
    } else {
      warnings.push(`DOTA 图片 ${img.path} 无对应标注文件`)
    }
    samples.push({
      id: img.path,
      sourcePath: img.path,
      split,
      category,
      imageExt: ext(img.path).toLowerCase(),
      getBytes: img.getBytes,
      annotations: anns,
      width: W,
      height: H,
    })
  }

  return { samples, registry, warnings }
}
