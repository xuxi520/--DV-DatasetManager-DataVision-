/**
 * 数据增强变换引擎（仅用于预览，不写回数据集）。
 *
 * 设计要点：
 * - 每个几何增强用同一个仿射矩阵同时作用于「图像像素」和「归一化标注点」，
 *   保证增强后的图与框/点/多边形严格对齐（不会出现框错位）。
 * - 颜色增强（亮度/对比度/色相/饱和度/模糊/加噪）只改像素，标注几何不变。
 * - 标注变换统一输出归一化 ParsedAnnotation，复用 canvasDraw.drawAnnotation 绘制。
 */
import type { ParsedAnnotation } from '../types'

export type AugId =
  | 'flip-h' | 'flip-v' | 'rot90-cw' | 'rot90-ccw'
  | 'rot-small' | 'crop'
  | 'brightness' | 'contrast' | 'hue' | 'saturate' | 'blur' | 'noise'

export interface AugParam {
  label: string
  min: number
  max: number
  step: number
  default: number
}

export interface AugDef {
  id: AugId
  label: string
  kind: 'geometric' | 'color'
  /** 几何变换：新图尺寸与源图不同；颜色变换：尺寸不变 */
  param?: AugParam
}

export const AUGMENTATIONS: AugDef[] = [
  { id: 'flip-h', label: '水平翻转', kind: 'geometric' },
  { id: 'flip-v', label: '垂直翻转', kind: 'geometric' },
  { id: 'rot90-cw', label: '顺时针 90°', kind: 'geometric' },
  { id: 'rot90-ccw', label: '逆时针 90°', kind: 'geometric' },
  { id: 'rot-small', label: '随机旋转', kind: 'geometric', param: { label: '角度°', min: -30, max: 30, step: 1, default: 15 } },
  { id: 'crop', label: '随机裁剪', kind: 'geometric', param: { label: '保留比例', min: 0.5, max: 1, step: 0.05, default: 0.8 } },
  { id: 'brightness', label: '亮度', kind: 'color', param: { label: '亮度%', min: -100, max: 100, step: 5, default: 0 } },
  { id: 'contrast', label: '对比度', kind: 'color', param: { label: '对比度%', min: -100, max: 100, step: 5, default: 0 } },
  { id: 'hue', label: '色相', kind: 'color', param: { label: '色相°', min: -180, max: 180, step: 5, default: 0 } },
  { id: 'saturate', label: '饱和度', kind: 'color', param: { label: '饱和度%', min: -100, max: 100, step: 5, default: 0 } },
  { id: 'blur', label: '高斯模糊', kind: 'color', param: { label: '半径px', min: 0, max: 10, step: 0.5, default: 0 } },
  { id: 'noise', label: '加噪', kind: 'color', param: { label: '强度', min: 0, max: 50, step: 2, default: 10 } },
]

export const AUG_MAP: Record<AugId, AugDef> = Object.fromEntries(
  AUGMENTATIONS.map((a) => [a.id, a]),
) as Record<AugId, AugDef>

/** 仿射矩阵：screen = [a c; b d]·(px,py) + (e,f) */
interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }

