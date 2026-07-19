<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CheckboxGroupValueType } from 'element-plus'
import type { AnnotationCandidate } from '../dataset/annotationCandidates'

const props = defineProps<{
  modelValue: boolean
  candidates: AnnotationCandidate[]
  selected: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:selected': [value: string[]]
  confirm: []
  cancel: []
}>()

const { t } = useI18n()

function onSelectionChange(val: CheckboxGroupValueType) {
  emit('update:selected', (val as string[]).filter((v) => typeof v === 'string'))
}

function onConfirm() {
  emit('confirm')
}

function onCancel() {
  emit('cancel')
}

const roleMap = (t('annotationRole') as unknown) as Record<string, string>
const roleText = (kind: string) => roleMap[kind] ?? kind

const sortedCandidates = computed(() =>
  [...props.candidates].sort((a, b) => a.priority - b.priority || a.fileName.localeCompare(b.fileName)),
)
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('header.chooseAnnotation')"
    width="520px"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @close="onCancel"
  >
    <div class="ann-picker">
      <p class="ann-hint">{{ t('header.annotationHint') }}</p>
      <el-checkbox-group :model-value="selected" @update:model-value="onSelectionChange">
        <div v-for="c in sortedCandidates" :key="c.path" class="ann-item">
          <el-checkbox :value="c.path" :label="c.fileName">
            <span class="ann-name">{{ c.fileName }}</span>
            <span class="ann-role">{{ roleText(c.kind) }}</span>
          </el-checkbox>
        </div>
      </el-checkbox-group>
      <p v-if="sortedCandidates.length === 0" class="ann-empty">未检测到可用标注文件</p>
    </div>
    <template #footer>
      <el-button @click="onCancel">{{ t('header.annCancel') }}</el-button>
      <el-button type="primary" @click="onConfirm">{{ t('header.annConfirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped lang="less">
.ann-picker {
  max-height: 50vh;
  overflow-y: auto;
}
.ann-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.ann-item {
  padding: 6px 0;
}
.ann-name {
  font-weight: 600;
  margin-right: 8px;
}
.ann-role {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.ann-empty {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
