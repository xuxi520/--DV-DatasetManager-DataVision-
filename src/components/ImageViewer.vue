<template>
  <div class="image-viewer" ref="containerRef">
    <canvas
      ref="canvasRef"
      class="image-canvas"
      :style="{ cursor: canvasCursor }"
      @wheel="onWheel"
      @mousedown="onMouseDown"
      @mousemove="onCanvasMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onCanvasMouseLeave"
      @dblclick="onCanvasDblClick"
      @contextmenu="onCanvasContextMenu"
    />
    <div class="zoom-level" v-if="zoom">{{ Math.round(zoom * 100) }}%</div>
    <div class="info-panel" v-if="showInfo && imageInfo">
      <div>尺寸: {{ imageInfo.width }} × {{ imageInfo.height }}</div>
      <div>大小: {{ imageInfo.size }}</div>
    </div>
    <div class="annotation-list" v-if="showAnnotationList && annotations.length">
      <div
        v-for="(ann, idx) in annotations"
        :key="idx"
        class="annotation-item"
        :class="{ active: idx === selectedAnnotationIndex }"
        @click="selectAnnotation(idx)"
        @mouseenter="highlightAnnotation(idx, $event)"
      >
        <span class="swatch" :style="{ background: ann.color }"></span>
        <span class="cat">{{ ann.category }}</span>
        <span class="conf" v-if="ann.confidence != null">{{ (ann.confidence * 100).toFixed(0) }}%</span>
        <span class="type">{{ ann.type }}</span>
      </div>
    </div>
    <div class="hover-tooltip" v-if="hoveredAnnotation" :style="tooltipStyle">
      {{ hoveredAnnotation.category }} ({{ hoveredAnnotation.type }})
    </div>
    <div class="draw-hint" v-if="polygonHint">{{ polygonHint }}</div>
    <div class="viewer-error" v-if="viewerError">{{ viewerError }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ImageFile, ParsedAnnotation } from '../types'
import { useViewerState } from '../composables/useViewerState'
import { useCanvasRender } from './canvas/useCanvasRender'
import { useCanvasInteraction } from './canvas/useCanvasInteraction'

const props = defineProps<{
  imageFile?: ImageFile
  annotations?: ParsedAnnotation[]
  showInfo?: boolean
  showAnnotations?: boolean
  showAnnotationList?: boolean
  selectedIndex?: number
  predictions?: ParsedAnnotation[]
  showPredictions?: boolean
}>()
const emit = defineEmits<{ annotationSelected: [index: number] }>()

const { t } = useI18n()
const store = useViewerState()

// 拖拽状态在组件层创建，同时注入"渲染预览"与"交互状态机"两个切片
const dragMode = ref<'none' | 'pan' | 'move' | 'resize' | 'rotate' | 'draw'>('none')
const drawStart = ref({ nx: 0, ny: 0 })
const drawCur = ref({ nx: 0, ny: 0 })
const drawAnchored = ref(false)
const drawPolygonPoints = ref<{ nx: number; ny: number }[]>([])
const drawSnapClose = ref(false)

// 多边形绘制提示浮层：实时反映顶点进度与可操作动作
const polygonHint = computed<string | null>(() => {
  if (store.editingMode.value !== 'draw' || store.editDrawType.value !== 'polygon') return null
  const n = drawPolygonPoints.value.length
  if (n === 0) return t('sidebar.drawHintStart')
  const base = t('sidebar.drawHintPoints', { n })
  return n >= 3 ? `${base} · ${t('sidebar.drawHintClose')}` : base
})

// 坏图/坏标注降级提示：加载失败或绘制异常时展示，不阻断其余交互
const viewerError = computed<string | null>(() => {
  if (imageError.value) return t('imageViewer.loadError')
  if (renderError.value) return t('imageViewer.renderError')
  return null
})

const annotations = computed<ParsedAnnotation[]>(() => props.annotations || [])

const selectedAnnotationIndex = ref(-1)
// 标注列表面板显隐：由外部显示设置控制，默认开启（prop 未传或 true 时显示）
const showAnnotationList = computed(() => props.showAnnotationList !== false)
const hoveredAnnotation = ref<ParsedAnnotation | null>(null)
const tooltipStyle = ref({ top: '0px', left: '0px' })
const isDragging = ref(false)

const {
  containerRef,
  canvasRef,
  zoom,
  panX,
  panY,
  imageInfo,
  imageError,
  renderError,
  onWheel,
  onDoubleClick,
  resetView,
  renderImage,
  pointerInfo,
} = useCanvasRender({
  props,
  annotations,
  selectedAnnotationIndex,
  dragMode,
  drawStart,
  drawCur,
  drawAnchored,
  drawPolygonPoints,
  drawSnapClose,
})

function selectAnnotation(index: number) {
  selectedAnnotationIndex.value = index
  emit('annotationSelected', index)
  renderImage()
}

function highlightAnnotation(index: number, event?: MouseEvent) {
  selectedAnnotationIndex.value = index
  if (index >= 0 && annotations.value[index]) {
    hoveredAnnotation.value = annotations.value[index]
    if (event) {
      tooltipStyle.value = {
        top: `${event.clientY + 10}px`,
        left: `${event.clientX + 10}px`,
      }
    }
  } else {
    hoveredAnnotation.value = null
  }
  renderImage()
}

const { canvasCursor, onMouseDown, onCanvasMouseMove, onCanvasMouseLeave, onCanvasContextMenu, onDblClick } =
  useCanvasInteraction({
    props,
    store,
    annotations,
    selectedAnnotationIndex,
    canvasRef,
    zoom,
    panX,
    panY,
    dragMode,
    drawStart,
    drawCur,
    drawAnchored,
    drawPolygonPoints,
    drawSnapClose,
    imageInfo,
    pointerInfo,
    requestRender: renderImage,
    selectAnnotation,
    highlightAnnotation,
  })

function onMouseUp() {
  isDragging.value = false
}

// 双击：渲染层先处理（画多边形时跳过缩放重置），再由交互层在画多边形时收尾
function onCanvasDblClick() {
  onDoubleClick()
  onDblClick()
}

defineExpose({ resetView })
</script>

<style scoped>
.image-viewer {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1e1e1e;
}
.image-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.zoom-level {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.info-panel {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  pointer-events: none;
}
.annotation-list {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  padding: 4px;
  border-radius: 4px;
  font-size: 12px;
  max-height: 80%;
  overflow-y: auto;
}
.annotation-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: 3px;
}
.annotation-item.active {
  background: rgba(64, 158, 255, 0.3);
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.hover-tooltip {
  position: fixed;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  pointer-events: none;
  z-index: 1000;
}
.draw-hint {
  position: absolute;
  bottom: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  pointer-events: none;
}
.viewer-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.7);
  color: #ffd2d2;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 13px;
  max-width: 80%;
  text-align: center;
  pointer-events: none;
}
</style>
