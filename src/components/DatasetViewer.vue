<template>
  <div class="dataset-viewer">
    <!-- 全屏加载覆盖-->
    <div class="loading-overlay" v-if="loading">
      <div class="loading-content">
        <el-progress type="circle" :percentage="loadingPct" :width="80" />
        <p class="loading-text">{{ loadingText }}</p>
        <p class="loading-sub" v-if="loadingDetail">{{ loadingDetail }}</p>
      </div>
    </div>

    <!-- 顶部工具-->
    <ViewerHeader />

    <!-- 对比模式设置向导 -->
    <CompareWizard v-if="viewMode === 'compare' && !compareReady" />

    <!-- 悬浮设置菜单 -->
    <SettingsPanel />

    <!-- 主内容区 -->
    <main class="viewer-main" v-if="viewMode !== 'compare' || compareReady">
      <!-- 单图模式 -->
      <SingleView v-if="viewMode === 'single'" />

      <!-- 对比模式 -->
      <CompareView v-else-if="viewMode === 'compare' && compareReady" />

      <!-- 统计面板 -->
      <StatsView
        v-else-if="viewMode === 'stats' && hasDataset"
        :datasets="datasets"
        :dataset-annotations="datasetAnnotations"
        :category-color-map="categoryColorMap"
      />

      <!-- 空状态-->
      <div v-if="!hasDataset" class="empty-state">
        <el-empty description="请开始使用">
          <el-button type="primary" @click="handleLoadDataset">
            <el-icon><FolderAdd /></el-icon> 加载数据
          </el-button>
        </el-empty>
      </div>
    </main>

    <!-- 底部状态栏 -->
    <footer class="viewer-footer" v-if="hasDataset && viewMode !== 'compare'">
      <div class="footer-left">
        <span>{{ filteredFiles.length }} 个文件</span>
        <el-divider direction="vertical" />
        <span>{{ currentIndex + 1 }} / {{ filteredFiles.length }}</span>
      </div>
      <div class="footer-center">
        <el-button-group size="small">
          <el-button @click="prevFile" :disabled="currentIndex <= 0">
            <el-icon><ArrowLeft /></el-icon>
          </el-button>
          <el-button @click="nextFile" :disabled="currentIndex >= filteredFiles.length - 1">
            <el-icon><ArrowRight /></el-icon>
          </el-button>
        </el-button-group>
      </div>
      <div class="footer-right">
        <span v-if="selectedFile">
          {{ selectedFile.width }}×{{ selectedFile.height }}
        </span>
        <el-divider direction="vertical" v-if="selectedFile" />
        <span>{{ viewMode }} 模式</span>
      </div>
    </footer>

    <!-- 计算进度对话框-->
    <el-dialog
      v-model="computing"
      title="正在计算哈希..."
      :close-on-click-modal="false"
      :show-close="false"
      width="400px"
    >
      <el-progress :percentage="computeProgress" />
      <p class="compute-status">{{ computeStatus }}</p>
      <el-button @click="cancelCompute = true">取消</el-button>
    </el-dialog>

    <!-- 导出数据集对话框 -->
    <ExportDialog />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { FolderAdd, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import ViewerHeader from './ViewerHeader.vue'
import CompareWizard from './CompareWizard.vue'
import SettingsPanel from './SettingsPanel.vue'
import SingleView from './SingleView.vue'
import CompareView from './CompareView.vue'
import StatsView from './StatsView.vue'
import ExportDialog from './ExportDialog.vue'
import { useViewerState } from '../composables/useViewerState'

const {
  loading, loadingText, loadingPct, loadingDetail,
  viewMode, compareReady,
  datasets, datasetAnnotations, categoryColorMap,
  hasDataset, filteredFiles, currentIndex, selectedFile,
  computing, computeProgress, computeStatus, cancelCompute,
  handleLoadDataset, prevFile, nextFile, handleKeydown,
} = useViewerState()

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>
