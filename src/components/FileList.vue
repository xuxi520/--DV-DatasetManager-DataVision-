<template>
  <div class="file-list-container">
    <div class="list-header">
      <span>共 {{ files.length }} 张</span>
      <el-button-group size="small">
        <el-button :type="sortBy === 'name' ? 'primary' : 'default'" @click="$emit('sort', 'name')">名称</el-button>
        <el-button :type="sortBy === 'size' ? 'primary' : 'default'" @click="$emit('sort', 'size')">大小</el-button>
        <el-button :type="sortBy === 'width' ? 'primary' : 'default'" @click="$emit('sort', 'width')">尺寸</el-button>
      </el-button-group>
    </div>
    
    <div class="list-body" ref="listRef" @scroll="onScroll">
      <!-- 虚拟滚动 -->
      <div class="virtual-spacer" :style="{ height: totalHeight + 'px' }">
        <div class="virtual-content" :style="{ transform: `translateY(${offsetY}px)` }">
          <div
            v-for="file in visibleFiles"
            :key="file.id"
            class="file-item"
            :class="{ active: selectedId === file.id }"
            @click="$emit('select', file)"
          >
            <div class="file-info">
              <div class="file-name" :title="file.name">{{ file.name }}</div>
              <div class="file-meta">
                {{ file.width }}×{{ file.height }} · {{ formatSize(file.size) }}
              </div>
              <div v-if="file.hash" class="file-hash">
                <el-tag size="small" type="success">已计算</el-tag>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ImageFile } from '../types'

const props = defineProps<{
  files: ImageFile[]
  selectedId?: string
  sortBy: string
}>()

const emit = defineEmits<{
  (e: 'select', file: ImageFile): void
  (e: 'sort', by: string): void
}>()

const listRef = ref<HTMLElement>()
const scrollTop = ref(0)
const ITEM_HEIGHT = 72
const VISIBLE_BUFFER = 10

const totalHeight = computed(() => props.files.length * ITEM_HEIGHT)

const visibleStart = computed(() => {
  const start = Math.floor(scrollTop.value / ITEM_HEIGHT) - VISIBLE_BUFFER
  return Math.max(0, start)
})

const visibleEnd = computed(() => {
  if (!listRef.value) return props.files.length
  const visible = Math.ceil(listRef.value.clientHeight / ITEM_HEIGHT)
  const end = Math.floor(scrollTop.value / ITEM_HEIGHT) + visible + VISIBLE_BUFFER
  return Math.min(props.files.length, end)
})

const offsetY = computed(() => visibleStart.value * ITEM_HEIGHT)

const visibleFiles = computed(() => {
  return props.files.slice(visibleStart.value, visibleEnd.value)
})

function onScroll() {
  if (listRef.value) {
    scrollTop.value = listRef.value.scrollTop
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
}


</script>

<style scoped>
.file-list-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.list-header {
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #dcdfe6;
  flex-shrink: 0;
}

.list-body {
  flex: 1;
  overflow-y: auto;
  position: relative;
}

.virtual-spacer {
  position: relative;
}

.virtual-content {
  position: absolute;
  left: 0;
  right: 0;
}

.file-item {
  height: 72px;
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
  transition: background 0.15s;
}

.file-item:hover {
  background: #f5f7fa;
}

.file-item.active {
  background: #ecf5ff;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  font-size: 11px;
  color: #909399;
  margin-top: 4px;
}

.file-hash {
  margin-top: 4px;
}
</style>
