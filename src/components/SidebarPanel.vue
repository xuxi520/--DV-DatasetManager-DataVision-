<template>
  <div class="sidebar" :class="{ collapsed: sidebarCollapsed }">
    <!-- 文件列表面板：绑定焦点窗格，位置恒定为工作区最左侧 -->
    <aside class="file-panel" :class="{ collapsed: filePanelCollapsed }">
      <div class="panel-header">
        <span class="panel-title">{{ t('sidebar.fileList', { count: filteredFiles.length }) }}</span>
        <div class="panel-header-actions">
          <el-tooltip
            v-if="!filePanelCollapsed"
            :content="t('sidebar.collapseSidebar')"
            placement="bottom"
          >
            <el-button size="small" @click="toggleSidebar">
              <el-icon><Minus /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip
            :content="filePanelCollapsed ? t('sidebar.expandFilePanel') : t('sidebar.collapseFilePanel')"
            placement="bottom"
          >
            <el-button size="small" :type="filePanelCollapsed ? 'primary' : 'default'" @click="toggleFilePanel">
              <el-icon v-if="filePanelCollapsed"><Expand /></el-icon>
              <el-icon v-else><Fold /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>

      <div class="panel-body" v-show="!filePanelCollapsed">
        <div class="file-toolbar">
          <el-input
            v-model="searchText"
            :placeholder="t('sidebar.searchPlaceholder')"
            clearable
            size="small"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>

          <el-button-group class="filter-group">
            <el-button size="small" :type="filterType === 'all' ? 'primary' : ''" @click="filterType = 'all'">{{ t('sidebar.filterAll') }}</el-button>
            <el-button size="small" :type="filterType === 'annotated' ? 'primary' : ''" @click="filterType = 'annotated'">{{ t('sidebar.filterAnnotated') }}</el-button>
            <el-button size="small" :type="filterType === 'unannotated' ? 'primary' : ''" @click="filterType = 'unannotated'">{{ t('sidebar.filterUnannotated') }}</el-button>
            <el-button size="small" :type="filterType === 'overlap' ? 'primary' : ''" @click="filterType = 'overlap'">{{ t('sidebar.filterOverlap') }}</el-button>
            <el-button size="small" :type="filterType === 'nooverlap' ? 'primary' : ''" @click="filterType = 'nooverlap'">{{ t('sidebar.filterNoOverlap') }}</el-button>
            <el-button size="small" :type="filterType === 'quality' ? 'primary' : ''" @click="filterType = 'quality'">{{ t('sidebar.filterQuality') }}</el-button>
          </el-button-group>

          <div class="sort-row">
            <el-select v-model="sortKey" size="small" class="sort-select" :placeholder="t('sidebar.sortName')">
              <el-option :label="t('sidebar.sortName')" value="name" />
              <el-option :label="t('sidebar.sortAnn')" value="ann" />
              <el-option :label="t('sidebar.sortOverlap')" value="overlap" />
              <el-option :label="t('sidebar.sortWh')" value="wh" />
              <el-option :label="t('sidebar.sortSize')" value="size" />
            </el-select>
            <el-button size="small" @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'">
              {{ sortDir === 'asc' ? t('sidebar.asc') : t('sidebar.desc') }}
            </el-button>
          </div>
        </div>

        <div class="file-list-container" ref="listRef" @scroll="onScroll">
          <!-- 虚拟滚动：仅渲染可视区附近的少量节点 -->
          <div class="sv-spacer" :style="{ height: totalHeight + 'px' }">
            <div class="sv-content" :style="{ transform: `translateY(${offsetY}px)` }">
              <div
                v-for="file in visibleFiles"
                :key="file.id"
                class="file-item"
                :class="{ active: selectedFile?.id === file.id }"
                :data-file-id="file.id"
                @click="selectFile(file)"
              >
                <div class="file-info">
                  <div class="file-name">{{ file.name }}</div>
                  <div class="file-meta">
                    {{ file.width }}×{{ file.height }}
                    <el-tag
                      v-if="getFileAnnotations(file).length > 0"
                      size="small"
                      type="success"
                    >
                      {{ getFileAnnotations(file).length }}
                    </el-tag>
                    <el-tag
                      v-if="fileOverlapMap.get(file.id)?.hasOverlap"
                      size="small"
                      type="danger"
                    >
                      重叠 {{ fileOverlapMap.get(file.id)?.pairs }}
                    </el-tag>
                    <el-tag
                      v-for="iss in qualityIssues(file)"
                      :key="iss.label"
                      size="small"
                      :type="iss.type"
                    >
                      {{ iss.label }}
                    </el-tag>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- 标注列表面板：绑定焦点窗格当前选中文件（清洗台） -->
    <aside
      class="annotation-panel"
      :class="{ collapsed: annotationPanelCollapsed }"
      v-if="selectedFile"
    >
      <div class="panel-header">
        <span class="panel-title">{{ t('sidebar.annotations', { count: currentAnnotations.length }) }}</span>
        <el-tooltip
          :content="annotationPanelCollapsed ? t('sidebar.expandAnnotations') : t('sidebar.collapseAnnotations')"
          placement="bottom"
        >
          <el-button size="small" :type="annotationPanelCollapsed ? 'primary' : 'default'" @click="toggleAnnotationPanel">
            <el-icon v-if="annotationPanelCollapsed"><Expand /></el-icon>
            <el-icon v-else><Fold /></el-icon>
          </el-button>
        </el-tooltip>
      </div>

      <div class="panel-body" v-show="!annotationPanelCollapsed">
        <!-- 清洗台工具条：选择/画框、新框类别、撤销/重做、保存 -->
        <div class="edit-toolbar">
          <el-button-group size="small">
            <el-button :type="editingMode === 'select' ? 'primary' : ''" @click="editingMode = 'select'">
              <el-icon><Rank /></el-icon> {{ t('sidebar.modeSelect') }}
            </el-button>
            <el-button :type="editingMode === 'draw' ? 'primary' : ''" @click="editingMode = 'draw'">
              <el-icon><EditPen /></el-icon> {{ t('sidebar.modeDraw') }}
            </el-button>
          </el-button-group>

          <el-select
            v-if="editingMode === 'draw'"
            v-model="editClassId"
            size="small"
            class="edit-class-select"
            :placeholder="t('sidebar.newClassPlaceholder')"
          >
            <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>

          <el-radio-group v-if="editingMode === 'draw'" v-model="editDrawType" size="small" class="edit-drawtype">
            <el-radio-button value="bbox">{{ t('sidebar.drawTypeBBox') }}</el-radio-button>
            <el-radio-button value="polygon">{{ t('sidebar.drawTypePolygon') }}</el-radio-button>
          </el-radio-group>

          <el-button-group size="small" class="edit-undo">
            <el-button :disabled="!canUndo" @click="undo" :title="t('sidebar.undo')">
              <el-icon><RefreshLeft /></el-icon>
            </el-button>
            <el-button :disabled="!canRedo" @click="redo" :title="t('sidebar.redo')">
              <el-icon><RefreshRight /></el-icon>
            </el-button>
            <el-popover placement="bottom" :width="240" trigger="click">
              <template #reference>
                <el-button :title="t('sidebar.history')">
                  <el-icon><Clock /></el-icon>
                </el-button>
              </template>
              <div class="history-pop">
                <div class="history-title">{{ t('sidebar.history') }}</div>
                <div v-if="undoLabels.length === 0 && redoLabels.length === 0" class="history-empty">
                  {{ t('sidebar.historyEmpty') }}
                </div>
                <template v-else>
                  <ul v-if="redoLabels.length" class="history-list history-future">
                    <li v-for="(lb, i) in redoLabels" :key="'r' + i">
                      <el-icon><Top /></el-icon> {{ lb }}
                    </li>
                  </ul>
                  <div class="history-cursor">{{ t('sidebar.historyCursor') }}</div>
                  <ul v-if="undoLabels.length" class="history-list history-past">
                    <li v-for="(lb, i) in undoLabels" :key="'u' + i" :class="{ latest: i === 0 }">
                      <el-icon><Bottom /></el-icon> {{ lb }}
                    </li>
                  </ul>
                </template>
              </div>
            </el-popover>
          </el-button-group>

          <!-- 保存：桌面端写回原文件；浏览器端无法写回磁盘，改为导出 ZIP -->
          <el-button
            size="small"
            :type="capabilities.canWriteFiles ? 'success' : 'warning'"
            :disabled="dirtyFiles.size === 0"
            @click="onSave"
            :title="capabilities.canWriteFiles ? t('sidebar.saveTitle') : t('sidebar.exportEditTitle')"
          >
            <el-icon><Check /></el-icon> {{ capabilities.canWriteFiles ? t('sidebar.save', { count: dirtyFiles.size }) : t('sidebar.exportEdit', { count: dirtyFiles.size }) }}
          </el-button>
        </div>

        <!-- 浏览器模式提示：编辑可用，但保存只能导出 ZIP，无法写回原文件 -->
        <el-alert
          v-if="!capabilities.canWriteFiles"
          class="env-hint"
          type="info"
          :closable="false"
          show-icon
          :title="t('sidebar.browserHint')"
        />

        <div v-if="currentAnnotations.length === 0" class="empty-hint">
          {{ t('sidebar.noAnnHint') }}
        </div>

        <template v-else>
          <div
            v-for="(ann, idx) in currentAnnotations"
            :key="idx"
            class="annotation-item"
            :class="{ active: selectedAnnotationIndex === idx }"
            @click="selectedAnnotationIndex = idx"
          >
            <div class="ann-main">
              <div class="ann-color" :style="{ background: ann.color }"></div>
              <el-select
                :model-value="ann.classId"
                size="small"
                class="ann-class-select"
                @change="onClassChange(idx, $event)"
              >
                <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
              <div class="ann-info">
                <el-tag size="small" :type="annTypeTag(ann.type)" effect="light">
                  {{ t(getAnnotationTypeLabelKey(ann.type)) }}
                </el-tag>
              </div>
              <div class="ann-confidence" v-if="ann.confidence != null">
                {{ (ann.confidence * 100).toFixed(0) }}%
              </div>
            </div>
            <el-button size="small" text type="danger" class="ann-del" @click.stop="onDeleteAnnotation(idx)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
        </template>
      </div>
    </aside>

    <!-- 面板折叠后的重新展开条：不占布局空间（悬浮于侧栏边缘），始终可点，杜绝「全折叠死锁」 -->
    <div
      class="file-panel-toggle"
      v-if="filePanelCollapsed && !sidebarCollapsed"
      @click="toggleFilePanel"
      :title="t('sidebar.expandFilePanel')"
    >
      <el-icon><Expand /></el-icon>
    </div>
    <div
      class="annotation-panel-toggle"
      v-if="annotationPanelCollapsed && !sidebarCollapsed"
      @click="toggleAnnotationPanel"
      :title="t('sidebar.expandAnnotations')"
    >
      <el-icon><Expand /></el-icon>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Fold, Expand, Search, Rank, EditPen, RefreshLeft, RefreshRight, Check, Delete, Clock, Top, Bottom } from '@element-plus/icons-vue'
