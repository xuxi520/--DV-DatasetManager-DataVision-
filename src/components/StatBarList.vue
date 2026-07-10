<template>
  <div class="bar-list">
    <div class="bar-row" v-for="it in items" :key="it.label">
      <span class="bar-label" :title="it.label">{{ it.label }}</span>
      <div class="bar-track">
        <div class="bar-fill" :style="{ width: it.pct + '%', background: it.color }"></div>
      </div>
      <span class="bar-val">{{ it.count }}</span>
    </div>
    <div v-if="items.length === 0" class="stats-empty">无数据</div>
  </div>
</template>

<script setup lang="ts">
export interface BarItem {
  label: string
  count: number
  pct: number
  color: string
}
defineProps<{ items: BarItem[] }>()
</script>
