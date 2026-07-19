<template>
  <div class="dataset-viewer">
    <!-- 拖放文件夹加载覆盖层 -->
    <div class="drop-overlay" v-if="dragOver">
      <div class="drop-overlay-inner">
        <el-icon class="drop-icon"><UploadFilled /></el-icon>
        <p class="drop-title">{{ t('viewer.dropTitle') }}</p>
        <p class="drop-sub">{{ t('viewer.dropSub') }}</p>
      </div>
    </div>

    <!-- 全屏加载覆盖（候选标注弹窗显示时让位，避免遮罩盖住对话框）-->
    <div class="loading-overlay" v-if="loading && !annPicker.visible">
      <div class="loading-content">
        <el-progress type="circle" :percentage="loadingPct" :width="80" />
        <p class="loading-text">{{ loadingText }}</p>
        <p class="loading-sub" v-if="loadingDetail">{{ loadingDetail }}</p>
      </div>
    </div>

    <!-- 顶部工具-->
    <ViewerHeader />

    <!-- 悬浮设置菜单 -->
    <SettingsPanel />

    <!-- 主内容区 -->
    <main class="viewer-main">
      <template v-if="!hasDataset">
          <div class="empty-state">
            <el-empty :description="t('viewer.emptyDesc')">
              <el-tooltip
                :content="t('header.unsupportedBrowser')"
                :disabled="capabilities.canPickDirectory"
              >
                <el-button type="primary" :disabled="!capabilities.canPickDirectory" @click="handleLoadDataset()">
                  <el-icon><FolderAdd /></el-icon> {{ t('header.loadData') }}
                </el-button>
              </el-tooltip>
            </el-empty>
          </div>
      </template>

      <template v-else>
        <!-- 数据集预览：可变多窗格，水平均分铺满超宽屏；主窗格可「添加窗口」扩展对照 -->
        <template v-if="viewMode === 'single'">
          <!-- 共享侧栏（master-detail）：唯一一份文件列表+标注面板，固定在最左侧，绑定焦点窗格 -->
          <SidebarPanel />
          <div class="panes-row">
            <template v-for="(pane, idx) in panes" :key="pane.id">
              <PaneView
                :pane-id="pane.id"
                :active="activePane === pane.id"
                :style="getPaneStyle(pane.id)"
                @activate="activePane = pane.id"
              />
              <div
                v-if="idx < panes.length - 1"
                class="pane-divider"
                :class="{ resizing }"
                @mousedown="startResize($event, panes[idx].id, panes[idx + 1].id)"
              ></div>
            </template>
          </div>
          <!-- 侧栏收起时的悬浮展开按钮 -->
          <button
            v-if="sidebarCollapsed"
            class="sidebar-expand"
            :title="t('sidebar.expandSidebar')"
            @click="toggleSidebar"
          >
            <el-icon><Expand /></el-icon>
            <span class="toggle-label">{{ t('sidebar.expandSidebarShort') }}</span>
          </button>
        </template>

        <!-- 统计面板 -->
        <StatsView
          v-else-if="viewMode === 'stats'"
          :datasets="datasets"
          :dataset-annotations="datasetAnnotations"
          :category-color-map="categoryColorMap"
        />

        <!-- 相似检索（P2 数据策展） -->
        <SimilarityView v-else-if="viewMode === 'similarity'" />

        <!-- 去重（并入浏览工作台，与预览/统计/相似平级，共享已加载数据集） -->
        <DedupView v-else-if="viewMode === 'dedup'" />

        <!-- 主动学习（导入模型输出，定位低置信/难样本） -->
        <ActiveLearningView v-else-if="viewMode === 'active'" />
      </template>
    </main>

    <!-- 底部状态栏：焦点窗格信息 + 多窗格标签条 -->
    <footer class="viewer-footer" v-if="hasDataset">
      <!-- 焦点窗格信息 -->
      <div class="footer-left">
        <template v-if="panes.length === 1">
          <span>{{ t('viewer.filesCount', { count: footerCount }) }}</span>
          <el-divider direction="vertical" />
          <span>{{ footerIndex + 1 }} / {{ footerCount }}</span>
          <template v-if="footerSelected">
            <el-divider direction="vertical" />
            <span>{{ footerSelected.width }}×{{ footerSelected.height }}</span>
          </template>
        </template>
        <template v-else>
          <span class="pane-idx-list">
            <span
              v-for="p in paneIndexInfo"
              :key="p.id"
              class="pane-idx"
              :class="{ active: p.id === activePane }"
              :title="p.name"
            >
              {{ p.idx }}: {{ p.hasFile ? p.index + 1 + '/' + p.count : '—' }}
            </span>
          </span>
        </template>
      </div>

      <div class="footer-center">
        <el-button-group size="small">
          <el-button @click="prevFileAll" :disabled="!allCanPrev" :title="t('viewer.prevAll')">
            <el-icon><ArrowLeft /></el-icon>
          </el-button>
          <el-button @click="nextFileAll" :disabled="!allCanNext" :title="t('viewer.nextAll')">
            <el-icon><ArrowRight /></el-icon>
          </el-button>
        </el-button-group>
        <span class="sync-hint" v-if="panes.length > 1">
          {{ syncByFilename ? t('viewer.syncByName') : t('viewer.syncByIndex') }}
        </span>
        <el-tooltip
          v-if="panes.length > 1"
          :content="syncByFilename ? t('viewer.syncOff') : t('viewer.syncOn')"
        >
          <el-switch
            v-model="syncByFilename"
            size="small"
            inline-prompt
            active-text="名"
            inactive-text="序"
          />
        </el-tooltip>
      </div>

      <div class="footer-right">
        <!-- 多窗格标签条：点击切换焦点窗格 -->
        <div class="pane-tabs" v-if="panes.length > 1">
          <button
            v-for="p in panes"
            :key="p.id"
            class="pane-tab"
            :class="{ active: activePane === p.id }"
            @click="activePane = p.id"
            :title="p.dataset.value?.name || '未选择数据集'"
          >
            <span class="pane-tab-idx">{{ panes.indexOf(p) + 1 }}</span>
            <span class="pane-tab-name">{{ p.dataset.value?.name || '未选择' }}</span>
          </button>
        </div>
        <span class="mode-label">{{ t('viewMode.' + viewMode) }} {{ t('viewMode.modeSuffix') }}</span>
      </div>
    </footer>

    <!-- 计算进度对话框-->
    <el-dialog
      v-model="computing"
      title="正在计算哈希..."
      :close-on-click-modal="false"
      :show-close="false"
      width="400px"
    >
      <el-progress :percentage="computeProgress" />
      <p class="compute-status">{{ computeStatus }}</p>
      <p class="compute-cache-hit" v-if="computeCacheHits > 0">已命中缓存（跳过计算）：{{ computeCacheHits }} 张</p>
      <el-button @click="cancelCompute = true">取消</el-button>
    </el-dialog>

    <!-- 导出数据集对话框 -->
    <ExportDialog />

    <!-- 数据集版本 / 迭代间 diff 对话框 -->
    <VersionDialog />

    <!-- 质量检查进度对话框 -->
    <el-dialog
      v-model="qualityRunning"
      title="正在质量检查..."
      :close-on-click-modal="false"
      :show-close="false"
      width="400px"
    >
      <el-progress
        :percentage="Math.round((qualityProgress.processed / Math.max(1, qualityProgress.total)) * 100)"
      />
      <p class="compute-status">{{ qualityProgress.processed }} / {{ qualityProgress.total }}</p>
      <p class="compute-cache-hit" v-if="qualityCacheHits > 0">已命中缓存（跳过计算）：{{ qualityCacheHits }} 张</p>
      <el-button @click="qualityCancel">取消</el-button>
    </el-dialog>

    <!-- 质量检查：选择目标数据集 -->
    <el-dialog
      v-model="qualitySelectorVisible"
      title="质量检查 · 选择数据集"
      :close-on-click-modal="false"
      width="440px"
    >
      <div class="target-select-row">
        <span class="target-select-label">目标数据集</span>
        <el-select
          v-model="qualityTargetDatasetId"
          size="default"
          placeholder="选择数据集"
          class="target-select-input"
        >
          <el-option label="全部已加载数据集" value="__all__" />
          <el-option
            v-for="ds in datasets"
            :key="ds.id"
            :label="ds.name"
            :value="ds.id"
          />
        </el-select>
      </div>
      <template #footer>
        <el-button @click="qualitySelectorVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmQualityCheck">开始检查</el-button>
      </template>
    </el-dialog>

    <!-- 计算哈希：选择目标数据集 -->
    <el-dialog
      v-model="hashSelectorVisible"
      title="计算哈希 · 选择数据集"
      :close-on-click-modal="false"
      width="440px"
    >
      <div class="target-select-row">
        <span class="target-select-label">目标数据集</span>
        <el-select
          v-model="hashTargetDatasetId"
          size="default"
          placeholder="选择数据集"
          class="target-select-input"
        >
          <el-option label="全部已加载数据集" value="__all__" />
          <el-option
            v-for="ds in datasets"
            :key="ds.id"
            :label="ds.name"
            :value="ds.id"
          />
        </el-select>
      </div>
      <template #footer>
        <el-button @click="hashSelectorVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmComputeHashes">开始计算</el-button>
      </template>
    </el-dialog>

    <!-- 多任务标注文件选择：当目录下存在多个候选标注 json 时弹出 -->
    <AnnotationPickerDialog
      v-model="annPicker.visible"
      :candidates="annPicker.candidates"
      v-model:selected="annPicker.selected"
      @confirm="confirmAnnPicker"
      @cancel="cancelAnnPicker"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderAdd, ArrowLeft, ArrowRight, Expand, UploadFilled } from '@element-plus/icons-vue'