import { useViewerState } from '../composables/useViewerState'
import { useQuality } from '../composables/useQuality'
import { capabilities } from '../capabilities'
import type { ImageFile } from '../types'
import type { QualityIssue } from '../quality/types'

const { t } = useI18n()
const store = useViewerState()
const quality = useQuality()

// 焦点窗格（随点击切换）；侧栏始终绑定它，位置恒定不再「弹出/跳转」
const pane = store.activePaneState

// 把焦点窗格的各 ref 包成响应式计算属性，切换焦点时侧栏内容自动同步
const searchText = computed({
  get: () => pane.value.searchText.value,
  set: (v) => (pane.value.searchText.value = v),
})
const filterType = computed({
  get: () => pane.value.filterType.value,
  set: (v) => (pane.value.filterType.value = v),
})
const sortKey = computed({
  get: () => pane.value.sortKey.value,
  set: (v) => (pane.value.sortKey.value = v),
})
const sortDir = computed({
  get: () => pane.value.sortDir.value,
  set: (v) => (pane.value.sortDir.value = v),
})

const filteredFiles = computed(() => pane.value.filteredFiles.value)
const selectedFile = computed(() => pane.value.selectedFile.value)
const currentAnnotations = computed(() => pane.value.currentAnnotations.value)
const currentIndex = computed(() => pane.value.currentIndex.value)
const selectedAnnotationIndex = computed({
  get: () => pane.value.selectedAnnotationIndex.value,
  set: (v) => (pane.value.selectedAnnotationIndex.value = v),
})
const fileOverlapMap = computed(() => pane.value.fileOverlapMap.value)

