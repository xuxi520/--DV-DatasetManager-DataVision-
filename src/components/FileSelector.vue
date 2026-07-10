<template>
  <div class="file-selector">
    <!-- 搜索栏 -->
    <div class="selector-header">
      <el-input
        v-model="searchText"
        placeholder="搜索文件名..."
        clearable
        :prefix-icon="Search"
        @input="onSearch"
      />
      <div class="selector-stats">
        共 {{ filteredFiles.length }} 个文件
      </div>
    </div>
    
    <!-- 文件列表 -->
    <div class="selector-content">
      <div 
        v-for="file in filteredFiles" 
        :key="file.id"
        class="file-item"
        @click="onSelect(file)"
      >
        <div class="file-info">
          <div class="file-name">{{ file.name }}</div>
          <div class="file-meta">
            {{ file.width }}×{{ file.height }} · {{ formatSize(file.size) }}
          </div>
        </div>
      </div>
    </div>
    
    <!-- 底部按钮 -->
    <div class="selector-footer">
      <el-button @click="$emit('close')">取消</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search } from '@element-plus/icons-vue'
import type { ImageFile } from '../types'

// Props
const props = defineProps<{
  files: ImageFile[]
}>()

// Emits
const emit = defineEmits<{
  select: [file: ImageFile]
  close: []
}>()

// 状态
const searchText = ref('')

// 过滤后的文件列表
const filteredFiles = computed(() => {
  if (!searchText.value) return props.files
  
  const keyword = searchText.value.toLowerCase()
  return props.files.filter(f => 
    f.name.toLowerCase().includes(keyword)
  )
})

// 方法
function onSearch() {
  // 搜索逻辑已在 computed 中处理
}

function onSelect(file: ImageFile) {
  emit('select', file)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
}
</script>

<style scoped>
.file-selector {
  display: flex;
  flex-direction: column;
  height: 70vh;
}

.selector-header {
  padding: 20px;
  border-bottom: 1px solid #444;
}

.selector-stats {
  margin-top: 10px;
  font-size: 12px;
  color: #888;
}

.selector-content {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.file-item {
  display: flex;
  align-items: center;
  padding: 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.file-item:hover {
  background: #333;
}

.file-info {
  flex: 1;
}

.file-name {
  font-size: 14px;
  margin-bottom: 4px;
}

.file-meta {
  font-size: 12px;
  color: #888;
}

.selector-footer {
  padding: 20px;
  border-top: 1px solid #444;
  display: flex;
  justify-content: flex-end;
}
</style>
