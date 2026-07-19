import { ref, onMounted, onUnmounted, onActivated, nextTick, watch, type Ref } from 'vue'
import { drawCheckerboard, drawAnnotation } from '../../canvas/canvasDraw'
import { useViewerState } from '../../composables/useViewerState'
import {
  computeFit,
  screenToNorm,
  handlePositions,
  obbCornersNorm,
  drawHandles,
  HANDLE_IDS,
  type ImageFit,
  type HandleId,
} from '../../canvas/canvasEdit'
import { pBBoxToC, type DragMode } from './geometry'
import type { ParsedAnnotation, ImageFile } from '../../types'

export interface ImageViewerProps {
  imageFile?: ImageFile
  annotations?: ParsedAnnotation[]
  showInfo?: boolean
  showAnnotations?: boolean
  selectedIndex?: number
  predictions?: ParsedAnnotation[]
  showPredictions?: boolean
}

export interface CanvasRenderDeps {
  props: ImageViewerProps
  annotations: Ref<ParsedAnnotation[]>
  selectedAnnotationIndex: Ref<number>
  dragMode: Ref<DragMode>
  drawStart: Ref<{ nx: number; ny: number }>
  drawCur: Ref<{ nx: number; ny: number }>
  drawAnchored: Ref<boolean>
}