// 全局侧栏折叠状态与切换
const {
  sidebarCollapsed, filePanelCollapsed, annotationPanelCollapsed,
  toggleSidebar, toggleFilePanel, toggleAnnotationPanel,
} = store
const { getFileAnnotations, getAnnotationTypeLabelKey } = store

// 清洗台（轻量标注编辑）相关状态/动作（全局单例）
// 注意：editingMode / editClassId 必须用 computed 代理再 expose 给模板——
// 直接解构出的 ref 在模板里 @click="editingMode='draw'" / v-model 不会回写到单例。
const editingMode = computed({
  get: () => store.editingMode.value,
  set: (v) => (store.editingMode.value = v),
})
const editClassId = computed({
  get: () => store.editClassId.value,
  set: (v) => (store.editClassId.value = v),
})
const editDrawType = computed({
  get: () => store.editDrawType.value,
  set: (v) => (store.editDrawType.value = v),
})
const { canUndo, canRedo, undoLabels, redoLabels, undo, redo, saveEditedAnnotations, changeAnnotationClass, deleteAnnotationAt, dirtyFiles } = store

// 当前选中文件所属数据集的类别表（用于类别下拉）
const classes = computed(() => pane.value.dataset.value?.canonical?.classes || [])

function onClassChange(idx: number, v: number) {
  const f = selectedFile.value
  if (f) changeAnnotationClass(f, idx, v)
}
/** 标注类型 -> el-tag 颜色，辅助视觉区分 */
function annTypeTag(type: string): 'primary' | 'success' | 'info' | 'warning' | 'danger' {
  switch (type) {
    case 'obb': return 'danger'
    case 'keypoints': return 'info'
    case 'mask': return 'primary'
    case 'segmentation': return 'warning'
    case 'polygon': return 'success'
    default: return '' as any
  }
}
function onDeleteAnnotation(idx: number) {
  const f = selectedFile.value
  if (!f) return
  deleteAnnotationAt(f, idx)
  const remain = currentAnnotations.value.length
  selectedAnnotationIndex.value = remain > 0 ? Math.min(idx, remain - 1) : -1
}
async function onSave() {
  const n = await saveEditedAnnotations()
  if (n > 0) ElMessage.success(t('sidebar.saved', { count: n }))
}

