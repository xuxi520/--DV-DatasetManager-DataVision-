import type { ImageFit } from '../../canvas/canvasEdit'

export type DragMode = 'none' | 'pan' | 'move' | 'resize' | 'rotate' | 'draw'

/** 像素中心点 bbox [cx,cy,w,h] ← 归一化 [x,y,w,h] */
export const pBBoxToC = (b: number[]) =>
  [b[0] + b[2] / 2, b[1] + b[3] / 2, b[2], b[3]] as [number, number, number, number]

/** 归一化 [x,y,w,h] ← 像素中心点 [cx,cy,w,h] */
export const cBBoxToP = (c: number[]) =>
  [c[0] - c[2] / 2, c[1] - c[3] / 2, c[2], c[3]] as [number, number, number, number]

/** 扁平 [x,y,x,y,...] ← 点序列 */
export const flatten = (pts: [number, number][]) =>
  pts.reduce<number[]>((a, p) => (a.push(p[0], p[1]), a), [])

/** 点序列 ← 扁平 [x,y,x,y,...] */
export const unflatten = (flat: number[]) => {
  const r: [number, number][] = []
  for (let i = 0; i < flat.length; i += 2) r.push([flat[i], flat[i + 1]])
  return r
}

/**
 * 归一化坐标 → 图像局部坐标。
 * 仅做归一化→局部映射，不含 pan/zoom，因为 canvas 已通过 ctx.setTransform 统一施加
 * 了 dpr+pan+zoom 变换，这里若再叠加会双重变换。
 */
export const normToLocal = (nx: number, ny: number, fit: ImageFit) => ({
  x: fit.fitX + nx * fit.fitW,
  y: fit.fitY + ny * fit.fitH,
})
