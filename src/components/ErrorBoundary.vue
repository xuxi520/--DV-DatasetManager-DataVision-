<template>
  <div class="error-boundary" v-if="failed">
    <el-result icon="error" :title="t('errorBoundary.title')" :sub-title="errorMsg">
      <template #extra>
        <el-button type="primary" @click="reset">{{ t('errorBoundary.retry') }}</el-button>
      </template>
    </el-result>
  </div>
  <template v-else>
    <slot />
  </template>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// 捕获子孙组件在渲染/生命周期中抛出的错误，阻止其冒泡导致整页白屏。
// 单窗格内的异常被隔离在此边界内，仅该窗格显示降级 UI，其余窗格与工具栏不受影响。
const failed = ref(false)
const errorMsg = ref('')

function onErrorCaptured(err: unknown) {
  failed.value = true
  errorMsg.value = err instanceof Error ? err.message || err.toString() : String(err)
  console.error('[ErrorBoundary] 捕获到子组件渲染错误（已隔离，不影响其他窗格）：', err)
  return false // 停止错误继续向上冒泡
}

function reset() {
  failed.value = false
  errorMsg.value = ''
}

defineExpose({ reset })
</script>

<style scoped>
.error-boundary {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}
</style>
