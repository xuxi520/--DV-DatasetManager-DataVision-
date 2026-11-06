import { ref, computed, watch, onMounted, onUnmounted, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useViewerState } from '../../composables/useViewerState'
import {
  computeFit,
  screenToNorm,
  normToScreen,
  handlePositions,
  hitHandle,
  resizeBBox,
  hitBBox,
  hitPolygon,
  HANDLE_IDS,
  obbCornersNorm,
  hitOBB,
  obbCornerHandles,
  obbRotateHandle,
  type ImageFit,
  type HandleId,
} from '../../canvas/canvasEdit'
import { pBBoxToC, flatten, type DragMode } from './geometry'
import type { ParsedAnnotation, ImageFile } from '../../types'
import type { ImageViewerProps } from './useCanvasRender'

export interface CanvasInteractionDeps {
  props: ImageViewerProps
  store: ReturnType<typeof useViewerState>
  annotations: Ref<ParsedAnnotation[]>
  selectedAnnotationIndex: Ref<number>
  canvasRef: Ref<HTMLCanvasElement | undefined>
  zoom: Ref<number>
  panX: Ref<number>
  panY: Ref<number>
  dragMode: Ref<DragMode>
  drawStart: Ref<{ nx: number; ny: number }>
  drawCur: Ref<{ nx: number; ny: number }>
  drawAnchored: Ref<boolean>
  /** 画多边形进行中的顶点序列（归一化坐标），与 drawStart/drawCur 同样由组件层创建并注入两层 */
  drawPolygonPoints: Ref<{ nx: number; ny: number }[]>
  /** 光标靠近首顶点、可点击闭合的瞬时状态，写入渲染层后由首顶点高亮反馈 */
  drawSnapClose: Ref<boolean>
  imageInfo: Ref<{ width: number; height: number; size: string } | null>
  pointerInfo: (e: MouseEvent) => { cssX: number; cssY: number; norm: { nx: number; ny: number }; fit: ImageFit }
  requestRender: () => void
  selectAnnotation: (index: number) => void
  highlightAnnotation: (index: number, event?: MouseEvent) => void
}

