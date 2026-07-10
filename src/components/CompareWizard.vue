<template>
  <div class="compare-wizard">
    <div class="wizard-content">
      <el-steps :active="compareStep" finish-status="success" align-center>
        <el-step title="选择数据集A" />
        <el-step title="选择数据集B" />
        <el-step title="配置对比" />
        <el-step title="开始对比" />
      </el-steps>

      <div class="wizard-body">
        <!-- 步骤1: 选择数据集A -->
        <div v-if="compareStep === 0" class="wizard-step">
          <h3>选择要对比的数据A</h3>
          <p class="wizard-hint">请从已加载的数据集中选择第一个数据集</p>
          <div class="dataset-list">
            <div
              v-for="ds in datasets"
              :key="ds.id"
              class="dataset-card"
              :class="{ active: compareConfig.datasetA === ds.id }"
              @click="compareConfig.datasetA = ds.id"
            >
              <h4>{{ ds.name }}</h4>
              <p>{{ ds.fileList.length }} 张图</p>
              <el-tag size="small" type="info">
                {{ getDatasetAnnotationCount(ds.id) }} 个标
              </el-tag>
            </div>
          </div>
          <el-button
            v-if="datasets.length === 0"
            type="primary"
            @click="handleLoadDataset"
          >
            加载数据
          </el-button>
        </div>

        <!-- 步骤2: 选择数据集B -->
        <div v-if="compareStep === 1" class="wizard-step">
          <h3>选择要对比的数据B</h3>
          <p class="wizard-hint">请选择第二个数据集（不能与 A 相同）</p>
          <div class="dataset-list">
            <div
              v-for="ds in datasets.filter((d) => d.id !== compareConfig.datasetA)"
              :key="ds.id"
              class="dataset-card"
              :class="{ active: compareConfig.datasetB === ds.id }"
              @click="compareConfig.datasetB = ds.id"
            >
              <h4>{{ ds.name }}</h4>
              <p>{{ ds.fileList.length }} 张图</p>
              <el-tag size="small" type="info">
                {{ getDatasetAnnotationCount(ds.id) }} 个标
              </el-tag>
            </div>
          </div>
        </div>

        <!-- 步骤3: 配置对比 -->
        <div v-if="compareStep === 2" class="wizard-step">
          <h3>配置对比方式</h3>
          <p class="wizard-hint">选择如何匹配两个数据集的图片</p>

          <el-form label-width="120px" class="compare-config-form">
            <el-form-item label="对比模式">
              <el-radio-group v-model="compareConfig.mode">
                <el-radio label="same">同图对比（按文件名匹配）</el-radio>
                <el-radio label="diff">异图对比（独立导航）</el-radio>
              </el-radio-group>
              <div class="form-hint">
                <p v-if="compareConfig.mode === 'same'">
                  两个数据集显示同名图片，便于直接对比标注差异
                </p>
                <p v-else>
                  两个数据集独立导航，可分别浏览不同图
                </p>
              </div>
            </el-form-item>

            <el-form-item label="匹配结果" v-if="compareConfig.mode === 'same'">
              <el-alert type="info" show-icon :closable="false">
                <template #title>
                  可匹{{ getMatchedFileCount() }} 对图
                </template>
                <div>
                  数据A: {{ getDatasetFileCount(compareConfig.datasetA) }} <br />
                  数据B: {{ getDatasetFileCount(compareConfig.datasetB) }} <br />
                  按文件名匹配{{ getMatchedFileCount() }} 对可对比图片
                </div>
              </el-alert>
            </el-form-item>
          </el-form>
        </div>

        <!-- 步骤4: 开始对比 -->
        <div v-if="compareStep === 3" class="wizard-step">
          <el-result icon="success" title="完成">
            <template #sub-title>
              <p>数据A: {{ getDatasetName(compareConfig.datasetA) }}</p>
              <p>数据B: {{ getDatasetName(compareConfig.datasetB) }}</p>
              <p>对比模式: {{ compareConfig.mode === 'same' ? '同图对比' : '异图对比' }}</p>
            </template>
            <template #extra>
              <el-button type="primary" @click="startCompare">
                开始对比
              </el-button>
            </template>
          </el-result>
        </div>
      </div>

      <div class="wizard-footer">
        <el-button @click="compareStep = Math.max(0, compareStep - 1)" v-if="compareStep > 0">
          上一
        </el-button>
        <el-button
          type="primary"
          @click="handleWizardNext"
          v-if="compareStep < 3"
          :disabled="!canProceed"
        >
          下一
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useViewerState } from '../composables/useViewerState'

const {
  compareStep, compareConfig, datasets, canProceed,
  getDatasetAnnotationCount, getDatasetName, getMatchedFileCount, getDatasetFileCount,
  handleWizardNext, startCompare, handleLoadDataset,
} = useViewerState()
</script>
