<template>
  <div class="compare-view">
    <!-- 对比导航-->
    <div class="compare-nav">
      <div class="compare-nav-left">
        <el-tag size="small" type="primary">{{ getDatasetName(compareConfig.datasetA) }}</el-tag>
        <span class="compare-nav-vs">VS</span>
        <el-tag size="small" type="success">{{ getDatasetName(compareConfig.datasetB) }}</el-tag>
      </div>
      <div class="compare-nav-center">
        <span class="compare-nav-mode">
          {{ compareConfig.mode === 'same' ? '同图对比' : '异图对比' }}
        </span>
      </div>
      <div class="compare-nav-right">
        <el-button size="small" @click="resetCompare">
          <el-icon><RefreshLeft /></el-icon> 重新配置
        </el-button>
      </div>
    </div>

    <!-- 同图对比模式 -->
    <div class="compare-same" v-if="compareConfig.mode === 'same' && matchedFiles.length > 0">
      <!-- 导航按钮 -->
      <div class="compare-navigation">
        <el-button-group>
          <el-button @click="prevMatchedFile" :disabled="matchedFileIndex <= 0">
            <el-icon><ArrowLeft /></el-icon> 上一
          </el-button>
          <el-button disabled>
            {{ matchedFileIndex + 1 }} / {{ matchedFiles.length }}
          </el-button>
          <el-button @click="nextMatchedFile" :disabled="matchedFileIndex >= matchedFiles.length - 1">
            下一<el-icon><ArrowRight /></el-icon>
          </el-button>
        </el-button-group>
      </div>

      <!-- 对比面板 -->
      <div class="compare-panels">
        <div class="compare-panel">
          <div class="panel-title">{{ getDatasetName(compareConfig.datasetA) }}</div>
          <ImageViewer
            :image-file="matchedFiles[matchedFileIndex]?.fileA"
            :annotations="getDatasetAnnotations(compareConfig.datasetA, matchedFiles[matchedFileIndex]?.fileA)"
            :show-info="false"
            :show-annotations="showAnnotations"
            :auto-fit="true"
          />
        </div>
        <div class="compare-divider"></div>
        <div class="compare-panel">
          <div class="panel-title">{{ getDatasetName(compareConfig.datasetB) }}</div>
          <ImageViewer
            :image-file="matchedFiles[matchedFileIndex]?.fileB"
            :annotations="getDatasetAnnotations(compareConfig.datasetB, matchedFiles[matchedFileIndex]?.fileB)"
            :show-info="false"
            :show-annotations="showAnnotations"
            :auto-fit="true"
          />
        </div>
      </div>
    </div>

    <!-- 异图对比模式 -->
    <div class="compare-diff" v-if="compareConfig.mode === 'diff'">
      <div class="compare-panels">
        <!-- 数据集A面板 -->
        <div class="compare-panel">
          <div class="panel-header-bar">
            <span class="panel-title">{{ getDatasetName(compareConfig.datasetA) }}</span>
            <el-button-group size="small">
              <el-button @click="prevFileInDataset('A')" :disabled="currentIndexA <= 0">
                <el-icon><ArrowLeft /></el-icon>
              </el-button>
              <el-button disabled size="small">
                {{ currentIndexA + 1 }} / {{ getDatasetFiles(compareConfig.datasetA).length }}
              </el-button>
              <el-button @click="nextFileInDataset('A')" :disabled="currentIndexA >= getDatasetFiles(compareConfig.datasetA).length - 1">
                <el-icon><ArrowRight /></el-icon>
              </el-button>
            </el-button-group>
          </div>
          <ImageViewer
            v-if="selectedFileA"
            :image-file="selectedFileA"
            :annotations="getDatasetAnnotations(compareConfig.datasetA, selectedFileA)"
            :show-info="false"
            :show-annotations="showAnnotations"
            :auto-fit="true"
          />
        </div>

        <div class="compare-divider"></div>

        <!-- 数据集B面板 -->
        <div class="compare-panel">
          <div class="panel-header-bar">
            <span class="panel-title">{{ getDatasetName(compareConfig.datasetB) }}</span>
            <el-button-group size="small">
              <el-button @click="prevFileInDataset('B')" :disabled="currentIndexB <= 0">
                <el-icon><ArrowLeft /></el-icon>
              </el-button>
              <el-button disabled size="small">
                {{ currentIndexB + 1 }} / {{ getDatasetFiles(compareConfig.datasetB).length }}
              </el-button>
              <el-button @click="nextFileInDataset('B')" :disabled="currentIndexB >= getDatasetFiles(compareConfig.datasetB).length - 1">
                <el-icon><ArrowRight /></el-icon>
              </el-button>
            </el-button-group>
          </div>
          <ImageViewer
            v-if="selectedFileB"
            :image-file="selectedFileB"
            :annotations="getDatasetAnnotations(compareConfig.datasetB, selectedFileB)"
            :show-info="false"
            :show-annotations="showAnnotations"
            :auto-fit="true"
          />
        </div>
      </div>
    </div>

    <!-- 无匹配文件提示-->
    <div v-if="compareConfig.mode === 'same' && matchedFiles.length === 0" class="compare-empty">
      <el-empty description="没有匹配的图片（按文件名匹配）">
        <el-button @click="compareConfig.mode = 'diff'">切换到异图对比</el-button>
      </el-empty>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft, ArrowRight, RefreshLeft } from '@element-plus/icons-vue'
import ImageViewer from './ImageViewer.vue'
import { useViewerState } from '../composables/useViewerState'

const {
  compareConfig, matchedFiles, matchedFileIndex, selectedFileA, selectedFileB,
  currentIndexA, currentIndexB, showAnnotations,
  getDatasetName, getDatasetAnnotations, getDatasetFiles,
  prevMatchedFile, nextMatchedFile, prevFileInDataset, nextFileInDataset, resetCompare,
} = useViewerState()
</script>
