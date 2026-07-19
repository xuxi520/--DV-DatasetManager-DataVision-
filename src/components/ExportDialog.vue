<template>
  <el-dialog
    v-model="showExport"
    :title="t('export.title')"
    width="580px"
    :close-on-click-modal="!exporting"
    :show-close="!exporting"
  >
    <div class="export-form">
      <div class="export-row">
        <span class="export-label">{{ t('export.content') }}</span>
        <el-radio-group v-model="exportMode" :disabled="exporting">
          <el-radio-button value="dataset">{{ t('export.modeDataset') }}</el-radio-button>
          <el-radio-button value="annotations">{{ t('export.modeCsv') }}</el-radio-button>
          <el-radio-button value="training">{{ t('export.modeFramework') }}</el-radio-button>
          <el-radio-button value="augment">{{ t('export.modeAugment') }}</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 数据集格式模式 -->
      <template v-if="exportMode === 'dataset'">
        <div class="export-row">
          <span class="export-label">{{ t('export.format') }}</span>
          <el-radio-group v-model="exportFormat" :disabled="exporting">
            <el-radio-button value="yolo">{{ t('export.fmtYolo') }}</el-radio-button>
            <el-radio-button value="coco">{{ t('export.fmtCoco') }}</el-radio-button>
            <el-radio-button value="voc">{{ t('export.fmtVoc') }}</el-radio-button>
            <el-radio-button value="dota">{{ t('export.fmtDota') }}</el-radio-button>
          </el-radio-group>
        </div>
      </template>

      <!-- 标注 CSV / JSON 模式 -->
      <template v-else-if="exportMode === 'annotations'">
        <div class="export-row">
          <span class="export-label">{{ t('export.format') }}</span>
          <el-radio-group v-model="exportAnnFormat" :disabled="exporting">
            <el-radio-button value="csv">{{ t('export.csvCsv') }}</el-radio-button>
            <el-radio-button value="json">{{ t('export.csvJson') }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="export-hint">{{ t('export.csvHint') }}</div>
      </template>

      <!-- 训练框架配置模式 -->
      <template v-else-if="exportMode === 'training'">
        <div class="export-row">
          <span class="export-label">{{ t('export.framework') }}</span>
          <el-radio-group v-model="exportFramework" :disabled="exporting">
            <el-radio-button value="yolov8">{{ t('export.fwYolov8') }}</el-radio-button>
            <el-radio-button value="mmdetection">{{ t('export.fwMmdet') }}</el-radio-button>
            <el-radio-button value="detectron2">{{ t('export.fwDetectron2') }}</el-radio-button>
          </el-radio-group>
        </div>

        <div class="export-hint">
          {{ t('export.fwIntro', { fmt: exportFramework === 'yolov8' ? 'YOLO' : 'COCO' }) }}
          <ul v-if="exportFramework === 'yolov8'">
            <li>{{ t('export.fwFilesYolo') }}</li>
          </ul>
          <ul v-else-if="exportFramework === 'mmdetection'">
            <li>{{ t('export.fwFilesMmdet') }}</li>
          </ul>
          <ul v-else>
            <li>{{ t('export.fwFilesDetectron') }}</li>
          </ul>
        </div>

        <div class="export-row">
          <span class="export-label">{{ t('export.hyper') }}</span>
          <div class="hyper-grid">
            <template v-if="exportFramework === 'yolov8'">
              <label>{{ t('export.hpModel') }}
                <el-select v-model="exportHyper.model" :disabled="exporting" size="small" style="width: 90px">
                  <el-option label="n" value="n" /><el-option label="s" value="s" />
                  <el-option label="m" value="m" /><el-option label="l" value="l" /><el-option label="x" value="x" />
                </el-select>
              </label>
              <label>{{ t('export.hpEpochs') }}
                <el-input-number v-model="exportHyper.epochs" :min="1" :step="10" size="small" :disabled="exporting" />
              </label>
              <label>{{ t('export.hpImgsz') }}
                <el-input-number v-model="exportHyper.imgsz" :min="32" :step="32" size="small" :disabled="exporting" />
              </label>
            </template>
            <template v-else-if="exportFramework === 'mmdetection'">
              <label>{{ t('export.hpEpochs') }}
                <el-input-number v-model="exportHyper.epochs" :min="1" :step="1" size="small" :disabled="exporting" />
              </label>
              <label>{{ t('export.hpLr') }}
                <el-input-number v-model="exportHyper.lr" :min="0.0001" :max="1" :step="0.001" :precision="4" size="small" :disabled="exporting" />
              </label>
            </template>
            <template v-else>
              <label>{{ t('export.hpSteps') }}
                <el-input-number v-model="exportHyper.maxIter" :min="100" :step="500" size="small" :disabled="exporting" />
              </label>
              <label>{{ t('export.hpLr') }}
                <el-input-number v-model="exportHyper.lr" :min="0.0001" :max="1" :step="0.0001" :precision="5" size="small" :disabled="exporting" />
              </label>
            </template>
            <label>{{ t('export.hpBatch') }}
              <el-input-number v-model="exportHyper.batch" :min="1" :step="1" size="small" :disabled="exporting" />
            </label>
            <label>{{ t('export.hpGpus') }}
              <el-input-number v-model="exportHyper.numGpus" :min="1" :max="8" :step="1" size="small" :disabled="exporting" />
            </label>
            <label>{{ t('export.hpWorkers') }}
              <el-input-number v-model="exportHyper.workers" :min="0" :max="16" :step="1" size="small" :disabled="exporting" />
            </label>
          </div>
        </div>
      </template>

      <!-- 增强数据集模式 -->
      <template v-else-if="exportMode === 'augment'">
        <div class="export-row">
          <span class="export-label">{{ t('export.augOutFmt') }}</span>
          <el-radio-group v-model="augOutFormat" :disabled="exporting">
            <el-radio-button value="yolo">{{ t('export.fmtYolo') }}</el-radio-button>
            <el-radio-button value="coco">{{ t('export.fmtCoco') }}</el-radio-button>
            <el-radio-button value="voc">{{ t('export.fmtVoc') }}</el-radio-button>
            <el-radio-button value="dota">{{ t('export.fmtDota') }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="export-row">
          <span class="export-label">{{ t('export.imgFmt') }}</span>
          <el-radio-group v-model="augImageExt" :disabled="exporting">
            <el-radio-button value="jpg">{{ t('export.imgJpg') }}</el-radio-button>
            <el-radio-button value="png">{{ t('export.imgPng') }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="export-row">
          <span class="export-label">{{ t('export.copiesPerImg') }}</span>
          <el-input-number v-model="augCopies" :min="1" :max="20" :step="1" size="small" :disabled="exporting" />
        </div>
        <div class="export-row">
          <span class="export-label">{{ t('export.policy') }}</span>
          <el-radio-group v-model="augStrategy" :disabled="exporting">
            <el-radio-button value="fixed">{{ t('export.policySeq') }}</el-radio-button>
            <el-radio-button value="random">{{ t('export.policyRandom') }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="export-row">
          <span class="export-label">{{ t('export.augItems') }}</span>
          <div class="aug-step-grid">
            <div v-for="s in augSteps" :key="s.id" class="aug-step">
              <el-checkbox v-model="s.enabled" :disabled="exporting" :label="augLabel(s.id)" />
              <el-input-number
                v-model="s.param"
                :disabled="exporting || !s.enabled"
                size="small"
                :min="augParamMin(s.id)"
                :max="augParamMax(s.id)"
                :step="augParamStep(s.id)"
                style="width: 120px"
              />
            </div>
          </div>
        </div>
        <div class="export-row">
          <span class="export-label">{{ t('export.appendOrig') }}</span>
          <el-switch v-model="augIncludeOriginals" :disabled="exporting" :active-text="t('export.appendOrigHint')" />
        </div>
        <div class="export-hint">{{ t('export.augHint') }}</div>
      </template>

      <div class="export-row" v-if="exportMode !== 'annotations' && exportMode !== 'augment'">
        <span class="export-label">{{ t('export.naming') }}</span>
        <el-select v-model="exportPolicy" :disabled="exporting" style="width: 220px">
          <el-option :label="t('export.nameClassSeq')" value="class_seq" />
          <el-option :label="t('export.nameHash')" value="hash" />
          <el-option :label="t('export.nameSeq')" value="seq" />
          <el-option :label="t('export.namePreserve')" value="preserve" />
        </el-select>
      </div>

      <div class="export-row" v-if="exportMode !== 'augment'">
        <span class="export-label">{{ t('export.redivide') }}</span>
        <el-switch v-model="exportEnableRebalance" :disabled="exporting" :active-text="t('export.redivideHint')" />
      </div>

      <template v-if="exportEnableRebalance">
        <div class="export-row">
          <span class="export-label">{{ t('export.targetRatio') }}</span>
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
          <span class="export-label">{{ t('export.opt') }}</span>
          <div class="export-options">
            <el-switch v-model="exportStratify" :disabled="exporting" :active-text="t('export.optStratify')" />
            <el-switch v-model="exportLockTest" :disabled="exporting" :active-text="t('export.optLockTest')" />
            <span class="ratio-tag">{{ t('export.seed') }}</span>
            <el-input-number v-model="exportSeed" :min="0" :step="1" size="small" :disabled="exporting" />
          </div>
        </div>
      </template>

      <!-- split 分布预览 -->
      <div class="export-preview" v-if="currentSplitCounts && exportMode !== 'augment'">
        <div class="preview-title">{{ t('export.distPreview') }}</div>
        <div class="preview-line">
          <span class="preview-name">{{ t('export.cur') }}</span>
          <el-tag size="small" type="info">train {{ currentSplitCounts.train }}</el-tag>
          <el-tag size="small" type="info">val {{ currentSplitCounts.val }}</el-tag>
          <el-tag size="small" type="info">test {{ currentSplitCounts.test }}</el-tag>
          <el-tag size="small" v-if="currentSplitCounts.unknown">unknown {{ currentSplitCounts.unknown }}</el-tag>
        </div>
        <div class="preview-line" v-if="rebalancePreview">
          <span class="preview-name">{{ t('export.rediv') }}</span>
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
      <el-button @click="showExport = false" :disabled="exporting">{{ t('export.cancel') }}</el-button>
      <el-button type="primary" @click="runExport" :loading="exporting">
        <el-icon><Download /></el-icon>
        {{ exportMode === 'annotations' ? t('export.exportAnns') : (exportMode === 'augment' ? t('export.genAug') : t('export.genZip')) }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Download } from '@element-plus/icons-vue'
import { useViewerState } from '../composables/useViewerState'
import { AUG_MAP, type AugId } from '../augment/transforms'
import { useI18n } from 'vue-i18n'

const {
  showExport, exporting, exportProgress, exportStatus,
  exportMode, exportFramework, exportHyper, frameworkLabel,
  exportFormat, exportPolicy, exportEnableRebalance, exportRatio,
  exportStratify, exportLockTest, exportSeed,
  exportAnnFormat,
  currentSplitCounts, rebalancePreview, runExport,
  augSteps, augStrategy, augCopies, augOutFormat, augImageExt, augIncludeOriginals,
} = useViewerState()
const { t } = useI18n()

function augLabel(id: AugId): string {
  return t('aug.' + id)
}
function augParamMin(id: AugId): number {
  return AUG_MAP[id].param?.min ?? 0
}
function augParamMax(id: AugId): number {
  return AUG_MAP[id].param?.max ?? 0
}
function augParamStep(id: AugId): number {
  return AUG_MAP[id].param?.step ?? 1
}
</script>

<style scoped>
.export-hint {
  margin: 4px 0 8px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.export-hint ul {
  margin: 4px 0 0;
  padding-left: 18px;
}
.hyper-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: center;
}
.hyper-grid label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.aug-step-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px 16px;
  align-items: center;
}
.aug-step {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
