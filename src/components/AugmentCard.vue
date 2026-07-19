<template>
  <div class="aug-card">
    <div class="aug-card-canvas" ref="hostRef"></div>
    <div class="aug-card-meta">
      <span class="aug-card-label">{{ label }}</span>
      <span class="aug-card-count">{{ count }} 标注</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import type { ParsedAnnotation } from '../types'
import { drawAnnotation } from '../canvas/canvasDraw'
import { applyAugmentation, type AugId } from '../augment/transforms'

const props = defineProps<{
  src: HTMLImageElement | null
  annotations: ParsedAnnotation[]
  /** 'original' 表示原图对照 */
  opId: AugId | 'original'
  label: string
  param?: number
}>()

const hostRef = ref<HTMLElement>()
const count = ref(0)

function render() {
  const host = hostRef.value
  if (!host || !props.src) return
  const W = props.src.naturalWidth || props.src.width
  const H = props.src.naturalHeight || props.src.height

  let canvas: HTMLCanvasElement
  let anns: ParsedAnnotation[]
  let cw: number
  let ch: number
  if (props.opId === 'original') {
    canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(props.src, 0, 0)
    anns = props.annotations
    cw = W
    ch = H
  } else {
    const r = applyAugmentation(props.src, props.annotations, props.opId, props.param ?? 0)
    canvas = r.canvas
    anns = r.annotations
    cw = r.width
    ch = r.height
  }

  const ctx = canvas.getContext('2d')!
  for (const ann of anns) {
    drawAnnotation(ctx, ann, 0, 0, 1, 1, false, cw, ch, 1)
  }

  count.value = anns.length
  host.innerHTML = ''
  canvas.style.maxWidth = '100%'
  canvas.style.height = 'auto'
  canvas.style.display = 'block'
  canvas.style.borderRadius = '6px'
  canvas.style.background = 'var(--el-fill-color-light)'
  host.appendChild(canvas)
}

onMounted(render)
watch(() => [props.src, props.annotations, props.opId, props.param], render, { deep: false })
// 标注是响应式数组引用，深度变化也需重绘
watch(() => props.annotations, render, { deep: true })
</script>

<style scoped>
.aug-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 8px;
}
.aug-card-canvas {
  width: 100%;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.aug-card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.aug-card-label {
  font-weight: 600;
  color: var(--el-text-color-primary);
}
</style>
