// 纯 canvas 绘制原语：从 ImageViewer 抽离，避免上帝组件。
// 这些函数不持有任何 Vue 响应式状态，所需的 image 尺寸 / zoom 均由调用方传入。
import type { ParsedAnnotation } from '../types'

export function hexA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function rRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number
) {
  const size = 10
  const style1 = getComputedStyle(document.documentElement).getPropertyValue('--chk1').trim() || '#1a1d28'
  const style2 = getComputedStyle(document.documentElement).getPropertyValue('--chk2').trim() || '#151821'

  for (let row = Math.floor(y / size) * size; row < y + h; row += size) {
    for (let col = Math.floor(x / size) * size; col < x + w; col += size) {
      ctx.fillStyle = ((Math.floor(col / size) + Math.floor(row / size)) % 2 === 0) ? style1 : style2
      ctx.fillRect(col, row, size, size)
    }
  }
}

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  label: string,
  color: string,
  isSelected: boolean,
  zoom: number,
  confidence?: number,
  description?: string
) {
  // 构建完整的标签文本
  let fullLabel = label
  if (confidence !== undefined) {
    fullLabel += ` ${(confidence * 100).toFixed(1)}%`
  }
  if (description) {
    fullLabel += ` | ${description}`
  }

  ctx.font = `500 ${10 / zoom}px "DM Mono", monospace`
  const tw = ctx.measureText(fullLabel).width
  const padding = 3 / zoom
  const height = 12 / zoom

  ctx.fillStyle = isSelected ? color : hexA(color, 0.8)
  rRect(ctx, x - padding, y - height + padding, tw + padding * 2, height, 3 / zoom)
  ctx.fill()

  ctx.fillStyle = '#fff'
  ctx.fillText(fullLabel, x, y - 2 / zoom)
}

export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: ParsedAnnotation,
  fitX: number, fitY: number,
  scaleX: number, scaleY: number,
  isSelected: boolean,
  imgW: number, imgH: number,
  zoom: number
) {
  const color = ann.color || '#F59E0B'
  const alpha = isSelected ? 0.3 : 0.14
  const lineWidth = isSelected ? 2.5 : 1.5
  const dash = isSelected ? [5, 3] : []

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = hexA(color, alpha)
  ctx.lineWidth = lineWidth / zoom
  ctx.setLineDash(dash)

  if (ann.type === 'polygon' && ann.points) {
    // Draw polygon
    ctx.beginPath()
    ann.points.forEach((pt, i) => {
      const x = ann.normalized ? fitX + pt[0] * scaleX * imgW : fitX + pt[0] * scaleX
      const y = ann.normalized ? fitY + pt[1] * scaleY * imgH : fitY + pt[1] * scaleY
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    // Draw label
    if (ann.points.length > 0) {
      const x = ann.normalized ? fitX + ann.points[0][0] * scaleX * imgW : fitX + ann.points[0][0] * scaleX
      const y = ann.normalized ? fitY + ann.points[0][1] * scaleY * imgH : fitY + ann.points[0][1] * scaleY
      drawLabel(ctx, x, y, ann.category, color, isSelected, zoom, ann.confidence, ann.description)
    }
  } else if (ann.bbox) {
    // Draw bounding box
    let [x, y, w, h] = ann.bbox

    if (ann.normalized) {
      x = fitX + x * imgW * scaleX
      y = fitY + y * imgH * scaleY
      w = w * imgW * scaleX
      h = h * imgH * scaleY
    } else {
      x = fitX + x * scaleX
      y = fitY + y * scaleY
      w = w * scaleX
      h = h * scaleY
    }

    ctx.fillRect(x, y, w, h)
    ctx.strokeRect(x, y, w, h)

    // Draw label
    drawLabel(ctx, x, y, ann.category, color, isSelected, zoom, ann.confidence, ann.description)
  }

  ctx.restore()
}