interface Plan {
  nw: number
  nh: number
  aff: Affine
  /** CSS filter 字符串（颜色增强用） */
  filter?: string
  /** 加噪强度（0 表示不加） */
  noise?: number
  /** 归一化点变换：输入原始归一化坐标，输出新图归一化坐标 */
  pt: (x: number, y: number) => [number, number]
  /** 是否为几何变换（false=仅颜色，标注几何不变） */
  geometric: boolean
  /** 是否为旋转（影响 OBB 旋转角累加） */
  isRotate: boolean
  /** 旋转角（弧度，仅 isRotate 时有效） */
  angle?: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function planFor(id: AugId, W: number, H: number, param: number): Plan {
  switch (id) {
    case 'flip-h':
      return { nw: W, nh: H, aff: { a: -1, b: 0, c: 0, d: 1, e: W, f: 0 }, pt: (x, y) => [1 - x, y], geometric: true, isRotate: false }
    case 'flip-v':
      return { nw: W, nh: H, aff: { a: 1, b: 0, c: 0, d: -1, e: 0, f: H }, pt: (x, y) => [x, 1 - y], geometric: true, isRotate: false }
    case 'rot90-cw':
      return { nw: H, nh: W, aff: { a: 0, b: -1, c: 1, d: 0, e: 0, f: W }, pt: (x, y) => [y, 1 - x], geometric: true, isRotate: false }
    case 'rot90-ccw':
      return { nw: H, nh: W, aff: { a: 0, b: 1, c: -1, d: 0, e: H, f: 0 }, pt: (x, y) => [1 - y, x], geometric: true, isRotate: false }
    case 'rot-small': {
      const ang = (param * Math.PI) / 180
      const cos = Math.cos(ang)
      const sin = Math.sin(ang)
      const D = Math.max(1, Math.ceil(Math.hypot(W, H)))
      const e = D / 2 - cos * (W / 2) + sin * (H / 2)
      const f = D / 2 - sin * (W / 2) - cos * (H / 2)
      return {
        nw: D, nh: D,
        aff: { a: cos, b: sin, c: -sin, d: cos, e, f },
        geometric: true, isRotate: true, angle: ang,
        pt: (x, y) => {
          const px = x * W, py = y * H
          const nx = cos * px - sin * py + e
          const ny = sin * px + cos * py + f
          return [nx / D, ny / D]
        },
      }
    }
    case 'crop': {
      const fr = clamp01(param)
      const cw = Math.max(1, Math.round(W * fr))
      const ch = Math.max(1, Math.round(H * fr))
      const ox = Math.round((W - cw) / 2)
      const oy = Math.round((H - ch) / 2)
      return {
        nw: cw, nh: ch,
        aff: { a: 1, b: 0, c: 0, d: 1, e: -ox, f: -oy },
        geometric: true, isRotate: false,
        pt: (x, y) => [(x * W - ox) / cw, (y * H - oy) / ch],
      }
    }
    case 'brightness':
      return { nw: W, nh: H, aff: ident(), pt: identPt, geometric: false, isRotate: false, filter: `brightness(${1 + param / 100})` }
    case 'contrast':
      return { nw: W, nh: H, aff: ident(), pt: identPt, geometric: false, isRotate: false, filter: `contrast(${1 + param / 100})` }
    case 'hue':
      return { nw: W, nh: H, aff: ident(), pt: identPt, geometric: false, isRotate: false, filter: `hue-rotate(${param}deg)` }
    case 'saturate':
      return { nw: W, nh: H, aff: ident(), pt: identPt, geometric: false, isRotate: false, filter: `saturate(${1 + param / 100})` }
    case 'blur':
      return { nw: W, nh: H, aff: ident(), pt: identPt, geometric: false, isRotate: false, filter: param > 0 ? `blur(${param}px)` : 'none' }
    case 'noise':
      return { nw: W, nh: H, aff: ident(), pt: identPt, geometric: false, isRotate: false, noise: param }
  }
}

const ident = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
const identPt = (x: number, y: number): [number, number] => [x, y]

/** 把单个标注按 plan 几何变换为新标注（归一化）；应丢弃返回 null */
function transformAnn(ann: ParsedAnnotation, plan: Plan): ParsedAnnotation | null {
  // 颜色增强：几何不变，原样保留（仅确保 normalized 标记）
  if (!plan.geometric) {
    return { ...ann, normalized: ann.normalized !== false }
  }

  const base = {
    category: ann.category,
    color: ann.color,
    confidence: ann.confidence,
    classId: ann.classId,
    normalized: true as const,
    description: ann.description,
    bboxType: ann.bboxType,
  }

  // OBB：几何变换统一转成四角多边形（避免旋转角换算错误；预览视觉等价）
  if (ann.type === 'obb' && ann.points && ann.points.length >= 4) {
    const pts = ann.points.map((p) => plan.pt(p[0], p[1]))
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1])
    return { ...base, type: 'polygon', bboxType: 'obb', bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)], points: pts }
  }

  // 关键点
  if (ann.type === 'keypoint' && ann.keypoints) {
    const kps = ann.keypoints.map((k) => {
      const [nx, ny] = plan.pt(k.x, k.y)
      return { x: clamp01(nx), y: clamp01(ny), v: k.v }
    })
    const xs = kps.map((k) => k.x); const ys = kps.map((k) => k.y)
    return { ...base, type: 'keypoint', bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)], keypoints: kps, edges: ann.edges }
  }

  // 多边形 / mask：逐点变换，整体在框外的丢弃
  if ((ann.type === 'polygon' || ann.type === 'mask') && ann.points) {
    const pts = ann.points.map((p) => {
      const [nx, ny] = plan.pt(p[0], p[1])
      return [clamp01(nx), clamp01(ny)] as [number, number]
    })
    const inFrame = pts.some((p) => p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)
    if (!inFrame) return null
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1])
    return { ...base, type: ann.type, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)], points: pts, rle: ann.rle, iscrowd: ann.iscrowd }
  }

  // bbox / circle：以中心点变换（翻转不改变 w/h；裁剪后裁剪到帧内）
  if (ann.bbox) {
    const [x, y, w, h] = ann.bbox
    const cx = x + w / 2
    const cy = y + h / 2
    let [nx, ny] = plan.pt(cx, cy)
    let nw = w
    let nh = h
    if (plan.isRotate) {
      // 旋转后轴对齐包围盒：取四角变换后的极值
      const corners: [number, number][] = [
        [x, y], [x + w, y], [x + w, y + h], [x, y + h],
      ].map((p) => plan.pt(p[0], p[1]))
      const xs = corners.map((p) => p[0]); const ys = corners.map((p) => p[1])
      const minx = Math.min(...xs), miny = Math.min(...ys)
      nx = (minx + Math.max(...xs)) / 2
      ny = (miny + Math.max(...ys)) / 2
      nw = Math.max(...xs) - minx
      nh = Math.max(...ys) - miny
    }
    nx = clamp01(nx); ny = clamp01(ny)
    const halfW = nw / 2, halfH = nh / 2
    if (nx - halfW > 1 || nx + halfW < 0 || ny - halfH > 1 || ny + halfH < 0) return null
    const bx = clamp01(nx - halfW)
    const by = clamp01(ny - halfH)
    const bw = Math.min(1, nx + halfW) - bx
    const bh = Math.min(1, ny + halfH) - by
    if (bw <= 0 || bh <= 0) return null
    return { ...base, type: ann.type === 'circle' ? 'bbox' : 'bbox', bbox: [bx, by, bw, bh] }
  }

  return null
}