function selectFile(file: ImageFile) {
  pane.value.selectFile(file)
}

// 质量检查结果（全局单例），用于在文件行展示质量问题徽标
const ISSUE_META: Record<QualityIssue, { labelKey: string; type: 'warning' | 'info' | 'danger' | 'success' }> = {
  blur: { labelKey: 'stats.qBlur', type: 'warning' },
  dark: { labelKey: 'stats.qDark', type: 'info' },
  bright: { labelKey: 'stats.qBright', type: 'info' },
  lowRes: { labelKey: 'stats.qLowRes', type: 'danger' },
  monochrome: { labelKey: 'stats.qMono', type: 'success' },
}
function qualityIssues(file: ImageFile): { label: string; type: 'warning' | 'info' | 'danger' | 'success' }[] {
  const r = quality.results.value.get(file.id)
  if (!r) return []
  return quality.issueList(r).map((k) => ({ label: t(ISSUE_META[k].labelKey), type: ISSUE_META[k].type }))
}

// 文件列表虚拟滚动：基于固定行高只渲染可视区附近的少量节点
const listRef = ref<HTMLElement>()
const scrollTop = ref(0)
const ITEM_HEIGHT = 60 // = 文件项 56px + 4px 间距
const VISIBLE_BUFFER = 10

const totalHeight = computed(() => filteredFiles.value.length * ITEM_HEIGHT)
const visibleStart = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / ITEM_HEIGHT) - VISIBLE_BUFFER),
)
const visibleEnd = computed(() => {
  // listRef 未挂载/未测量时用兜底视口高度，避免首帧一次性渲染 3457 个节点
  const viewport = listRef.value?.clientHeight || 600
  const visible = Math.ceil(viewport / ITEM_HEIGHT)
  return Math.min(
    filteredFiles.value.length,
    Math.floor(scrollTop.value / ITEM_HEIGHT) + visible + VISIBLE_BUFFER,
  )
})
const offsetY = computed(() => visibleStart.value * ITEM_HEIGHT)
const visibleFiles = computed(() =>
  filteredFiles.value.slice(visibleStart.value, visibleEnd.value),
)

function onScroll() {
  if (listRef.value) scrollTop.value = listRef.value.scrollTop
}

// 选中项变化（键盘 ←/→、点击、排序/筛选后索引漂移）时，将虚拟列表滚动到该项入视野
function scrollSelectedIntoView() {
  const idx = currentIndex.value
  if (!listRef.value || idx < 0) return
  const el = listRef.value
  const top = idx * ITEM_HEIGHT
  const bottom = top + ITEM_HEIGHT
  const viewTop = el.scrollTop
  const viewBottom = viewTop + el.clientHeight
  let next = viewTop
  if (top < viewTop) next = top
  else if (bottom > viewBottom) next = bottom - el.clientHeight
  if (next !== viewTop) {
    el.scrollTop = next
    scrollTop.value = next // 同步更新，避免一帧的陈旧渲染窗口
  }
}

watch(currentIndex, scrollSelectedIntoView)
</script>

<style scoped>
.history-pop {
  font-size: 12px;
}
.history-title {
  font-weight: 700;
  margin-bottom: 6px;
  color: var(--el-text-color-primary);
}
.history-empty {
  color: var(--el-text-color-secondary);
  padding: 8px 0;
  text-align: center;
}
.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 160px;
  overflow-y: auto;
}
.history-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 4px;
  color: var(--el-text-color-regular);
}
.history-future li {
  color: var(--el-text-color-secondary);
  opacity: 0.75;
}
.history-past li.latest {
  color: var(--el-color-primary);
  font-weight: 600;
  background: var(--el-color-primary-light-9);
}
.history-cursor {
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  margin: 4px 0;
}
</style>

