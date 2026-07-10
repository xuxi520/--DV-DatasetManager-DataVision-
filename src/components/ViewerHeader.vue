<template>
  <header class="viewer-header" :class="{ collapsed: headerCollapsed }">
    <template v-if="!headerCollapsed">
      <div class="header-left">
        <h2 class="viewer-title">
          <el-icon :size="20"><PictureFilled /></el-icon>
          {{ currentDatasetName }}
        </h2>
        <div class="dataset-summary" v-if="datasetCount > 0">
          <el-tag size="small" type="info" effect="plain">已加载 {{ datasetCount }} 个数据集</el-tag>
          <el-tag size="small" type="info" effect="plain">{{ totalFiles }} 张图片</el-tag>
          <el-tag size="small" type="success" effect="plain">{{ totalAnnotations }} 个标注</el-tag>
        </div>
      </div>

      <div class="header-center">
        <!-- 视图模式切换 -->
        <el-radio-group v-model="viewMode" size="small" @change="onViewModeChange">
          <el-radio-button label="single">
            <el-icon><Monitor /></el-icon> 单图
          </el-radio-button>
          <el-radio-button label="compare">
            <el-icon><CopyDocument /></el-icon> 对比
          </el-radio-button>
          <el-radio-button label="stats">
            <el-icon><DataAnalysis /></el-icon> 统计
          </el-radio-button>
        </el-radio-group>
      </div>

      <div class="header-right">
        <el-button-group>
          <el-button size="small" @click="handleLoadDataset" type="primary">
            <el-icon><FolderAdd /></el-icon> 加载数据
          </el-button>
          <el-button size="small" @click="handleAddDataset" v-if="datasets.length > 0">
            <el-icon><Plus /></el-icon> 添加
          </el-button>
        </el-button-group>

        <el-button size="small" @click="handleComputeHashes" :loading="computing" v-if="hasDataset">
          <el-icon><Cpu /></el-icon> 哈希
        </el-button>

        <el-button size="small" @click="handleExport" v-if="hasDataset">
          <el-icon><Download /></el-icon> 导出
        </el-button>

        <el-button size="small" @click="showSettings = !showSettings">
          <el-icon><Setting /></el-icon>
        </el-button>
      </div>
    </template>

    <!-- 折叠后的迷你模式 -->
    <template v-else>
      <el-radio-group v-model="viewMode" size="small" @change="onViewModeChange">
        <el-radio-button label="single">单图</el-radio-button>
        <el-radio-button label="compare">对比</el-radio-button>
        <el-radio-button label="stats">统计</el-radio-button>
      </el-radio-group>
    </template>

    <el-button
      class="collapse-btn"
      :icon="headerCollapsed ? ArrowDown : ArrowUp"
      size="small"
      circle
      @click="headerCollapsed = !headerCollapsed"
    />
  </header>
</template>

<script setup lang="ts">
import {
  PictureFilled, FolderAdd, Plus, Cpu, Download, Setting,
  Monitor, CopyDocument, ArrowDown, ArrowUp, DataAnalysis,
} from '@element-plus/icons-vue'
import { useViewerState } from '../composables/useViewerState'

const {
  viewMode, headerCollapsed, datasetCount, totalFiles, totalAnnotations,
  currentDatasetName, datasets, hasDataset, showSettings, computing,
  onViewModeChange, handleLoadDataset, handleAddDataset, handleComputeHashes, handleExport,
} = useViewerState()
</script>
