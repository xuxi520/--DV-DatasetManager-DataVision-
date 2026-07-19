/**
 * 模型预测 → 画布可绘制标注（ParsedAnnotation）转换。
 *
 * 预测覆盖层与 Ground-Truth 共用绘制管线（canvasDraw.drawAnnotation），
 * 故需把规范模型 CanonicalAnnotation 投影成 ParsedAnnotation。
 * 坐标均为归一化（0~1），与 drawAnnotation 的 normalized 约定一致。
 */
import type { CanonicalAnnotation } from '../dataset/types'
import type { ParsedAnnotation } from '../types'

function cornersNorm(
  cx: number, cy: number, w: number, h: number, rot: number,
): [number, number][] {
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const local: [number, number][] = [
    [-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2],
  ]
  return local.map(([lx, ly]) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos])
}

/** 单个预测项 → ParsedAnnotation（用于画布叠加渲染） */
export function predictionToParsed(
  item: CanonicalAnnotation,
  classNameById: Map<number, string>,
): ParsedAnnotation {
  const category = classNameById.get(item.classId) ?? `class_${item.classId}`
  const base: ParsedAnnotation = {
    type: 'bbox',
    category,
    classId: item.classId,
    confidence: item.confidence,
    description: item.description,
    normalized: true,
    color: '#E040FB',
  }

  switch (item.type) {
    case 'bbox': {
      const [cx, cy, w, h] = item.coords
      base.type = 'bbox'
      base.bbox = [cx - w / 2, cy - h / 2, w, h]
      break
    }
    case 'polygon':
    case 'segmentation': {
      const pts: [number, number][] = []
      for (let i = 0; i + 1 < item.coords.length; i += 2) {
        pts.push([item.coords[i], item.coords[i + 1]])
      }
      base.type = 'polygon'
      base.points = pts
      if (pts.length) {
        const xs = pts.map((p) => p[0])
        const ys = pts.map((p) => p[1])
        base.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
      }
      break
    }
    case 'obb': {
      const [cx, cy, w, h] = item.coords
      const rot = item.rotation ?? 0
      base.type = 'obb'
      base.rotation = rot
      base.points = cornersNorm(cx, cy, w, h, rot)
      base.bbox = [cx - w / 2, cy - h / 2, w, h]
      break
    }
    case 'keypoints': {
      const kps: { x: number; y: number; v: number }[] = []
      for (let i = 0; i + 2 < item.coords.length; i += 3) {
        kps.push({ x: item.coords[i], y: item.coords[i + 1], v: item.coords[i + 2] })
      }
      base.type = 'keypoint'
      base.keypoints = kps
      if (kps.length) {
        const xs = kps.map((k) => k.x)
        const ys = kps.map((k) => k.y)
        base.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
      }
      break
    }
    case 'mask': {
      if (item.rle) {
        base.type = 'mask'
        base.rle = item.rle
        base.iscrowd = item.iscrowd
        base.bbox = [0, 0, 1, 1]
      } else {
        const pts: [number, number][] = []
        for (let i = 0; i + 1 < item.coords.length; i += 2) {
          pts.push([item.coords[i], item.coords[i + 1]])
        }
        base.type = 'mask'
        base.points = pts
        if (pts.length) {
          const xs = pts.map((p) => p[0])
          const ys = pts.map((p) => p[1])
          base.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
        }
      }
      break
    }
  }

  return base
}

/** 批量转换；classNameById 为 classId → 类别名 映射（来自数据集 classes） */
export function predictionsToParsed(
  items: CanonicalAnnotation[],
  classNameById: Map<number, string>,
): ParsedAnnotation[] {
  return items.map((it) => predictionToParsed(it, classNameById))
}