function addNoise(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number): void {
  if (intensity <= 0) return
  let img: ImageData
  try {
    img = ctx.getImageData(0, 0, w, h)
  } catch (e) {
    // 画布被跨域数据污染时 getImageData 会抛 SecurityError；降级为跳过加噪，避免整卡渲染崩溃。
    console.warn('[augment] 加噪跳过：画布被跨域污染，无法读取像素', e)
    return
  }
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 2 * intensity
    d[i] = clamp255(d[i] + n)
    d[i + 1] = clamp255(d[i + 1] + n)
    d[i + 2] = clamp255(d[i + 2] + n)
  }
  ctx.putImageData(img, 0, 0)
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

export interface AugResult {
  canvas: HTMLCanvasElement
  annotations: ParsedAnnotation[]
  /** 新图宽高（像素），供绘制时作为 imgW/imgH */
  width: number
  height: number
}

/**
 * 对单张图应用单个增强，返回增强后的画布与变换后的标注。
 * 纯函数（除 canvas 绘制副作用），非破坏式。
 */
/** 组合增强链的单步描述 */
export interface AugStep {
  id: AugId
  param: number
}

export function applyAugmentation(
  src: HTMLImageElement | HTMLCanvasElement,
  annotations: ParsedAnnotation[],
  id: AugId,
  param = 0,
): AugResult {
  const W = (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width || (src as HTMLImageElement).width
  const H = (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height || (src as HTMLImageElement).height
  const plan = planFor(id, W, H, param)

  const canvas = document.createElement('canvas')
  canvas.width = plan.nw
  canvas.height = plan.nh
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(plan.aff.a, plan.aff.b, plan.aff.c, plan.aff.d, plan.aff.e, plan.aff.f)
  if (plan.filter && plan.filter !== 'none') ctx.filter = plan.filter
  ctx.drawImage(src, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.filter = 'none'
  if (plan.noise) addNoise(ctx, plan.nw, plan.nh, plan.noise)

  const next = annotations
    .map((a) => transformAnn(a, plan))
    .filter((a): a is ParsedAnnotation => a !== null)

  return { canvas, annotations: next, width: plan.nw, height: plan.nh }
}

/**
 * 对单张图顺序应用一组增强步骤，返回最终画布与变换后的标注。
 * 每个步骤的画布作为下一步的输入，使多增强可组合（链式）；非破坏式。
 */
export function applyAugmentationChain(
  src: HTMLImageElement | HTMLCanvasElement,
  annotations: ParsedAnnotation[],
  steps: AugStep[],
): AugResult | null {
  if (steps.length === 0) return null
  let cur: HTMLImageElement | HTMLCanvasElement = src
  let anns = annotations
  let result: AugResult = applyAugmentation(cur, anns, steps[0].id, steps[0].param)
  for (let i = 1; i < steps.length; i++) {
    result = applyAugmentation(result.canvas, result.annotations, steps[i].id, steps[i].param)
  }
  return result
}
