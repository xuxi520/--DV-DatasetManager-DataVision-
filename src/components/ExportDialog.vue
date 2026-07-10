<template>
  <el-dialog
    v-model="showExport"
    title="导出数据集"
    width="560px"
    :close-on-click-modal="!exporting"
    :show-close="!exporting"
  >
    <div class="export-form">
      <div class="export-row">
        <span class="export-label">导出格式</span>
        <el-radio-group v-model="exportFormat" :disabled="exporting">
          <el-radio-button value="yolo">YOLO</el-radio-button>
          <el-radio-button value="coco">COCO</el-radio-button>
          <el-radio-button value="voc">Pascal VOC</el-radio-button>
        </el-radio-group>
      </div>

      <div class="export-row">
        <span class="export-label">命名策略</span>
        <el-select v-model="exportPolicy" :disabled="exporting" style="width: 220px">
          <el-option label="类别_序号(class_seq)" value="class_seq" />
          <el-option label="哈希_(hash)" value="hash" />
          <el-option label="序号(seq)" value="seq" />
          <el-option label="原样(preserve)" value="preserve" />
        </el-select>
      </div>

      <div class="export-row">
        <span class="export-label">重新划分</span>
        <el-switch v-model="exportEnableRebalance" :disabled="exporting" active-text="按比例分层重train/val/test" />
      </div>

      <template v-if="exportEnableRebalance">
        <div class="export-row">
          <span class="export-label">目标比例</span>
          <div class="ratio-inputs">
            <el-input-number v-model="exportRatio.train" :min="0" :step="1" size="small" :disabled="exporting" />
            <span class="ratio-tag">train</span>
            <el-input-number v-model="exportRatio.val" :min="0" :step="1" size="small" :disabled="exporting" />
            <span class="ratio-tag">val</span>
            <el-input-number v-model="exportRatio.test" :min="0" :step="1" size="small" :disabled="exporting" />
            <span class="ratio-tag">test</span>
          </div>
        </div>
        <div class="export-row">
          <span class="export-label">选项</span>
          <div class="export-options">
            <el-switch v-model="exportStratify" :disabled="exporting" active-text="按主类别分层" />
            <el-switch v-model="exportLockTest" :disabled="exporting" active-text="锁定 test 不变" />
            <span class="ratio-tag">种子</span>
            <el-input-number v-model="exportSeed" :min="0" :step="1" size="small" :disabled="exporting" />
          </div>
        </div>
      </template>

      <!-- split 分布预览 -->
      <div class="export-preview" v-if="currentSplitCounts">
        <div class="preview-title">子集分布预览</div>
        <div class="preview-line">
          <span class="preview-name">当前</span>
          <el-tag size="small" type="info">train {{ currentSplitCounts.train }}</el-tag>
          <el-tag size="small" type="info">val {{ currentSplitCounts.val }}</el-tag>
          <el-tag size="small" type="info">test {{ currentSplitCounts.test }}</el-tag>
          <el-tag size="small" v-if="currentSplitCounts.unknown">unknown {{ currentSplitCounts.unknown }}</el-tag>
        </div>
        <div class="preview-line" v-if="rebalancePreview">
          <span class="preview-name">重划</span>
          <el-tag size="small" type="success">train {{ rebalancePreview.train }}</el-tag>
          <el-tag size="small" type="success">val {{ rebalancePreview.val }}</el-tag>
          <el-tag size="small" type="success">test {{ rebalancePreview.test }}</el-tag>
          <el-tag size="small" type="warning" v-if="rebalancePreview.unknown">unknown {{ rebalancePreview.unknown }}</el-tag>
        </div>
      </div>

      <div class="export-progress" v-if="exporting">
        <el-progress :percentage="exportProgress" :stroke-width="12" />
        <p class="compute-status">{{ exportStatus }}</p>
      </div>
    </div>

    <template #footer>
      <el-button @click="showExport = false" :disabled="exporting">取消</el-button>
      <el-button type="primary" @click="runExport" :loading="exporting">
        <el-icon><Download /></el-icon> 生成并下载 ZIP
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Download } from '@element-plus/icons-vue'
import { useViewerState } from '../composables/useViewerState'

const {
  showExport, exporting, exportProgress, exportStatus,
  exportFormat, exportPolicy, exportEnableRebalance, exportRatio,
  exportStratify, exportLockTest, exportSeed,
  currentSplitCounts, rebalancePreview, runExport,
} = useViewerState()
</script>