import ViewerHeader from './ViewerHeader.vue'
import SettingsPanel from './SettingsPanel.vue'
import SidebarPanel from './SidebarPanel.vue'
import PaneView from './PaneView.vue'
import StatsView from './StatsView.vue'
import SimilarityView from './SimilarityView.vue'
import ActiveLearningView from './ActiveLearningView.vue'
import ExportDialog from './ExportDialog.vue'
import VersionDialog from './VersionDialog.vue'
import AnnotationPickerDialog from './AnnotationPickerDialog.vue'
import { useViewerState } from '../composables/useViewerState'
import { useFolderDrop } from '../composables/useFolderDrop'
import { capabilities } from '../capabilities'
import { useQuality } from '../composables/useQuality'

const { t } = useI18n()

const {
  loading, loadingText, loadingPct, loadingDetail,
  viewMode, dualPane, activePane,
  datasets, datasetAnnotations, categoryColorMap,
  panes,
  hasDataset, footerCount, footerIndex, footerSelected, paneIndexInfo,
  prevFileAll, nextFileAll, allCanPrev, allCanNext,
  computing, computeProgress, computeStatus, computeCacheHits, cancelCompute,
  qualityTargetDatasetId, qualitySelectorVisible, confirmQualityCheck,
  hashTargetDatasetId, hashSelectorVisible, confirmComputeHashes,
  getPaneStyle, startResize, resizing, syncByFilename,
  sidebarCollapsed, toggleSidebar,
  handleLoadDataset, handleKeydown,
  promptRestoreOnStartup,
  annPicker, confirmAnnPicker, cancelAnnPicker,
} = useViewerState()

const {
  running: qualityRunning, progress: qualityProgress, cacheHits: qualityCacheHits, cancel: qualityCancel,
} = useQuality()

// 拖放文件夹加载（双端）：复用与「选择文件夹」一致的加载管线
const { dragOver } = useFolderDrop((opts) => {
  void handleLoadDataset(opts)
})

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  // 启动恢复：若开启「启动提示恢复」且存在已保存工作区，弹窗询问而非静默自动恢复
  void promptRestoreOnStartup()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.target-select-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.target-select-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.target-select-input {
  flex: 1;
}

.sync-hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 拖放文件夹覆盖层 */
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--el-color-primary) 12%, rgba(0, 0, 0, 0.45));
  backdrop-filter: blur(2px);
  pointer-events: none;
}

.drop-overlay-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 48px;
  border: 2px dashed var(--el-color-primary);
  border-radius: 14px;
  background: var(--el-bg-color);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
}

.drop-icon {
  font-size: 56px;
  color: var(--el-color-primary);
}

.drop-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.drop-sub {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
