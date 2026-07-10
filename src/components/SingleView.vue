<template>
  <!-- 左侧文件列表面板 -->
  <aside class="file-panel" :class="{ collapsed: filePanelCollapsed }" v-if="hasDataset">
    <div class="panel-header">
      <span>文件列表</span>
      <el-button size="small" text @click="filePanelCollapsed = !filePanelCollapsed">
        <el-icon><Fold /></el-icon>
      </el-button>
    </div>

    <div class="panel-body" v-show="!filePanelCollapsed">
      <div class="file-toolbar">
        <el-input
          v-model="searchText"
          placeholder="搜索文件..."
          clearable
          size="small"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <el-button-group class="mt-2">
          <el-button
            size="small"
            :type="filterType === 'all' ? 'primary' : ''"
            @click="filterType = 'all'"
          >
            全部
          </el-button>
          <el-button
            size="small"
            :type="filterType === 'annotated' ? 'primary' : ''"
            @click="filterType = 'annotated'"
          >
            有标
          </el-button>
          <el-button
            size="small"
            :type="filterType === 'unannotated' ? 'primary' : ''"
            @click="filterType = 'unannotated'"
          >
            无标
          </el-button>
        </el-button-group>
      </div>

      <div class="file-list-container">
        <div
          v-for="file in filteredFiles"
          :key="file.id"
          class="file-item"
          :class="{ active: selectedFile?.id === file.id }"
          :data-file-id="file.id"
          @click="selectFile(file)"
        >
          <div class="file-info">
            <div class="file-name">{{ file.name }}</div>
            <div class="file-meta">
              {{ file.width }}×{{ file.height }}
              <el-tag
                v-if="getFileAnnotations(file).length > 0"
                size="small"
                type="success"
              >
                {{ getFileAnnotations(file).length }}
              </el-tag>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>

  <!-- 文件面板折叠按钮 -->
  <div
    class="file-panel-toggle"
    v-if="hasDataset && filePanelCollapsed"
    @click="filePanelCollapsed = false"
  >
    <el-icon><Expand /></el-icon>
  </div>

  <!-- 右侧内容-->
  <section class="content-area">
    <div class="single-view">
      <ImageViewer
        v-if="selectedFile"
        :image-file="selectedFile"
        :annotations="currentAnnotations"
        :show-info="showImageInfo"
        :show-annotations="showAnnotations"
        :auto-fit="autoFit"
        @annotation-selected="onAnnotationSelected"
      />
    </div>
  </section>

  <!-- 右侧标注列表面板 -->
  <aside
    class="annotation-panel"
    :class="{ collapsed: annotationPanelCollapsed }"
    v-if="selectedFile && currentAnnotations.length > 0"
  >
    <div class="panel-header">
      <span>标注列表 ({{ currentAnnotations.length }})</span>
      <el-button size="small" text @click="annotationPanelCollapsed = !annotationPanelCollapsed">
        <el-icon><Fold /></el-icon>
      </el-button>
    </div>

    <div class="panel-body" v-show="!annotationPanelCollapsed">
      <div
        v-for="(ann, idx) in currentAnnotations"
        :key="idx"
        class="annotation-item"
        :class="{ active: selectedAnnotationIndex === idx }"
        @click="selectedAnnotationIndex = idx"
      >
        <div class="ann-color" :style="{ background: ann.color }"></div>
        <div class="ann-info">
          <div class="ann-category">{{ ann.category }}</div>
          <div class="ann-type">{{ getAnnotationTypeLabel(ann.type) }}</div>
        </div>
        <div class="ann-confidence" v-if="ann.confidence != null">
          {{ (ann.confidence * 100).toFixed(0) }}%
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Fold, Expand, Search } from '@element-plus/icons-vue'
import ImageViewer from './ImageViewer.vue'
import { useViewerState } from '../composables/useViewerState'

const {
  hasDataset, filePanelCollapsed, searchText, filterType, filteredFiles,
  selectedFile, selectedAnnotationIndex, currentAnnotations,
  getFileAnnotations, selectFile, showAnnotations, autoFit, showImageInfo,
  annotationPanelCollapsed, onAnnotationSelected, getAnnotationTypeLabel,
} = useViewerState()
</script>
