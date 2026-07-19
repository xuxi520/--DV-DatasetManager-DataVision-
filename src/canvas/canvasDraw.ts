// 纯 canvas 绘制原语：从 ImageViewer 抽离，避免上帝组件。
// 这些函数不持有任何 Vue 响应式状态，所需的 image 尺寸 / zoom 均由调用方传入。
import type { ParsedAnnotation } from '../types'
import { decodeRle } from '../codec/rle'

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
  zoom: number,
  /** 预测覆盖层：固定品红 + 虚线 + 「P:」前缀，与 Ground-Truth 区分 */
  prediction = false,
  overrideColor?: string,
) {
  const isPred = prediction
  const color = isPred ? (overrideColor || '#E040FB') : (ann.color || '#F59E0B')
  const alpha = isPred ? 0.16 : (isSelected ? 0.3 : 0.14)
  const lineWidth = isPred ? 2 : (isSelected ? 2.5 : 1.5)
  const dash = isPred ? [4, 3] : (isSelected ? [5, 3] : [])
  const catLabel = isPred ? 'P: ' + ann.category : ann.category
  const norm = ann.normalized !== false
  const toX = (nx: number) => (norm ? fitX + nx * scaleX * imgW : fitX + nx * scaleX)
  const toY = (ny: number) => (norm ? fitY + ny * scaleY * imgH : fitY + ny * scaleY)

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = hexA(color, alpha)
  ctx.lineWidth = lineWidth / zoom
  ctx.setLineDash(dash)

  // 旋转框 OBB：用四角（归一化）绘制旋转多边形
  if (ann.type === 'obb' && ann.points && ann.points.length >= 4) {
    ctx.beginPath()
    ann.points.forEach((pt, i) => {
      const x = toX(pt[0])
      const y = toY(pt[1])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    const p0 = ann.points[0]
    drawLabel(ctx, toX(p0[0]), toY(p0[1]), catLabel, color, isSelected, zoom, ann.confidence, ann.description)
    ctx.restore()
    return
  }

  // 关键点：骨架线 + 点
  if (ann.type === 'keypoint' && ann.keypoints && ann.keypoints.length) {
    const pts = ann.keypoints.map((k) => ({ x: toX(k.x), y: toY(k.y), v: k.v }))
    if (ann.edges && ann.edges.length) {
      ctx.beginPath()
      for (const [a, b] of ann.edges) {
        if (pts[a] && pts[b] && pts[a].v > 0 && pts[b].v > 0) {
          ctx.moveTo(pts[a].x, pts[a].y)
          ctx.lineTo(pts[b].x, pts[b].y)
        }
      }
      ctx.strokeStyle = hexA(color, 0.7)
      ctx.stroke()
    }
    const r = Math.max(2.5, 3 / zoom)
    for (const p of pts) {
      if (p.v === 0) continue
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = p.v === 2 ? color : hexA(color, 0.55)
      ctx.fill()
      ctx.lineWidth = 1 / zoom
      ctx.strokeStyle = '#fff'
      ctx.stroke()
    }
    if (ann.bbox) {
      drawLabel(ctx, toX(ann.bbox[0]), toY(ann.bbox[1]), catLabel, color, isSelected, zoom, ann.confidence, ann.description)
    }
    ctx.restore()
    return
  }

  // 实例掩码：RLE 解码位图 或 多边形填充
  if (ann.type === 'mask') {
    if (ann.rle) {
      drawRleMask(ctx, ann.rle, fitX, fitY, scaleX * imgW, scaleY * imgH, color, isSelected ? 0.5 : 0.4)
      if (ann.bbox) {
        drawLabel(ctx, toX(ann.bbox[0]), toY(ann.bbox[1]), catLabel, color, isSelected, zoom, ann.confidence, ann.description)
      }
      ctx.restore()
      return
    }
    if (ann.points && ann.points.length >= 3) {
      ctx.beginPath()
      ann.points.forEach((pt, i) => {
        const x = toX(pt[0])
        const y = toY(pt[1])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      const p0 = ann.points[0]
      drawLabel(ctx, toX(p0[0]), toY(p0[1]), catLabel, color, isSelected, zoom, ann.confidence, ann.description)
      ctx.restore()
      return
    }
  }

  if (ann.type === 'polygon' && ann.points) {
    // Draw polygon
    ctx.beginPath()
    ann.points.forEach((pt, i) => {
      const x = toX(pt[0])
      const y = toY(pt[1])
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
      drawLabel(ctx, toX(ann.points[0][0]), toY(ann.points[0][1]), catLabel, color, isSelected, zoom, ann.confidence, ann.description)
    }
  } else if (ann.bbox) {
    // Draw bounding box
    let [x, y, w, h] = ann.bbox

    if (norm) {
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

    // 退化框（线标注：某一维为 0）无法用矩形描边画出，改为绘制线段
    if (w === 0 || h === 0) {
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + w, y + h)
      ctx.stroke()
    } else {
      ctx.fillRect(x, y, w, h)
      ctx.strokeRect(x, y, w, h)
    }

    // Draw label
    drawLabel(ctx, x, y, catLabel, color, isSelected, zoom, ann.confidence, ann.description)
  }

  ctx.restore()
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** 解码 COCO RLE 并绘制到画布（覆盖整图区域） */
function drawRleMask(
  ctx: CanvasRenderingContext2D,
  rle: { size: [number, number]; counts: string | number[] },
  fitX: number, fitY: number, drawW: number, drawH: number,
  color: string, alpha: number,
) {
  try {
    if (!rle || !Array.isArray(rle.size) || rle.size.length < 2) return
    const [h, w] = rle.size
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return
    const mask = decodeRle(rle.counts, rle.size)
    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const octx = off.getContext('2d')
    if (!octx) return
    const img = octx.createImageData(w, h)
    const { r, g, b } = hexToRgb(color)
    const a = Math.round(alpha * 255)
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) {
        const o = i * 4
        img.data[o] = r
        img.data[o + 1] = g
        img.data[o + 2] = b
        img.data[o + 3] = a
      }
    }
    octx.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(off, fitX, fitY, drawW, drawH)
    ctx.imageSmoothingEnabled = true
  } catch {
    /* RLE 解码失败则跳过填充 */
  }
}
