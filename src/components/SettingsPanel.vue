<template>
  <transition name="fade">
    <div class="settings-menu" v-if="showSettings" @click.self="showSettings = false">
      <div class="settings-content">
        <div class="settings-header">
          <h3>设置</h3>
          <el-button size="small" text @click="showSettings = false">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>

        <div class="settings-body">
          <div class="settings-section">
            <h4>标注显示</h4>
            <el-switch v-model="showAnnotations" active-text="显示标注" />
            <el-switch v-model="showAnnotationLabels" active-text="显示标签" class="mt-2" />
            <el-switch v-model="showConfidence" active-text="显示置信度" class="mt-2" />
          </div>

          <div class="settings-section">
            <h4>图像设置</h4>
            <el-switch v-model="autoFit" active-text="自动适配" />
            <el-switch v-model="showImageInfo" active-text="显示信息" class="mt-2" />
          </div>

          <div class="settings-section">
            <h4>快捷</h4>
            <div class="shortcut-list">
              <div class="shortcut-item"><kbd>←</kbd> <span>上一</span></div>
              <div class="shortcut-item"><kbd>→</kbd> <span>下一</span></div>
              <div class="shortcut-item"><kbd>Ctrl+Scroll</kbd> <span>缩放</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { Close } from '@element-plus/icons-vue'
import { useViewerState } from '../composables/useViewerState'

const {
  showSettings, showAnnotations, showAnnotationLabels, showConfidence, autoFit, showImageInfo,
} = useViewerState()
</script>
