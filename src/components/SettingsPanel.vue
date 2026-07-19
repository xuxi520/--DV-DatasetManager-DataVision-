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
            <el-switch v-model="showPredictions" active-text="显示预测框" class="mt-2" />
            <el-switch v-model="showAnnotationList" active-text="标注列表面板" class="mt-2" />
          </div>

          <div class="settings-section">
            <h4>图像设置</h4>
            <el-switch v-model="autoFit" active-text="自动适配" />
            <el-switch v-model="showImageInfo" active-text="显示信息" class="mt-2" />
          </div>

          <div class="settings-section" v-if="qOpts">
            <h4>质量检查阈值</h4>
            <div class="q-row">
              <span class="q-label">模糊方差</span>
              <el-slider v-model="qOpts.blurThreshold" :min="10" :max="300" :step="5" show-input />
            </div>
            <div class="q-row">
              <span class="q-label">过暗上限</span>
              <el-slider v-model="qOpts.darkThreshold" :min="0" :max="120" :step="5" show-input />
            </div>
            <div class="q-row">
              <span class="q-label">过亮下限</span>
              <el-slider v-model="qOpts.brightThreshold" :min="130" :max="255" :step="5" show-input />
            </div>
            <div class="q-row">
              <span class="q-label">最小分辨率</span>
              <el-slider v-model="qOpts.minResolution" :min="8" :max="128" :step="4" show-input />
            </div>
            <div class="q-row">
              <span class="q-label">单色饱和度</span>
              <el-slider v-model="qOpts.monochromeSaturation" :min="0" :max="40" :step="1" show-input />
            </div>
          </div>


          <div class="settings-section">
            <h4>快捷</h4>
            <div class="shortcut-list">
              <div class="shortcut-item"><kbd>←</kbd> <span>上一</span></div>
              <div class="shortcut-item"><kbd>→</kbd> <span>下一</span></div>
              <div class="shortcut-item"><kbd>Ctrl+Scroll</kbd> <span>缩放</span></div>
            </div>
          </div>

          <div class="settings-section">
            <h4>工作区</h4>
            <p class="cache-tip">保存当前多数据集结构（路径/目录、窗格布局、显示设置），重启后一键或自动恢复。</p>
            <el-switch v-model="autoRestore" active-text="启动时提示恢复工作区" />
            <div class="ws-actions">
              <el-button size="small" :loading="workspaceBusy" @click="() => saveWorkspaceNow()">
                <el-icon><Download /></el-icon> 保存
              </el-button>
              <el-button size="small" :loading="workspaceBusy" @click="() => restoreWorkspace()">
                <el-icon><FolderOpened /></el-icon> 恢复
              </el-button>
            </div>
          </div>


          <div class="settings-section">
            <h4>缓存管理</h4>
            <p class="cache-tip">哈希与质量检查结果按内容（md5）持久化于浏览器 IndexedDB，重跑/重开自动复用。</p>
            <div class="cache-stats">
              <div class="cache-stat">
                <span class="cache-stat-label">哈希缓存</span>
                <b class="cache-stat-value">{{ cacheStats.hashes }}</b>
              </div>
              <div class="cache-stat">
                <span class="cache-stat-label">质量缓存</span>
                <b class="cache-stat-value">{{ cacheStats.quality }}</b>
              </div>
              <div class="cache-stat">
                <span class="cache-stat-label">索引</span>
                <b class="cache-stat-value">{{ cacheStats.statIndex }}</b>
              </div>
            </div>
            <div class="cache-size">
              预估占用 <b>{{ formatBytes(cacheStats.estimatedBytes) }}</b>
            </div>
            <el-button
              size="small"
              type="danger"
              plain
              :loading="clearing"
              @click="confirmClearCache"
            >
              <el-icon><Delete /></el-icon> 清空缓存
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Close, Delete, Download, FolderOpened } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useViewerState } from '../composables/useViewerState'
import { useQuality } from '../composables/useQuality'
import { getCacheStats, clearCache, type CacheStats } from '../cache/idbCache'

const {
  showSettings, showAnnotations, showAnnotationLabels, showConfidence, autoFit, showImageInfo, showPredictions, showAnnotationList,
  autoRestore, workspaceBusy, saveWorkspaceNow, restoreWorkspace,
} = useViewerState()

const { options: qOpts } = useQuality()

// 缓存可视化：打开设置时刷新三表计数，清空后归零
const cacheStats = ref<CacheStats>({ hashes: 0, quality: 0, statIndex: 0, embeddings: 0, estimatedBytes: 0 })
const clearing = ref(false)

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

async function refreshCacheStats() {
  try {
    cacheStats.value = await getCacheStats()
  } catch {
    // IndexedDB 不可用（如某些隐私模式）时静默忽略
  }
}

watch(showSettings, (v) => {
  if (v) refreshCacheStats()
})

async function confirmClearCache() {
  try {
    await ElMessageBox.confirm(
      '将清空全部哈希、质量检查与特征向量缓存，下次运行需重新计算。确定继续？',
      '清空缓存',
      { confirmButtonText: '清空', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return // 用户取消
  }
  clearing.value = true
  try {
    await clearCache()
    cacheStats.value = { hashes: 0, quality: 0, statIndex: 0, embeddings: 0, estimatedBytes: 0 }
    ElMessage.success('缓存已清空')
  } catch (e: any) {
    ElMessage.error('清空失败：' + String(e?.message || e))
  } finally {
    clearing.value = false
  }
}
</script>

<style scoped>
.q-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.q-label {
  width: 72px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.q-row :deep(.el-slider) {
  flex: 1;
}
.cache-tip {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.cache-stats {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.cache-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-light);
}
.cache-stat-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.cache-stat-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.cache-size {
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.cache-size b {
  color: var(--el-color-primary);
  font-size: 13px;
}
</style>
