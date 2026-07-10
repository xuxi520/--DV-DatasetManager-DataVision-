<template>
  <div class="image-viewer" ref="containerRef">
    <!-- Canvas -->
    <canvas
      ref="canvasRef"
      @wheel="onWheel"
      @mousedown="onMouseDown"
      @mousemove="onCanvasMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onCanvasMouseLeave"
      @dblclick="onDoubleClick"
    />

    <!-- 图片信息 -->
    <div class="image-info" v-if="showInfo && imageInfo">
      <span>{{ imageInfo.width }}×{{ imageInfo.height }}</span>
      <span>{{ imageInfo.size }}</span>
      <span>标注 <b>{{ annotations.length }}</b></span>
    </div>

    <!-- 缩放比例 -->
    <div class="zoom-level">{{ Math.round(zoom * 100) }}%</div>

    <!-- 标注列表 -->
    <div class="annotation-list" v-if="showAnnotationList && annotations.length > 0">
      <div class="list-header">
        <span>标注 ({{ annotations.length }})</span>
        <el-button size="small" text @click="showAnnotationList = false">✕</el-button>
      </div>
      <div
        v-for="(ann, index) in annotations"
        :key="index"
        class="annotation-item"
        :class="{ selected: selectedAnnotationIndex === index }"
        @click="selectAnnotation(index)"
        @mouseenter="highlightAnnotation(index, $event)"
        @mouseleave="highlightAnnotation(-1)"
      >
        <span class="color-dot" :style="{ background: ann.color }"></span>
        <span class="category-name">{{ ann.category }}</span>
        <span v-if="ann.confidence !== undefined" class="confidence">{{ (ann.confidence * 100).toFixed(1) }}%</span>
        <span class="annotation-type">{{ ann.type }}</span>
      </div>
    </div>

    <!-- 描述信息窗口 -->
    <div class="description-tooltip" v-if="hoveredAnnotation" :style="tooltipStyle">
      <div class="description-title">{{ hoveredAnnotation.category }}</div>
      <div v-if="hoveredAnnotation.description" class="description-content">{{ hoveredAnnotation.description }}</div>
      <div v-if="hoveredAnnotation.confidence !== undefined" class="description-confidence">
        置信度: {{ (hoveredAnnotation.confidence * 100).toFixed(1) }}%
      </div>
    </div>

    <!-- 切换标注列表按钮 -->
    <el-button
      v-if="!showAnnotationList && annotations.length > 0"
      class="toggle-list-btn"
      size="small"
      @click="showAnnotationList = true"
    >
      标注 ({{ annotations.length }})
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, onActivated, watch, nextTick, computed } from 'vue'
import type { ParsedAnnotation, ImageFile } from '../types'
import { drawCheckerboard, drawAnnotation } from '../canvas/canvasDraw'

// Props
const props = defineProps<{
  imageFile?: ImageFile
  annotations?: ParsedAnnotation[]
  showInfo?: boolean
  showAnnotations?: boolean
}>()

// Emits
const emit = defineEmits<{
  annotationSelected: [index: number]
}>()

// Refs
const containerRef = ref<HTMLElement>()
const canvasRef = ref<HTMLCanvasElement>()

// State
const zoom = ref(1.0)
const panX = ref(0)
const panY = ref(0)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragStartPanX = ref(0)
const dragStartPanY = ref(0)
const selectedAnnotationIndex = ref(-1)
const showAnnotationList = ref(true)
const imageInfo = ref<{ width: number; height: number; size: string } | null>(null)
const hoveredAnnotation = ref<ParsedAnnotation | null>(null)
const tooltipStyle = ref({ top: '0px', left: '0px' })

// Computed
const annotations = computed(() => props.annotations || [])

// Watch for image changes
watch(() => props.imageFile, async (newFile) => {
  if (newFile && newFile.url) {
    await loadImage(newFile.url)
  } else {
    clearCanvas()
  }
}, { immediate: true })

// Watch for annotations changes
watch(() => props.annotations, () => {
  renderAnnotations()
}, { deep: true })

// ResizeObserver for container size changes
let resizeObserver: ResizeObserver | null = null

// Lifecycle
onMounted(() => {
  initResizeObserver()
  nextTick(() => {
    onResize()
    if (props.imageFile?.url) {
      loadImage(props.imageFile.url)
    }
  })
})

// keep-alive 激活时重新渲染（容器尺寸可能已变化）
onActivated(() => {
  nextTick(() => {
    // 用 requestAnimationFrame 确保 DOM 已完成布局
    requestAnimationFrame(() => {
      fitImageToCanvas()
      renderImage()
    })
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})

function initResizeObserver() {
  window.addEventListener('resize', onResize)

  resizeObserver = new ResizeObserver((entries) => {
    // 只在容器实际有尺寸时才重新渲染，避免 0 尺寸误触发
    for (const entry of entries) {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) {
        nextTick(() => {
          fitImageToCanvas()
          renderImage()
        })
      }
    }
  })

  if (containerRef.value) {
    resizeObserver.observe(containerRef.value)
  }
}

// Methods
let currentImage: HTMLImageElement | null = null

async function loadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      currentImage = img
      imageInfo.value = {
        width: img.width,
        height: img.height,
        size: formatSize(props.imageFile?.size || 0)
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

  // 重置变换矩阵，确保清空整个 canvas buffer
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

  // 容器尺寸为 0 时跳过（如 keep-alive 切换时），等待 ResizeObserver 触发
  if (container.clientWidth === 0 || container.clientHeight === 0) return

  const dpr = window.devicePixelRatio || 1
  canvas.width = container.clientWidth * dpr
  canvas.height = container.clientHeight * dpr
  canvas.style.width = container.clientWidth + 'px'
  canvas.style.height = container.clientHeight + 'px'
}

function renderImage() {
  if (!currentImage || !canvasRef.value) return

  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const cw = canvas.width / dpr
  const ch = canvas.height / dpr

  // Clear
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)

  // Calculate fit dimensions
  const iw = currentImage.width
  const ih = currentImage.height
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

  // Apply zoom and pan
  ctx.save()
  ctx.translate(panX.value, panY.value)
  ctx.scale(zoom.value, zoom.value)

  // Draw checkerboard background
  drawCheckerboard(ctx, fitX, fitY, fitW, fitH)

  // Draw image
  ctx.drawImage(currentImage, fitX, fitY, fitW, fitH)

  // Draw annotations
  if (props.showAnnotations !== false) {
    renderAnnotations(ctx, fitX, fitY, fitW / iw, fitH / ih)
  }

  ctx.restore()
}

