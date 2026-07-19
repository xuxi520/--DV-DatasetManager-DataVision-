<template>
  <div class="pane-view" :class="{ active }" :data-pane-id="paneId" @click="$emit('activate')">
    <!-- 每个窗格顶部的数据集选择栏：各窗格独立选择数据集、独立上下张。
         主窗格额外提供「添加窗口」以开启多窗格对照（超宽屏铺满）；其余窗格可单独关闭。 -->
    <div class="pane-bar">
      <span class="pane-side">{{ paneLabel }}</span>
      <el-select
        :model-value="datasetId"
        @change="setDataset"
        size="small"
        class="pane-dataset-select"
        placeholder="选择数据集"
      >
        <el-option v-for="ds in datasets" :key="ds.id" :label="ds.name" :value="ds.id" />
      </el-select>
      <el-button size="small" :disabled="!capabilities.canPickDirectory" @click="handleLoadDataset()">
        <el-icon><FolderAdd /></el-icon> 加载新数据集
      </el-button>
      <el-button v-if="isPrimary" size="small" :disabled="!canAdd" @click="addPane">
        <el-icon><CopyDocument /></el-icon> {{ canAdd ? '添加窗口' : '已达上限' }}
      </el-button>
      <el-button v-else size="small" @click="closePane(paneId)">
        <el-icon><Close /></el-icon> 关闭
      </el-button>

      <!-- 本窗格独立的上下张切换（左右窗格各自独立，不受焦点影响） -->
      <el-button-group size="small" class="pane-nav" title="本窗格独立切换">
        <el-button
          :disabled="!selectedFile || currentIndex <= 0"
          @click="prevFile"
        >
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
        <el-button
          :disabled="!selectedFile || currentIndex >= filteredFiles.length - 1"
          @click="nextFile"
        >
          <el-icon><ArrowRight /></el-icon>
        </el-button>
      </el-button-group>

      <el-button size="small" :disabled="!selectedFile" :title="t('pane.augmentTitle')" @click="showAug = true">
        <el-icon><MagicStick /></el-icon> {{ t('pane.augmentPreview') }}
      </el-button>

      <AugmentPreview
        v-model="showAug"
        :image-file="selectedFile || undefined"
        :annotations="currentAnnotations"
      />
    </div>

    <div class="pane-body">
      <template v-if="dataset">
        <!-- 纯图像查看器：文件列表与标注面板已抽到共享侧栏（SidebarPanel），
             多窗格时所有窗格退化为纯图像，图像获得全部横向空间 -->
        <section class="content-area">
          <div class="single-view">
            <ImageViewer
              v-if="selectedFile"
              :image-file="selectedFile"
              :annotations="currentAnnotations"
              :show-info="showImageInfo"
              :show-annotations="showAnnotations"
              :show-annotation-list="showAnnotationList"
              :auto-fit="autoFit"
              :selected-index="selectedAnnotationIndex"
              :predictions="currentPredictions"
              :show-predictions="showPredictions"
              @annotation-selected="onAnnotationSelected"
            />
          </div>
        </section>
      </template>

      <!-- 未选择数据集时的占位 -->
      <div v-else class="pane-empty">
        <el-empty description="未选择数据集">
        <el-button type="primary" :disabled="!capabilities.canPickDirectory" @click="handleLoadDataset()">
          <el-icon><FolderAdd /></el-icon> 加载数据
        </el-button>
        </el-empty>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderAdd, CopyDocument, Close, ArrowLeft, ArrowRight, MagicStick } from '@element-plus/icons-vue'
import ImageViewer from './ImageViewer.vue'
import AugmentPreview from './AugmentPreview.vue'
import { useViewerState } from '../composables/useViewerState'
import { useActiveLearning } from '../activeLearning/useActiveLearning'
import { predictionsToParsed } from '../activeLearning/render'
import { normSlash } from '../dataset/importers/shared'
import type { ParsedAnnotation } from '../types'
import { capabilities } from '../capabilities'

const props = defineProps<{
  paneId: string
  active?: boolean
}>()

const emit = defineEmits<{ activate: [] }>()

const { t } = useI18n()

// 直接取原始 pane 实例（含未解包的 refs，窗格对象身份稳定，可安全解构）
const store = useViewerState()
const pane = store.panes.value.find((p) => p.id === props.paneId) || store.panes.value[0]

// 主窗格（数组首个）显示「添加窗口」，其余窗格显示「关闭」
const isPrimary = computed(() => store.panes.value[0]?.id === props.paneId)
const canAdd = computed(() => store.panes.value.length < MAX_PANES)
const paneLabel = computed(
  () => '窗格 ' + (store.panes.value.findIndex((p) => p.id === props.paneId) + 1),
)

const {
  datasetId, selectedFile, currentAnnotations, currentIndex,
  filteredFiles, dataset, selectedAnnotationIndex, onAnnotationSelected, setDataset,
  prevFile, nextFile,
} = pane

// 显示设置、全局数据集列表、加载动作
const {
  showAnnotations, autoFit, showImageInfo, showPredictions, showAnnotationList,
  datasets, handleLoadDataset, addPane, closePane, MAX_PANES,
} = store

// 主动学习：把当前样本（按 sourcePath 对齐）的模型预测投影为画布可绘制标注
const al = useActiveLearning()
const classNames = computed(
  () => new Map((dataset.value?.canonical?.classes || []).map((c) => [c.id, c.name])),
)
const currentPredictions = computed<ParsedAnnotation[]>(() => {
  if (!showPredictions.value || !dataset.value?.canonical || !selectedFile.value || !datasetId.value) return []
  const sample = dataset.value.canonical.samples.find(
    (s) => normSlash(s.sourcePath) === normSlash(selectedFile.value!.path),
  )
  if (!sample) return []
  const items = al.getPredictionItems(datasetId.value, sample.id)
  if (!items?.length) return []
  return predictionsToParsed(items, classNames.value)
})

// 增强预览模态框开关
const showAug = ref(false)
</script>
