<template>
  <div ref="el" class="chart-panel" :style="{ height: height }"></div>
</template>

<script setup lang="ts">
import { ref, shallowRef, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

const emit = defineEmits<{ (e: 'itemClick', idx: number): void }>()

const props = withDefaults(
  defineProps<{
    option: EChartsOption
    height?: string
  }>(),
  { height: '260px' }
)

const el = ref<HTMLDivElement | null>(null)
const chart = shallowRef<ReturnType<typeof echarts.init> | null>(null)
let ro: ResizeObserver | null = null

function render() {
  if (!chart.value) return
  chart.value.setOption(props.option, { notMerge: true })
}

onMounted(() => {
  if (!el.value) return
  // 显式 devicePixelRatio，避免高分屏下字体/图形模糊
  chart.value = echarts.init(el.value, null, {
    renderer: 'canvas',
    devicePixelRatio: window.devicePixelRatio || 1,
  })
  render()
  chart.value.on('click', (params: { dataIndex?: number }) => {
    if (typeof params.dataIndex === 'number') emit('itemClick', params.dataIndex)
  })
  ro = new ResizeObserver(() => chart.value?.resize())
  ro.observe(el.value)
})

watch(
  () => props.option,
  () => nextTick(render),
  { deep: true }
)

onBeforeUnmount(() => {
  ro?.disconnect()
  chart.value?.dispose()
  chart.value = null
})

defineExpose({ resize: () => chart.value?.resize() })
</script>

<style scoped>
.chart-panel {
  width: 100%;
}
</style>