export function useCanvasRender(deps: CanvasRenderDeps) {
  const { props, annotations, selectedAnnotationIndex, dragMode, drawStart, drawCur, drawAnchored } = deps
  const store = useViewerState()

  const containerRef = ref<HTMLElement>()
  const canvasRef = ref<HTMLCanvasElement>()
  const zoom = ref(1.0)
  const panX = ref(0)
  const panY = ref(0)
  const imageInfo = ref<{ width: number; height: number; size: string } | null>(null)

  let currentImage: HTMLImageElement | null = null
  let resizeObserver: ResizeObserver | null = null

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + 'B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
  }

  function computeFitLocal(): ImageFit {
    const canvas = canvasRef.value
    if (!canvas || !currentImage) {
      return { fitX: 0, fitY: 0, fitW: 0, fitH: 0, scaleX: 1, scaleY: 1, cw: 0, ch: 0 }
    }
    const dpr = window.devicePixelRatio || 1
    const cw = canvas.width / dpr
    const ch = canvas.height / dpr
    return computeFit(currentImage.width, currentImage.height, cw, ch)
  }

  async function loadImage(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        currentImage = img
        imageInfo.value = {
          width: img.width,
          height: img.height,
          size: formatSize(props.imageFile?.size || 0),
        }
        fitImageToCanvas()
        renderImage()
        resolve()
      }
      img.onerror = reject
      img.src = url
    })
  }

  function clearCanvas() {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    currentImage = null
    imageInfo.value = null
  }

  function fitImageToCanvas() {
    if (!currentImage || !containerRef.value) return
    const container = containerRef.value
    const canvas = canvasRef.value
    if (!canvas) return
    if (container.clientWidth === 0 || container.clientHeight === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = container.clientWidth * dpr
    canvas.height = container.clientHeight * dpr
    canvas.style.width = container.clientWidth + 'px'
    canvas.style.height = container.clientHeight + 'px'
  }

  function renderImage() {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (currentImage) {
      const fit = computeFitLocal()
      // 图像按「fit 比例 × zoom」缩放绘制，使其精确落在 fit 区域内，
      // 与标注/锚点使用同一坐标约定（归一化→屏幕：fit.fitX+panX+zoom·nx·fit.fitW）
      const sx = (zoom.value * fit.fitW) / currentImage.width
      const sy = (zoom.value * fit.fitH) / currentImage.height
      ctx.save()
      ctx.translate(fit.fitX + panX.value, fit.fitY + panY.value)
      ctx.scale(sx, sy)
      drawCheckerboard(ctx, 0, 0, currentImage.width, currentImage.height)
      ctx.drawImage(currentImage, 0, 0, currentImage.width, currentImage.height)
      ctx.restore()
      drawAnnotations(ctx, fit)
    }
  }

  function drawDrawPreview(ctx: CanvasRenderingContext2D, fit: ImageFit) {
    if (dragMode.value !== 'draw' || !drawAnchored.value) return
    const z = zoom.value
    const toS = (nx: number, ny: number) => ({
      x: fit.fitX + panX.value + z * nx * fit.fitW,
      y: fit.fitY + panY.value + z * ny * fit.fitH,
    })
    const a = toS(drawStart.value.nx, drawStart.value.ny)
    const b = toS(drawCur.value.nx, drawCur.value.ny)
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const w = Math.abs(b.x - a.x)
    const h = Math.abs(b.y - a.y)
    ctx.save()
    ctx.lineWidth = 2 / z
    ctx.strokeStyle = '#409eff'
    ctx.setLineDash([6 / z, 4 / z])
    ctx.strokeRect(x, y, w, h)
    ctx.restore()
  }

  function drawAnnotations(ctx: CanvasRenderingContext2D, fit: ImageFit) {
    if (!currentImage) return
    const z = zoom.value
    // 归一化→屏幕（CSS px）：与图像绘制使用同一约定，保证框贴合图像、锚点不脱离
    const toScreen = (nx: number, ny: number) => ({
      x: fit.fitX + panX.value + z * nx * fit.fitW,
      y: fit.fitY + panY.value + z * ny * fit.fitH,
    })
    const toL = toScreen
    // handlePositions/normToScreen 已返回含 pan/zoom 的屏幕坐标，直接绘制即可
    const toLocalHandle = (p: { x: number; y: number }) => p
    const annotationsList = annotations.value
    const selIdx = selectedAnnotationIndex.value
    const sel = selIdx >= 0 ? annotationsList[selIdx] : null
    const editing = store.editingMode.value === 'select'

    for (let i = 0; i < annotationsList.length; i++) {
      const ann = annotationsList[i]
      if (!ann.color) ann.color = '#409eff'
      drawAnnotation(
        ctx, ann,
        fit.fitX + panX.value, fit.fitY + panY.value,
        (z * fit.fitW) / currentImage.width, (z * fit.fitH) / currentImage.height,
        false,
        currentImage.width, currentImage.height, z,
      )
    }
    if (props.showPredictions && props.predictions) {
      for (const p of props.predictions) {
        if (!p.color) p.color = '#ff9800'
        drawAnnotation(
          ctx, p,
          fit.fitX + panX.value, fit.fitY + panY.value,
          (z * fit.fitW) / currentImage.width, (z * fit.fitH) / currentImage.height,
          false,
          currentImage.width, currentImage.height, z, true,
        )
      }
    }
    if (!sel || !editing) {
      if (dragMode.value === 'draw' && drawAnchored.value) drawDrawPreview(ctx, fit)
      return
    }
    ctx.save()
    ctx.strokeStyle = '#409eff'
    ctx.lineWidth = 1 / z
    if (sel.type === 'bbox' && sel.bbox) {
      const [cx, cy, w, h] = pBBoxToC(sel.bbox)
      const tl = toL(cx - w / 2, cy - h / 2)
      const br = toL(cx + w / 2, cy + h / 2)
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
      const handles = handlePositions(pBBoxToC(sel.bbox), fit, z, panX.value, panY.value)
      const localH: Record<HandleId, { x: number; y: number }> = {
        nw: toLocalHandle(handles.nw), ne: toLocalHandle(handles.ne),
        se: toLocalHandle(handles.se), sw: toLocalHandle(handles.sw),
        n: toLocalHandle(handles.n), s: toLocalHandle(handles.s),
        e: toLocalHandle(handles.e), w: toLocalHandle(handles.w),
      }
      drawHandles(ctx, localH, z)
    } else if (sel.type === 'polygon' || sel.type === 'mask') {
      const pts = sel.points || []
      const localPts = pts.map((p) => toL(p[0], p[1]))
      ctx.beginPath()
      localPts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.closePath()
      ctx.stroke()
      const rec: Record<HandleId, { x: number; y: number }> = {} as Record<HandleId, { x: number; y: number }>
      pts.slice(0, HANDLE_IDS.length).forEach((p, i) => {
        rec[HANDLE_IDS[i]] = toL(p[0], p[1])
      })
      drawHandles(ctx, rec, z)
    } else if (sel.type === 'obb' && sel.bbox) {
      const [cx, cy, w, h] = pBBoxToC(sel.bbox)
      const angle = sel.rotation ?? 0
      const corners = obbCornersNorm(cx, cy, w, h, angle)
      const local = corners.map((c) => toL(c[0], c[1]))
      const topMid = { x: (local[0].x + local[1].x) / 2, y: (local[0].y + local[1].y) / 2 }
      const dirX = local[1].x - local[0].x
      const dirY = local[1].y - local[0].y
      const len = Math.hypot(dirX, dirY) || 1
      const rh = { x: topMid.x + (-dirY / len) * 22, y: topMid.y + (dirX / len) * 22 }
      ctx.beginPath()
      local.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.closePath()
      ctx.stroke()
      const rec: Record<HandleId, { x: number; y: number }> = {} as Record<HandleId, { x: number; y: number }>
      local.forEach((p, i) => {
        rec[HANDLE_IDS[i]] = p
      })
      rec['rot' as HandleId] = rh
      drawHandles(ctx, rec, z)
    } else if (sel.type === 'keypoint' && sel.keypoints) {
      const localPts = sel.keypoints.map((kp) => toL(kp.x, kp.y))
      ctx.fillStyle = '#409eff'
      localPts.forEach((p) => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 4 / z, 0, Math.PI * 2)
        ctx.fill()
      })
      if (sel.edges) {
        for (const [a, b] of sel.edges) {
          if (localPts[a] && localPts[b]) {
            ctx.beginPath()
            ctx.moveTo(localPts[a].x, localPts[a].y)
            ctx.lineTo(localPts[b].x, localPts[b].y)
            ctx.stroke()
          }
        }
      }
      const rec: Record<HandleId, { x: number; y: number }> = {} as Record<HandleId, { x: number; y: number }>
      localPts.slice(0, HANDLE_IDS.length).forEach((p, i) => {
        rec[HANDLE_IDS[i]] = p
      })
      drawHandles(ctx, rec, z)
    }
    ctx.restore()
    if (dragMode.value === 'draw' && drawAnchored.value) drawDrawPreview(ctx, fit)
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const canvas = canvasRef.value
    if (!canvas || !currentImage) return
    const rect = canvas.getBoundingClientRect()
    const cssX = e.clientX - rect.left
    const cssY = e.clientY - rect.top
    const fit = computeFitLocal()
    // 用 CSS 像素（与 fit 坐标系一致），保证以鼠标为锚点缩放不漂移
    const imgX = (cssX - fit.fitX - panX.value) / zoom.value
    const imgY = (cssY - fit.fitY - panY.value) / zoom.value
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    zoom.value = Math.max(0.1, Math.min(10, zoom.value * factor))
    panX.value = cssX - fit.fitX - imgX * zoom.value
    panY.value = cssY - fit.fitY - imgY * zoom.value
    renderImage()
  }

  function onDoubleClick() {
    zoom.value = 1.0
    panX.value = 0
    panY.value = 0
    renderImage()
  }

  function initResizeObserver() {
    if (!containerRef.value) return
    resizeObserver = new ResizeObserver(() => {
      fitImageToCanvas()
      renderImage()
    })
    resizeObserver.observe(containerRef.value)
    window.addEventListener('resize', onResize)
  }

  function onResize() {
    fitImageToCanvas()
    renderImage()
  }

  function resetView() {
    zoom.value = 1.0
    panX.value = 0
    panY.value = 0
    renderImage()
  }

  /** 指针信息：CSS 坐标 + 归一化坐标 + 当前适配，供交互切片命中测试使用
   *  注意：screenToNorm 使用的坐标系是 CSS 像素（fit 由 canvas.width/dpr 反算而来），
   *  因此这里绝不能再乘 dpr，否则命中测试会被放大 dpr 倍而错位。 */
  function pointerInfo(e: MouseEvent) {
    const canvas = canvasRef.value
    const fit = computeFitLocal()
    const rect = canvas?.getBoundingClientRect()
    const cssX = e.clientX - (rect?.left ?? 0)
    const cssY = e.clientY - (rect?.top ?? 0)
    const norm = screenToNorm(cssX, cssY, fit, zoom.value, panX.value, panY.value)
    return { cssX, cssY, norm, fit }
  }

  watch(
    () => props.imageFile?.url,
    async (url) => {
      if (url) await loadImage(url)
      else clearCanvas()
    },
    { immediate: true },
  )
  watch(
    () => props.annotations,
    () => renderImage(),
    { deep: true },
  )
  watch(
    () => props.predictions,
    () => renderImage(),
    { deep: true },
  )
  watch(() => props.showPredictions, () => renderImage())
  watch(
    () => props.selectedIndex,
    (v) => {
      if (v != null && v !== selectedAnnotationIndex.value) {
        selectedAnnotationIndex.value = v
        renderImage()
      }
    },
  )

  onMounted(() => {
    initResizeObserver()
    nextTick(() => {
      onResize()
      if (props.imageFile?.url) loadImage(props.imageFile.url)
    })
  })
  onActivated(() => {
    nextTick(() =>
      requestAnimationFrame(() => {
        fitImageToCanvas()
        renderImage()
      }),
    )
  })
  onUnmounted(() => {
    window.removeEventListener('resize', onResize)
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
  })

  return {
    containerRef,
    canvasRef,
    zoom,
    panX,
    panY,
    imageInfo,
    renderImage,
    loadImage,
    clearCanvas,
    fitImageToCanvas,
    onWheel,
    onDoubleClick,
    resetView,
    pointerInfo,
  }
}