function renderAnnotations(
  ctx?: CanvasRenderingContext2D,
  fitX: number = 0,
  fitY: number = 0,
  scaleX: number = 1,
  scaleY: number = 1
) {
  if (!ctx) {
    const canvas = canvasRef.value
    if (!canvas) return
    ctx = canvas.getContext('2d') ?? undefined
    if (!ctx) return
  }

  const image = currentImage
  if (!image) return

  const anns = annotations.value
  if (!anns.length) return

  // If no ctx provided, render full image
  if (arguments.length === 0) {
    renderImage()
    return
  }

  // Draw each annotation
  anns.forEach((ann, index) => {
    const isSelected = index === selectedAnnotationIndex.value
    drawAnnotation(ctx!, ann, fitX, fitY, scaleX, scaleY, isSelected, image.width, image.height, zoom.value)
  })
}

// Event handlers
function onWheel(e: WheelEvent) {
  e.preventDefault()
  if (!currentImage) return

  const delta = e.deltaY < 0 ? 1.1 : 0.91
  const newZoom = Math.max(0.05, Math.min(50, zoom.value * delta))

  // Zoom towards mouse position
  const canvas = canvasRef.value
  if (!canvas) return

  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  const wx = (mx - panX.value) / zoom.value
  const wy = (my - panY.value) / zoom.value

  zoom.value = newZoom
  panX.value = mx - wx * newZoom
  panY.value = my - wy * newZoom

  renderImage()
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return

  isDragging.value = true
  dragStartX.value = e.clientX
  dragStartY.value = e.clientY
  dragStartPanX.value = panX.value
  dragStartPanY.value = panY.value
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return

  panX.value = dragStartPanX.value + (e.clientX - dragStartX.value)
  panY.value = dragStartPanY.value + (e.clientY - dragStartY.value)

  renderImage()
}

function onCanvasMouseMove(e: MouseEvent) {
  // 检查鼠标是否悬停在标注上
  if (!currentImage || !canvasRef.value) return

  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  // 转换到图片坐标系
  const dpr = window.devicePixelRatio || 1
  const cw = canvas.width / dpr
  const ch = canvas.height / dpr

  const iw = currentImage.width
  const ih = currentImage.height
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

  // 应用 zoom 和 pan
  const imgX = (mx - panX.value) / zoom.value
  const imgY = (my - panY.value) / zoom.value

  // 转换为原始图片坐标
  const scaleX = fitW / iw
  const scaleY = fitH / ih
  const origX = (imgX - fitX) / scaleX
  const origY = (imgY - fitY) / scaleY

  // 检查是否在标注范围内
  const anns = annotations.value
  let hoveredIndex = -1

  for (let i = anns.length - 1; i >= 0; i--) {
    const ann = anns[i]
    if (ann.bbox) {
      let [x, y, w, h] = ann.bbox

      if (ann.normalized) {
        x = x * iw
        y = y * ih
        w = w * iw
        h = h * ih
      }

      if (origX >= x && origX <= x + w && origY >= y && origY <= y + h) {
        hoveredIndex = i
        break
      }
    }
  }

  if (hoveredIndex >= 0) {
    highlightAnnotation(hoveredIndex, e)
  } else {
    highlightAnnotation(-1)
  }
}

function onCanvasMouseLeave() {
  onMouseUp()
  highlightAnnotation(-1)
}

function onMouseUp() {
  isDragging.value = false
}

function onDoubleClick() {
  zoom.value = 1.0
  panX.value = 0
  panY.value = 0
  renderImage()
}

function onResize() {
  fitImageToCanvas()
  renderImage()
}

function selectAnnotation(index: number) {
  selectedAnnotationIndex.value = index
  emit('annotationSelected', index)
  renderImage()
}

function highlightAnnotation(index: number, event?: MouseEvent) {
  selectedAnnotationIndex.value = index

  if (index >= 0 && annotations.value[index]) {
    hoveredAnnotation.value = annotations.value[index]
    // 设置 tooltip 位置
    if (event) {
      tooltipStyle.value = {
        top: `${event.clientY + 10}px`,
        left: `${event.clientX + 10}px`
      }
    }
  } else {
    hoveredAnnotation.value = null
  }

  renderImage()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
}

// Expose methods
defineExpose({
  resetView: () => {
    zoom.value = 1.0
    panX.value = 0
    panY.value = 0
    renderImage()
  }
})
</script>
