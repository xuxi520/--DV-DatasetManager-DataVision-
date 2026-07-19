// 标注编辑的交互几何工具（纯函数，无响应式状态）：
// - 屏幕(CSS px) ↔ 归一化图片坐标(0~1) 的相互变换（与 ImageViewer.renderImage 的 fit 逻辑一致）
// - 8 个缩放手柄的位置计算与命中测试
// - 拖拽 resize 的 bbox 重算
// 这些函数可独立单测，被 ImageViewer 的交互层复用，避免重复实现变换导致偏移。

export interface ImageFit {
  cw: number
  ch: number
  fitX: number
  fitY: number
  fitW: number
  fitH: number
  scaleX: number
  scaleY: number
}

/** 计算图片在画布中的 fit 变换（与 renderImage 一致，使用 CSS 像素） */
export function computeFit(
  iw: number,
  ih: number,
  cw: number,
  ch: number,
): ImageFit {
  const aspect = iw / ih
  const canvasAspect = cw / ch
  let fitW: number, fitH: number, fitX: number, fitY: number
  if (aspect > canvasAspect) {
    fitW = cw
    fitH = cw / aspect
    fitX = 0
    fitY = (ch - fitH) / 2
  } else {
    fitH = ch
    fitW = ch * aspect
    fitX = (cw - fitW) / 2
    fitY = 0
  }
  return { cw, ch, fitX, fitY, fitW, fitH, scaleX: fitW / iw, scaleY: fitH / ih }
}

export function normToScreen(
  nx: number,
  ny: number,
  fit: ImageFit,
  zoom: number,
  panX: number,
  panY: number,
): { x: number; y: number } {
  // 必须与图像绘制变换一致：translate(fit.fitX+panX) 后 scale(zoom·fit.fitW/imgW)
  // 即 屏幕 = fit.fitX + panX + zoom·nx·fit.fitW （与 drawAnnotation / toScreen 同源）
  return {
    x: fit.fitX + panX + zoom * nx * fit.fitW,
    y: fit.fitY + panY + zoom * ny * fit.fitH,
  }
}

export function screenToNorm(
  cssX: number,
  cssY: number,
  fit: ImageFit,
  zoom: number,
  panX: number,
  panY: number,
): { nx: number; ny: number } {
  // normToScreen 的逆运算：屏幕 = fit.fitX + panX + zoom·nx·fit.fitW
  const nx = (cssX - fit.fitX - panX) / (zoom * fit.fitW)
  const ny = (cssY - fit.fitY - panY) / (zoom * fit.fitH)
  return { nx, ny }
}

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLE_IDS: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** 由归一化 bbox [cx,cy,w,h] 求 8 个手柄的屏幕坐标 */
export function handlePositions(
  bbox: [number, number, number, number],
  fit: ImageFit,
  zoom: number,
  panX: number,
  panY: number,
): Record<HandleId, { x: number; y: number }> {
  const [cx, cy, w, h] = bbox
  const x1 = cx - w / 2
  const y1 = cy - h / 2
  const x2 = cx + w / 2
  const y2 = cy + h / 2
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const pts: Record<HandleId, [number, number]> = {
    nw: [x1, y1],
    n: [mx, y1],
    ne: [x2, y1],
    e: [x2, my],
    se: [x2, y2],
    s: [mx, y2],
    sw: [x1, y2],
    w: [x1, my],
  }
  const out = {} as Record<HandleId, { x: number; y: number }>
  for (const id of HANDLE_IDS) {
    out[id] = normToScreen(pts[id][0], pts[id][1], fit, zoom, panX, panY)
  }
  return out
}

