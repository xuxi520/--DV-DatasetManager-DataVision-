<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    :title="t('dataset.augmentPreview')"
    width="min(1100px, 92vw)"
    top="5vh"
    append-to-body
    class="aug-preview-dialog"
  >
    <div class="aug-layout" v-if="src">
      <!-- 左侧：增强选项 -->
      <aside class="aug-options">
        <p class="aug-hint">{{ t('dataset.augPreviewHint') }}</p>

        <div class="aug-group">
          <div class="aug-group-title">{{ t('augment.groupGeometric') }}</div>
          <div v-for="a in geometric" :key="a.id" class="aug-opt">
            <el-checkbox v-model="enabled[a.id]" @change="onToggle">{{ t(a.label) }}</el-checkbox>
            <el-slider
              v-if="a.param && enabled[a.id]"
              v-model="params[a.id]"
              :min="a.param.min"
              :max="a.param.max"
              :step="a.param.step"
              :show-tooltip="false"
              size="small"
              class="aug-slider"
              @input="onParam"
            />
            <span v-if="a.param && enabled[a.id]" class="aug-param-val">{{ t(a.param.label) }}: {{ params[a.id] }}</span>
          </div>
        </div>

        <div class="aug-group">
          <div class="aug-group-title">{{ t('augment.groupColor') }}</div>
          <div v-for="a in color" :key="a.id" class="aug-opt">
            <el-checkbox v-model="enabled[a.id]" @change="onToggle">{{ t(a.label) }}</el-checkbox>
            <el-slider
              v-if="a.param && enabled[a.id]"
              v-model="params[a.id]"
              :min="a.param.min"
              :max="a.param.max"
              :step="a.param.step"
              :show-tooltip="false"
              size="small"
              class="aug-slider"
              @input="onParam"
            />
            <span v-if="a.param && enabled[a.id]" class="aug-param-val">{{ t(a.param.label) }}: {{ params[a.id] }}</span>
          </div>
        </div>

        <el-button size="small" text type="primary" @click="resetAll">重置</el-button>
      </aside>

      <!-- 右侧：预览网格 -->
      <section class="aug-grid">
        <AugmentCard
          v-for="card in cards"
          :key="card.id"
          :src="src"
          :annotations="annotations"
          :op-id="card.id"
          :label="card.label"
          :param="card.param"
        />
      </section>
    </div>
    <div v-else class="aug-loading">{{ t('dataset.augDecoding') }}</div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ParsedAnnotation, ImageFile } from '../types'
import AugmentCard from './AugmentCard.vue'
import { AUGMENTATIONS, type AugId } from '../augment/transforms'
import { decodeImageFile } from '../augment/decode'

const props = defineProps<{
  modelValue: boolean
  imageFile?: ImageFile
  annotations: ParsedAnnotation[]
}>()

const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const { t } = useI18n()

const src = ref<HTMLImageElement | null>(null)
const enabled = reactive<Record<AugId, boolean>>(
  Object.fromEntries(AUGMENTATIONS.map((a) => [a.id, false])) as Record<AugId, boolean>,
)
const params = reactive<Record<AugId, number>>(
  Object.fromEntries(AUGMENTATIONS.map((a) => [a.id, a.param?.default ?? 0])) as Record<AugId, number>,
)

const geometric = AUGMENTATIONS.filter((a) => a.kind === 'geometric')
const color = AUGMENTATIONS.filter((a) => a.kind === 'color')

// 卡片列表：原图对照 + 已勾选增强
const cards = computed(() =>
  [
    { id: 'original' as const, label: t('augment.original'), param: 0 },
    ...AUGMENTATIONS.filter((a) => enabled[a.id]).map((a) => ({ id: a.id, label: t(a.label), param: params[a.id] })),
  ],
)

let raf = 0
function scheduleRedraw() {
  // 卡片组件内部已 watch props 自行重绘，这里仅占位以便扩展
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {})
}
function onToggle() {
  scheduleRedraw()
}
function onParam() {
  scheduleRedraw()
}
function resetAll() {
  for (const a of AUGMENTATIONS) {
    enabled[a.id] = false
    if (a.param) params[a.id] = a.param.default
  }
}

async function decode() {
  src.value = null
  if (!props.imageFile) return
  try {
    src.value = await decodeImageFile(props.imageFile)
  } catch (e) {
    console.error('增强预览解码失败', e)
    src.value = null
  }
}

watch(
  () => [props.modelValue, props.imageFile],
  async ([vis]) => {
    if (vis) await decode()
  },
  { immediate: true },
)
</script>

<style scoped>
.aug-layout {
  display: flex;
  gap: 16px;
  min-height: 60vh;
}
.aug-options {
  width: 260px;
  flex: 0 0 260px;
  border-right: 1px solid var(--el-border-color-lighter);
  padding-right: 12px;
  overflow-y: auto;
  max-height: 72vh;
}
.aug-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 0 0 12px;
  line-height: 1.5;
}
.aug-group {
  margin-bottom: 14px;
}
.aug-group-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin-bottom: 6px;
}
.aug-opt {
  display: block;
  margin-bottom: 8px;
}
.aug-slider {
  margin: 2px 0 0 22px;
  width: calc(100% - 22px);
}
.aug-param-val {
  display: block;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-left: 22px;
}
.aug-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  align-content: start;
  overflow-y: auto;
  max-height: 72vh;
  padding-right: 4px;
}
.aug-loading {
  padding: 40px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
</style>