export function useCanvasInteraction(deps: CanvasInteractionDeps) {
  const {
    props, store, annotations, selectedAnnotationIndex, canvasRef, zoom, panX, panY,
    dragMode, drawStart, drawCur, drawAnchored, drawPolygonPoints, drawSnapClose, imageInfo, pointerInfo, requestRender,
    selectAnnotation, highlightAnnotation,
  } = deps

  const canvasCursor = computed(() => {
    if (dragMode.value === 'pan') return 'grabbing'
    if (dragMode.value === 'move' || dragMode.value === 'resize' || dragMode.value === 'rotate') return 'move'
    if (store.editingMode.value === 'draw') return 'crosshair'
    return 'default'
  })

  const dragHandle = ref<HandleId>('se')
  const dragSub = ref<'bbox' | 'polygon' | 'mask' | 'obb' | 'keypoint' | 'kp-point'>('bbox')
  const dragHandleIdx = ref(0)
  const dragKpIndex = ref(-1)
  const dragStartNorm = ref({ nx: 0, ny: 0 })
  const dragStartBBox = ref<number[]>([0, 0, 0, 0])
  const dragStartRotation = ref(0)

  /** 将归一化坐标钳制在图片范围内 [0,1]，防止框被拉出图片进入画布 */
  const clamp01n = (v: number) => Math.max(0, Math.min(1, v))

  let drawRaf = 0

  function startDrawPreviewLoop() {
    cancelAnimationFrame(drawRaf)
    const loop = () => {
      requestRender()
      drawRaf = requestAnimationFrame(loop)
    }
    drawRaf = requestAnimationFrame(loop)
  }

  function hitTestAnn(ann: ParsedAnnotation, nx: number, ny: number): boolean {
    if (ann.type === 'obb' && ann.bbox) {
      const [cx, cy, w, h] = pBBoxToC(ann.bbox)
      const angle = ann.rotation ?? 0
      return hitOBB(nx, ny, cx, cy, w, h, angle)
    }
    if (ann.type === 'bbox' && ann.bbox) return hitBBox(nx, ny, pBBoxToC(ann.bbox))
    if ((ann.type === 'polygon' || ann.type === 'mask') && ann.points)
      return hitPolygon(nx, ny, flatten(ann.points))
    return false
  }

  function onGestureMove(e: MouseEvent) {
    e.preventDefault()
    if (dragMode.value === 'none') return
    const file = props.imageFile
    const idx = selectedAnnotationIndex.value
    if (!file || idx < 0 || !annotations.value[idx]) return
    const { norm } = pointerInfo(e)
    const ann = annotations.value[idx]
    if (dragMode.value === 'pan') return
    if (dragMode.value === 'move') {
      // dragStartBBox 为 Parsed 左上式 [x,y,w,h]，canonical coords 需中心式 [cx,cy,w,h]
      const [bx, by, bw, bh] = dragStartBBox.value
      const [cx, cy] = pBBoxToC([bx, by, bw, bh])
      const halfW = bw / 2
      const halfH = bh / 2
      // 钳制到图片边界内，避免整框被移出图片
      const ncx = Math.max(halfW, Math.min(1 - halfW, cx + (norm.nx - dragStartNorm.value.nx)))
      const ncy = Math.max(halfH, Math.min(1 - halfH, cy + (norm.ny - dragStartNorm.value.ny)))
      store.setAnnotationCoords(file, idx, [ncx, ncy, bw, bh])
    } else if (dragMode.value === 'resize') {
      const startC = pBBoxToC(dragStartBBox.value)
      const resized = resizeBBox(startC, dragHandle.value, norm)
      // resized 已是中心式 [cx,cy,w,h]，直接写入 canonical（勿再 cBBoxToP）
      store.setAnnotationCoords(file, idx, resized)
    } else if (dragMode.value === 'rotate') {
      if (ann.type !== 'obb' || !ann.bbox) return
      const [cx, cy, w, h] = pBBoxToC(ann.bbox)
      const dx = norm.nx - cx
      const dy = norm.ny - cy
      let ang = Math.atan2(dy, dx) + Math.PI / 2
      if (ann.rotation != null) ang = ang - dragStartRotation.value
      store.setAnnotationRotation(file, idx, ang)
    } else if (dragMode.value === 'draw') {
      drawCur.value = { nx: norm.nx, ny: norm.ny }
    }
  }

  function onGestureUp() {
    window.removeEventListener('mousemove', onGestureMove)
    window.removeEventListener('mouseup', onGestureUp)
    const file = props.imageFile
    const idx = selectedAnnotationIndex.value
    if (dragMode.value === 'draw') {
      cancelAnimationFrame(drawRaf)
      if (store.editDrawType.value === 'polygon') {
        // 多边形：松开不作为定稿，保持顶点与橡皮筋，等待继续点选 / 双击 / Enter
        dragMode.value = 'none'
        requestRender()
        return
      }
      const w = Math.abs(drawCur.value.nx - drawStart.value.nx)
      const h = Math.abs(drawCur.value.ny - drawStart.value.ny)
      if (w > 0.001 && h > 0.001) {
        // 拖拽式绘制完成
        finalizeDraw()
        drawAnchored.value = false
        dragMode.value = 'none'
        requestRender()
      } else {
        // 仅点选落锚点（未拖拽）：保留 drawAnchored，等待第二次点选；不告警、不收尾
        dragMode.value = 'draw'
        drawCur.value = { ...drawStart.value }
        requestRender()
      }
      return
    }
    if (dragMode.value === 'rotate') {
      if (file && idx >= 0) {
        const cur = annotations.value[idx]
        store.commitRotationEdit(file, idx, dragStartRotation.value, cur.rotation ?? 0)
      }
    } else if (dragMode.value !== 'none' && dragMode.value !== 'pan') {
      if (file && idx >= 0) {
        const cur = annotations.value[idx]
        // canonical coords 为中心式 [cx,cy,w,h]；dragStartBBox/cur.bbox 为左上式，需转换后再入历史
        store.commitCoordsEdit(file, idx, pBBoxToC(dragStartBBox.value), pBBoxToC(cur.bbox || [0, 0, 0, 0]))
      }
    }
    dragMode.value = 'none'
    requestRender()
  }

  function doPan(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startPanX = panX.value
    const startPanY = panY.value
    const move = (ev: MouseEvent) => {
      const dpr = window.devicePixelRatio || 1
      panX.value = startPanX + (ev.clientX - startX) * dpr
      panY.value = startPanY + (ev.clientY - startY) * dpr
      requestRender()
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      dragMode.value = 'none'
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function startGesture(kind: DragMode, e: MouseEvent) {
    e.preventDefault()
    dragMode.value = kind
    window.addEventListener('mousemove', onGestureMove)
    window.addEventListener('mouseup', onGestureUp)
  }

  function cancelDraw() {
    if (dragMode.value === 'draw') {
      dragMode.value = 'none'
      drawAnchored.value = false
      drawPolygonPoints.value = []
      drawSnapClose.value = false
      cancelAnimationFrame(drawRaf)
      requestRender()
    }
  }

  /** 收尾多边形：去相邻重复顶点（双击会重复压入同一点），≥3 点才生成；否则清空。 */
  function finalizePolygon(file: ImageFile) {
    const pts = drawPolygonPoints.value
    const dedup: { nx: number; ny: number }[] = []
    for (const p of pts) {
      const last = dedup[dedup.length - 1]
      if (!last || Math.abs(last.nx - p.nx) > 1e-4 || Math.abs(last.ny - p.ny) > 1e-4) {
        dedup.push({ nx: clamp01n(p.nx), ny: clamp01n(p.ny) })
      }
    }
    drawPolygonPoints.value = []
    drawAnchored.value = false
    dragMode.value = 'none'
    cancelAnimationFrame(drawRaf)
    if (dedup.length < 3) {
      ElMessage.warning('多边形至少需要 3 个顶点')
      requestRender()
      return
    }
    const idx = store.addPolygonAnnotation(
      file,
      dedup.map((p) => [p.nx, p.ny] as [number, number]),
      store.editClassId.value,
    )
    if (idx >= 0) selectAnnotation(idx)
    else ElMessage.warning('新建多边形失败')
    requestRender()
  }

  /** 画多边形时双击收尾（与渲染层的缩放重置互斥，由渲染层在该场景跳过重置） */
  function onDblClick() {
    if (
      store.editingMode.value === 'draw' &&
      store.editDrawType.value === 'polygon' &&
      drawPolygonPoints.value.length >= 2
    ) {
      if (props.imageFile) finalizePolygon(props.imageFile)
    }
  }

  /** 由 drawStart/drawCur 生成新 bbox 标注（canonical 中心式坐标）。drawStart==drawCur 视为过小。 */
  function finalizeDraw() {
    const file = props.imageFile
    if (!file) return
    const w = Math.abs(drawCur.value.nx - drawStart.value.nx)
    const h = Math.abs(drawCur.value.ny - drawStart.value.ny)
    if (w > 0.001 && h > 0.001) {
      const x = Math.min(drawStart.value.nx, drawCur.value.nx)
      const y = Math.min(drawStart.value.ny, drawCur.value.ny)
      const [cx, cy] = pBBoxToC([x, y, w, h])
      const newIdx = store.addBBoxAnnotation(file, [cx, cy, w, h], store.editClassId.value)
      if (newIdx >= 0) selectAnnotation(newIdx)
      else ElMessage.warning('新建标注失败')
    } else {
      ElMessage.warning('绘制框过小，已忽略')
    }
  }

  function onDrawKeydown(e: KeyboardEvent) {
    if (dragMode.value === 'draw' && store.editingMode.value === 'draw') {
      if (e.key === 'Escape') {
        cancelDraw()
        return
      }
      if (e.key === 'Enter' && store.editDrawType.value === 'polygon' && props.imageFile) {
        e.preventDefault()
        finalizePolygon(props.imageFile)
      }
    }
  }

  function onCanvasContextMenu(e: MouseEvent) {
    e.preventDefault()
  }

  function onMouseDown(e: MouseEvent) {
    if (store.editingMode.value !== 'select' && store.editingMode.value !== 'draw') return
    if (!imageInfo.value || !props.imageFile) return
    const { cssX, cssY, norm, fit } = pointerInfo(e)
    if (store.editingMode.value === 'draw') {
      if (store.editDrawType.value === 'polygon') {
        // 右键：撤销上一个顶点（至少还有点时生效）
        if (e.button === 2) {
          if (drawPolygonPoints.value.length > 0) {
            const next = drawPolygonPoints.value.slice(0, -1)
            drawPolygonPoints.value = next
            const last = next[next.length - 1]
            if (last) {
              drawStart.value = last
              drawCur.value = last
            } else {
              drawAnchored.value = false
            }
            requestRender()
          }
          return
        }
        // 左键：追加一个顶点（橡皮筋从末顶点指向光标），双击 / Enter 收尾，Esc 取消，右键撤上一点
        // 靠近首顶点且已有 ≥3 点：直接闭合收尾（不再追加与首点重复的末点）
        if (drawSnapClose.value && drawPolygonPoints.value.length >= 3 && props.imageFile) {
          finalizePolygon(props.imageFile)
          return
        }
        const p = { nx: clamp01n(norm.nx), ny: clamp01n(norm.ny) }
        const lastPt = drawPolygonPoints.value[drawPolygonPoints.value.length - 1]
        if (lastPt && Math.abs(lastPt.nx - p.nx) < 1e-3 && Math.abs(lastPt.ny - p.ny) < 1e-3) {
          // 与上一个顶点过近，忽略（避免快速连点产生的零长边/重复点）
          requestRender()
          return
        }
        drawPolygonPoints.value = [...drawPolygonPoints.value, p]
        drawStart.value = p
        drawCur.value = p
        drawAnchored.value = true
        startDrawPreviewLoop()
        startGesture('draw', e)
        requestRender()
        return
      }
      if (!drawAnchored.value) {
        // 第一次点选：落锚点（之后再次点选收尾，或直接拖拽一次完成），钳制在图片内
        drawStart.value = { nx: clamp01n(norm.nx), ny: clamp01n(norm.ny) }
        drawCur.value = { nx: clamp01n(norm.nx), ny: clamp01n(norm.ny) }
        drawAnchored.value = true
        startDrawPreviewLoop()
        startGesture('draw', e)
      } else {
        // 第二次点选：收尾生成新框
        drawCur.value = { nx: clamp01n(norm.nx), ny: clamp01n(norm.ny) }
        finalizeDraw()
        drawAnchored.value = false
        dragMode.value = 'none'
        cancelAnimationFrame(drawRaf)
        requestRender()
      }
      return
    }
    const sel = annotations.value[selectedAnnotationIndex.value]
    if (sel) {
      if (sel.type === 'bbox' && sel.bbox) {
        const handles = handlePositions(pBBoxToC(sel.bbox), fit, zoom.value, panX.value, panY.value)
        const hit = hitHandle(cssX, cssY, handles)
        if (hit) {
          dragHandle.value = hit
          dragStartBBox.value = sel.bbox
          startGesture('resize', e)
          return
        }
      } else if (sel.type === 'obb' && sel.bbox) {
        const [cx, cy, w, h] = pBBoxToC(sel.bbox)
        const corners = obbCornersNorm(cx, cy, w, h, sel.rotation ?? 0)
        const ch = obbCornerHandles(corners, fit, zoom.value, panX.value, panY.value)
        const rec: Record<HandleId, { x: number; y: number }> =
          {} as Record<HandleId, { x: number; y: number }>
        ch.forEach((h) => {
          rec[HANDLE_IDS[h.id] as HandleId] = { x: h.x, y: h.y }
        })
        const hit = hitHandle(cssX, cssY, rec)
        if (hit) {
          dragHandleIdx.value = Number(hit.replace('c', ''))
          dragStartBBox.value = sel.bbox
          dragStartRotation.value = sel.rotation ?? 0
          startGesture('rotate', e)
          return
        }
        const rh = obbRotateHandle(corners, fit, zoom.value, panX.value, panY.value)
        if (Math.hypot(cssX - rh.x, cssY - rh.y) <= 12) {
          dragStartBBox.value = sel.bbox
          dragStartRotation.value = sel.rotation ?? 0
          startGesture('rotate', e)
          return
        }
      } else if (sel.type === 'keypoint' && sel.keypoints) {
        for (let i = 0; i < sel.keypoints.length; i++) {
          const kp = sel.keypoints[i]
          const s = normToScreen(kp.x, kp.y, fit, zoom.value, panX.value, panY.value)
          if (Math.hypot(cssX - s.x, cssY - s.y) <= 12) {
            dragKpIndex.value = i
            dragSub.value = 'kp-point'
            dragStartNorm.value = { nx: kp.x, ny: kp.y }
            startGesture('move', e)
            return
          }
        }
      }
    }
    const idx = annotations.value.findIndex((a) => hitTestAnn(a, norm.nx, norm.ny))
    if (idx >= 0) {
      selectAnnotation(idx)
      const ann = annotations.value[idx]
      if (ann.bbox) {
        dragStartNorm.value = { nx: norm.nx, ny: norm.ny }
        dragStartBBox.value = ann.bbox
        startGesture('move', e)
      }
      return
    }
    if (e.button === 2) return
    dragStartNorm.value = { nx: norm.nx, ny: norm.ny }
    doPan(e)
    dragMode.value = 'pan'
  }

  function onCanvasMouseMove(e: MouseEvent) {
    if (!imageInfo.value || !canvasRef.value) return
    const canvas = canvasRef.value
    const rect = canvas.getBoundingClientRect()
    const cssX = e.clientX - rect.left
    const cssY = e.clientY - rect.top
    const fit = computeFit(imageInfo.value.width, imageInfo.value.height, rect.width, rect.height)
    const norm = screenToNorm(cssX, cssY, fit, zoom.value, panX.value, panY.value)
    // 绘制模式且已落锚点：预览框随光标橡皮筋式跟随，并钳制在图片内
    if (drawAnchored.value && store.editingMode.value === 'draw') {
      if (store.editDrawType.value === 'polygon' && drawPolygonPoints.value.length >= 3) {
        // 靠近首顶点（屏幕距离 ≤10px）：吸附闭合，橡皮筋末端贴回首点并高亮首点
        const first = drawPolygonPoints.value[0]
        const fs = normToScreen(first.nx, first.ny, fit, zoom.value, panX.value, panY.value)
        if (Math.hypot(cssX - fs.x, cssY - fs.y) <= 10) {
          drawSnapClose.value = true
          drawCur.value = { nx: first.nx, ny: first.ny }
          requestRender()
          return
        }
      }
      drawSnapClose.value = false
      drawCur.value = { nx: clamp01n(norm.nx), ny: clamp01n(norm.ny) }
      requestRender()
      return
    }
    // 拖拽手势进行中：不要重置高亮/选中，否则 resize/move 会因
    // selectedAnnotationIndex 被置 -1 而中断（光标移出框外时锚点也会消失）
    if (dragMode.value !== 'none') return
    const idx = annotations.value.findIndex((a) => hitTestAnn(a, norm.nx, norm.ny))
    if (idx >= 0) {
      highlightAnnotation(idx, e)
      return
    }
    // 光标未落在框内，但位于已选中框的锚点附近（含边框外一点）时，
    // 仍视为悬停该框——便于抓取上/下边缘锚点，避免稍微移出框就丢失
    const sel = annotations.value[selectedAnnotationIndex.value]
    if (sel && sel.bbox && (sel.type === 'bbox' || sel.type === 'obb')) {
      const handles = handlePositions(pBBoxToC(sel.bbox), fit, zoom.value, panX.value, panY.value)
      if (hitHandle(cssX, cssY, handles)) {
        highlightAnnotation(selectedAnnotationIndex.value, e)
        return
      }
    }
    highlightAnnotation(-1)
  }

  function onCanvasMouseLeave() {
    highlightAnnotation(-1)
  }

  watch(
    () => store.editingMode.value,
    (m) => {
      if (m !== 'draw' && drawAnchored.value) cancelDraw()
      if (m !== 'draw') {
        drawPolygonPoints.value = []
        drawSnapClose.value = false
      }
    },
  )
  watch(
    () => store.editDrawType.value,
    () => {
      drawPolygonPoints.value = []
      drawSnapClose.value = false
      if (drawAnchored.value) cancelDraw()
    },
  )

  onMounted(() => {
    window.addEventListener('keydown', onDrawKeydown)
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', onDrawKeydown)
  })

  return {
    canvasCursor,
    onMouseDown,
    onCanvasMouseMove,
    onCanvasMouseLeave,
    onCanvasContextMenu,
    onDblClick,
    cancelDraw,
  }
}