/** 命中测试：返回距离鼠标最近且在容差内的手柄 id */
export function hitHandle(
  cssX: number,
  cssY: number,
  handles: Record<HandleId, { x: number; y: number }>,
  tol = 14,
): HandleId | null {
  for (const id of HANDLE_IDS) {
    const h = handles[id]
    if (Math.abs(cssX - h.x) <= tol && Math.abs(cssY - h.y) <= tol) return id
  }
  return null
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const MIN_SIZE = 0.005

/**
 * 根据拖拽手柄与当前归一化指针位置，重算 bbox [cx,cy,w,h]。
 * start 为拖拽开始时的 bbox；pNorm 为当前指针的归一化坐标。
 */
export function resizeBBox(
  start: [number, number, number, number],
  handle: HandleId,
  pNorm: { nx: number; ny: number },
): [number, number, number, number] {
  const [cx, cy, w, h] = start
  let x1 = cx - w / 2
  let y1 = cy - h / 2
  let x2 = cx + w / 2
  let y2 = cy + h / 2
  const px = clamp01(pNorm.nx)
  const py = clamp01(pNorm.ny)
  switch (handle) {
    case 'nw': x1 = px; y1 = py; break
    case 'n': y1 = py; break
    case 'ne': x2 = px; y1 = py; break
    case 'e': x2 = px; break
    case 'se': x2 = px; y2 = py; break
    case 's': y2 = py; break
    case 'sw': x1 = px; y2 = py; break
    case 'w': x1 = px; break
  }
  let nx1 = Math.min(x1, x2)
  let nx2 = Math.max(x1, x2)
  let ny1 = Math.min(y1, y2)
  let ny2 = Math.max(y1, y2)
  let nw = nx2 - nx1
  let nh = ny2 - ny1
  if (nw < MIN_SIZE) { const c = (nx1 + nx2) / 2; nx1 = c - MIN_SIZE / 2; nx2 = c + MIN_SIZE / 2; nw = MIN_SIZE }
  if (nh < MIN_SIZE) { const c = (ny1 + ny2) / 2; ny1 = c - MIN_SIZE / 2; ny2 = c + MIN_SIZE / 2; nh = MIN_SIZE }
  return [(nx1 + nx2) / 2, (ny1 + ny2) / 2, nw, nh]
}

/** 在画布上绘制 8 个缩放手柄（选中态） */
export function drawHandles(
  ctx: CanvasRenderingContext2D,
  handles: Record<HandleId, { x: number; y: number }>,
  zoom: number,
) {
  const size = Math.max(7, 11 / zoom)
  const half = size / 2
  ctx.save()
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#2D6FE6'
  ctx.lineWidth = 1.5 / zoom
  for (const id of HANDLE_IDS) {
    const h = handles[id]
    ctx.beginPath()
    ctx.rect(h.x - half, h.y - half, size, size)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

/** 命中测试归一化 bbox（用于点击选中），返回是否命中 */
export function hitBBox(
  nx: number,
  ny: number,
  bbox: [number, number, number, number],
): boolean {
  const [cx, cy, w, h] = bbox
  return nx >= cx - w / 2 && nx <= cx + w / 2 && ny >= cy - h / 2 && ny <= cy + h / 2
}

/** 命中测试归一化多边形（点在多边形内，射线法） */
export function hitPolygon(nx: number, ny: number, points: number[]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const xi = points[i], yi = points[i + 1]
    const xj = points[j], yj = points[j + 1]
    const intersect = (yi > ny) !== (yj > ny) && nx < ((xj - xi) * (ny - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// ===== OBB（旋转框）几何 =====

/** 由归一化 [cx,cy,w,h] + 弧度角求 obb 四个角（归一化坐标，CCW 顺序） */
export function obbCornersNorm(
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

/** 命中测试：点是否在（归一化）旋转框内 */
export function hitOBB(nx: number, ny: number, cx: number, cy: number, w: number, h: number, angle: number): boolean {
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  const dx = nx - cx
  const dy = ny - cy
  const lx = dx * cos - dy * sin
  const ly = dx * sin + dy * cos
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2
}

/** OBB 四角手柄的屏幕坐标（用于命中与绘制） */
export function obbCornerHandles(
  corners: [number, number][],
  fit: ImageFit,
  zoom: number,
  panX: number,
  panY: number,
): { id: number; x: number; y: number }[] {
  return corners.map((p, i) => {
    const s = normToScreen(p[0], p[1], fit, zoom, panX, panY)
    return { id: i, x: s.x, y: s.y }
  })
}

/** OBB 旋转手柄屏幕坐标：上边中点沿法线外推 */
export function obbRotateHandle(
  corners: [number, number][],
  fit: ImageFit, zoom: number, panX: number, panY: number,
): { x: number; y: number } {
  const topMidN: [number, number] = [
    (corners[0][0] + corners[1][0]) / 2,
    (corners[0][1] + corners[1][1]) / 2,
  ]
  // 法线方向（朝框外）：上边方向向量旋转 -90°
  const ex = corners[1][0] - corners[0][0]
  const ey = corners[1][1] - corners[0][1]
  const nlen = Math.hypot(ex, ey) || 1
  const nx = -ey / nlen
  const ny = ex / nlen
  const margin = 22 / (zoom * (fit.fitW || 1)) // 约 22px 屏幕距离的归一化长度（粗略）
  const handleN: [number, number] = [topMidN[0] + nx * margin, topMidN[1] + ny * margin]
  return normToScreen(handleN[0], handleN[1], fit, zoom, panX, panY)
}

/** 由一对对角（归一化）求 obb [cx,cy,w,h,angle] */
export function obbFromOppositeCorners(
  a: [number, number], b: [number, number]
): { cx: number; cy: number; w: number; h: number; angle: number } {
  const cx = (a[0] + b[0]) / 2
  const cy = (a[1] + b[1]) / 2
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const w = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)
  // 另一对角给出 h
  return { cx, cy, w, h: 0, angle }
}

/** 以「固定对角 + 拖拽角」重建 obb（用于拖角缩放/旋转） */
export function resizeOBB(
  corners: [number, number][],
  draggedIdx: number,
  pointer: [number, number],
): { coords: [number, number, number, number]; rotation: number } {
  const fixed = corners[(draggedIdx + 2) % 4]
  const cx = (fixed[0] + pointer[0]) / 2
  const cy = (fixed[1] + pointer[1]) / 2
  const dx = pointer[0] - fixed[0]
  const dy = pointer[1] - fixed[1]
  const w = Math.hypot(dx, dy) || 0.001
  const angle = Math.atan2(dy, dx)
  // h 由相邻边（从固定角到另一相邻角）决定
  const adj = corners[(draggedIdx + 1) % 4]
  const ex = adj[0] - fixed[0]
  const ey = adj[1] - fixed[1]
  const h = Math.abs(ex * Math.sin(angle) - ey * Math.cos(angle)) || 0.001
  return { coords: [cx, cy, w, h], rotation: angle }
}
