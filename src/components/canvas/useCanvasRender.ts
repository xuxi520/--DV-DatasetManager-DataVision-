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
  /** 画多边形进行中的顶点序列（归一化坐标），由组件层创建并注入两层 */
  drawPolygonPoints: Ref<{ nx: number; ny: number }[]>
  /** 光标靠近首顶点、可点击闭合的瞬时状态，由交互层写入、渲染层高亮 */
  drawSnapClose: Ref<boolean>
}

export function useCanvasRender(deps: CanvasRenderDeps) {
  const { props, annotations, selectedAnnotationIndex, dragMode, drawStart, drawCur, drawAnchored, drawPolygonPoints, drawSnapClose } = deps
  const store = useViewerState()

  const containerRef = ref<HTMLElement>()
  const canvasRef = ref<HTMLCanvasElement>()
  const zoom = ref(1.0)
  const panX = ref(0)
  const panY = ref(0)
  const imageInfo = ref<{ width: number; height: number; size: string } | null>(null)
  // 坏图/坏标注兜底状态：loadImage 失败或绘制异常时置位，供组件层展示降级提示，避免空白或崩溃
  const imageError = ref(false)
  const renderError = ref(false)
  let renderErrorLogged = false

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
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        currentImage = img
        imageError.value = false
        imageInfo.value = {
          width: img.width,
          height: img.height,
          size: formatSize(props.imageFile?.size || 0),
        }
        fitImageToCanvas()
        renderImage()
        resolve()
      }
      // 坏图降级：标记 imageError 并 resolve（不 reject，避免未捕获 Promise 拒绝），画布保持空白并展示提示
      img.onerror = () => {
        currentImage = null
        imageError.value = true
        imageInfo.value = null
        renderImage()
        resolve()
      }
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
    imageError.value = false
    renderError.value = false
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
    if (!currentImage) return
    const fit = computeFitLocal()
    try {
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
      renderError.value = false
      renderErrorLogged = false
    } catch (err) {
      // 坏标注/坏图绘制异常：捕获并跳过该图绘制，避免异常沿事件/rAF 抛出拖垮整批
      renderError.value = true
      if (!renderErrorLogged) {
        console.warn('[ImageViewer] 标注/图像绘制失败，已跳过该图渲染：', err)
        renderErrorLogged = true
      }
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

  /** 画多边形进行中的预览：流经所有已落顶点，并以虚线橡皮筋从末顶点连到当前光标，顶点画小圆点 */
  function drawPolygonPreview(ctx: CanvasRenderingContext2D, fit: ImageFit) {
    if (!drawPolygonPoints.value.length) return
    const z = zoom.value
    const toS = (nx: number, ny: number) => ({
      x: fit.fitX + panX.value + z * nx * fit.fitW,
      y: fit.fitY + panY.value + z * ny * fit.fitH,
    })
    const pts = drawPolygonPoints.value.map((p) => toS(p.nx, p.ny))
    if (drawAnchored.value) {
      const cur = toS(drawCur.value.nx, drawCur.value.ny)
      pts.push(cur)
    }
    ctx.save()
    ctx.lineWidth = 2 / z
    ctx.strokeStyle = '#409eff'
    ctx.setLineDash([6 / z, 4 / z])
    ctx.beginPath()
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#409eff'
    drawPolygonPoints.value.forEach((p, i) => {
      const s = toS(p.nx, p.ny)
      // 闭合吸附高亮：首顶点放大并以强调色描边，提示「点此闭合」
      if (i === 0 && drawSnapClose.value) {
        ctx.beginPath()
        ctx.fillStyle = '#67c23a'
        ctx.arc(s.x, s.y, 5 / z, 0, Math.PI * 2)
        ctx.fill()
        ctx.lineWidth = 2 / z
        ctx.strokeStyle = '#fff'
        ctx.stroke()
      } else {
        ctx.fillStyle = '#409eff'
        ctx.beginPath()
        ctx.arc(s.x, s.y, 3 / z, 0, Math.PI * 2)
        ctx.fill()
      }
    })
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
      if (dragMode.value === 'draw' && drawAnchored.value) {
        if (store.editDrawType.value === 'polygon') drawPolygonPreview(ctx, fit)
        else drawDrawPreview(ctx, fit)
      }
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
    if (dragMode.value === 'draw' && drawAnchored.value) {
      if (store.editDrawType.value === 'polygon') drawPolygonPreview(ctx, fit)
      else drawDrawPreview(ctx, fit)
    }
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
    // 画多边形进行中双击用于收尾（交由交互层 finalizePolygon），不重置缩放
    if (
      store.editingMode.value === 'draw' &&
      store.editDrawType.value === 'polygon' &&
      drawPolygonPoints.value.length >= 2
    ) {
      return
    }
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
    imageError,
    renderError,
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
