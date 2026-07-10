<template>
  <div class="app-container">
    <!-- 顶部导航 -->
    <nav class="app-nav">
      <div class="nav-brand">
        <el-icon :size="20"><PictureFilled /></el-icon>
        <span>Dataset Manager</span>
      </div>
      <div class="nav-right">
        <el-radio-group v-model="activeView" size="small">
          <el-radio-button value="browse">
            <el-icon><Monitor /></el-icon> 数据集浏览
          </el-radio-button>
          <el-radio-button value="dedup">
            <el-icon><Cpu /></el-icon> 重复分析
          </el-radio-button>
        </el-radio-group>

        <el-select v-model="themeMode" size="small" class="theme-select" style="width: 116px">
          <template #prefix>
            <el-icon><component :is="themeIcon" /></el-icon>
          </template>
          <el-option label="浅色" value="light" />
          <el-option label="深色" value="dark" />
          <el-option label="跟随系统" value="system" />
        </el-select>
      </div>
    </nav>

    <!-- 浏览模式 -->
    <template v-if="activeView === 'browse'">
      <DatasetViewer
        ref="viewerRef"
        @dataset-loaded="onDatasetLoaded"
      />

      <!-- 数据集结构配置对话框 -->
      <DatasetStructureDialog
        v-model="showStructureDialog"
        :analysis-result="currentDataset?.structureAnalysis"
        :image-files="currentDataset?.fileList || []"
        :annotation-files="[]"
        @confirm="onStructureConfigConfirm"
      />
    </template>

    <!-- 去重模式 -->
    <DedupView v-else />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { PictureFilled, Monitor, Cpu, Sunny, Moon } from '@element-plus/icons-vue'
import DatasetViewer from './components/DatasetViewer.vue'
import DatasetStructureDialog from './components/DatasetStructureDialog.vue'
import DedupView from './components/DedupView.vue'
import { useTheme } from './composables/useTheme'
import type { DataSet } from './types'

const { themeMode } = useTheme()
const themeIcon = computed(() => {
  if (themeMode.value === 'dark') return Moon
  if (themeMode.value === 'light') return Sunny
  return Monitor
})

const activeView = ref<'browse' | 'dedup'>('browse')

// 当前加载的数据集（用于配置对话框）
const currentDataset = ref<DataSet | null>(null)
const showStructureDialog = ref(false)
const viewerRef = ref<InstanceType<typeof DatasetViewer> | null>(null)

// 数据集加载回调
function onDatasetLoaded(dataset: DataSet) {
  currentDataset.value = dataset
  console.log('数据集已加载：', dataset.name)
}

// 数据集结构配置确认
function onStructureConfigConfirm(config: any) {
  ElMessage.success('数据集配置已更新')
  console.log('数据集配置：', config)
}
</script>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

.app-nav {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--text);
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.theme-select {
  margin-left: 4px;
}
</style>
