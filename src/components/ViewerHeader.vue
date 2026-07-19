<template>
  <header class="viewer-header" :class="{ collapsed: headerCollapsed }">
    <template v-if="!headerCollapsed">
      <div class="header-left">
        <img class="header-logo" src="/branding/logo-mark-square.png" alt="DV-DatasetManager" />
        <el-dropdown
          trigger="click"
          :hide-on-click="false"
          class="dataset-dropdown"
          @command="onDatasetCommand"
        >
          <h2 class="viewer-title dataset-title-trigger" :title="t('header.datasetList')">
            <span class="title-text">{{ currentDatasetName }}</span>
            <el-icon class="title-caret"><ArrowDown /></el-icon>
          </h2>
          <template #dropdown>
            <el-dropdown-menu class="dataset-menu">
              <div class="dataset-menu-header">{{ t('header.datasetList') }}</div>
              <el-dropdown-item
                v-for="ds in datasets"
                :key="ds.id"
                :command="'switch:' + ds.id"
                class="dataset-menu-item"
              >
                <span class="ds-name" :title="ds.name">{{ ds.name }}</span>
                <el-button
                  class="ds-close"
                  text
                  size="small"
                  type="danger"
                  :title="t('header.closeDataset')"
                  @click.stop="closeDataset(ds.id)"
                >
                  <el-icon><Close /></el-icon>
                </el-button>
              </el-dropdown-item>
              <div v-if="datasets.length === 0" class="dataset-menu-empty">
                {{ t('header.noDataset') }}
              </div>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <!-- 摘要压缩为一行文本，减少视觉噪音 -->
        <span class="dataset-summary" v-if="datasetCount > 0">
          {{ t('header.datasetSummary', { count: datasetCount, files: totalFiles, anns: totalAnnotations }) }}
        </span>
      </div>

      <div class="header-center">
        <!-- 视图模式切换 -->
        <el-radio-group v-model="viewMode" size="small" @change="onViewModeChange">
          <el-radio-button label="single">
            <el-icon><Monitor /></el-icon> {{ t('viewMode.single') }}
          </el-radio-button>
          <el-radio-button label="stats">
            <el-icon><DataAnalysis /></el-icon> {{ t('viewMode.stats') }}
          </el-radio-button>
          <el-radio-button label="similarity">
            <el-icon><Share /></el-icon> {{ t('viewMode.similarity') }}
          </el-radio-button>
          <el-radio-button label="dedup">
            <el-icon><CopyDocument /></el-icon> {{ t('viewMode.dedup') }}
          </el-radio-button>
          <el-radio-button label="active">
            <el-icon><Aim /></el-icon> {{ t('viewMode.active') }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <div class="header-right">
        <!-- 加载：主按钮 + 下拉（添加 / 分目录），合并原三个加载按钮 -->
        <el-tooltip
          :content="t('header.unsupportedBrowser')"
          :disabled="capabilities.canPickDirectory"
        >
          <span>
            <el-dropdown
              split-button
              type="primary"
              size="small"
              trigger="click"
              :disabled="!capabilities.canPickDirectory"
              @click="handleLoadDataset()"
              @command="onLoadCommand"
            >
              <el-icon><FolderAdd /></el-icon>&nbsp;{{ t('header.loadData') }}
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="add" :icon="Plus" :disabled="datasets.length === 0">
                    {{ t('header.addDataset') }}
                  </el-dropdown-item>
                  <el-dropdown-item command="separate" :icon="FolderOpened">
                    {{ t('header.separateLoad') }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </span>
        </el-tooltip>

        <template v-if="hasDataset">
          <!-- 导出：高频操作保留为独立图标按钮 -->
          <el-tooltip :content="t('header.export')" :show-after="300">
            <el-button size="small" circle @click="handleExport">
              <el-icon><Download /></el-icon>
            </el-button>
          </el-tooltip>

          <!-- 版本 / 迭代对比 -->
          <el-tooltip :content="t('header.version')" :show-after="300">
            <el-button size="small" circle @click="openVersion">
              <el-icon><Files /></el-icon>
            </el-button>
          </el-tooltip>

          <!-- 更多：低频操作收进菜单（哈希 / 识别格式 / 显示设置） -->
          <el-dropdown trigger="click" @command="onMoreCommand">
            <el-button size="small" circle :title="t('header.more')">
              <el-icon><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="hash" :icon="Cpu">
                  {{ computing ? t('header.computingHash') : t('header.computeHash') }}
                </el-dropdown-item>
                <el-dropdown-item command="settings" :icon="Setting">
                  {{ t('header.settings') }}
                </el-dropdown-item>
                <el-dropdown-item command="quality" :icon="Histogram" divided>
                  {{ qualityRunning ? t('header.qualityRunning') : t('header.quality') }}
                </el-dropdown-item>
                <el-dropdown-item divided disabled class="menu-group-label">
                  {{ t('header.recognizeFormat', { fmt: activeFormat }) }}
                </el-dropdown-item>
                <el-dropdown-item
                  v-for="f in formatOptions"
                  :key="f"
                  :command="'fmt:' + f"
                  :class="{ 'fmt-active': f === activeFormat }"
                >
                  {{ f }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

          <!-- 工作区：保存 / 恢复 / 清除多数据集结构配置 -->
          <el-dropdown
            trigger="click"
            :disabled="workspaceBusy"
            @command="onWorkspaceCommand"
          >
            <el-tooltip :content="t('header.workspace')" :show-after="300">
              <el-button size="small" circle :loading="workspaceBusy">
                <el-icon><Folder /></el-icon>
              </el-button>
            </el-tooltip>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="save" :icon="Download">
                  {{ t('header.workspaceSave') }}
                </el-dropdown-item>
                <el-dropdown-item command="restore" :icon="FolderOpened">
                  {{ t('header.workspaceRestore') }}
                </el-dropdown-item>
                <el-dropdown-item command="clear" :icon="Delete" divided>
                  {{ t('header.workspaceClear') }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </div>
    </template>

    <!-- 折叠后的迷你模式 -->
    <template v-else>
      <el-radio-group v-model="viewMode" size="small" @change="onViewModeChange">
        <el-radio-button label="single">{{ t('viewMode.single') }}</el-radio-button>
        <el-radio-button label="stats">{{ t('viewMode.stats') }}</el-radio-button>
        <el-radio-button label="similarity">{{ t('viewMode.similarity') }}</el-radio-button>
        <el-radio-button label="dedup">{{ t('viewMode.dedup') }}</el-radio-button>
        <el-radio-button label="active">{{ t('viewMode.active') }}</el-radio-button>
      </el-radio-group>
    </template>

    <el-button
      class="collapse-btn"
      :icon="headerCollapsed ? ArrowDown : ArrowUp"
      size="small"
      circle
      @click="headerCollapsed = !headerCollapsed"
    />
  </header>
</template>

<script setup lang="ts">
import {
  FolderAdd, Plus, Cpu, Download, Setting, Files, Folder, Delete,
  Monitor, ArrowDown, ArrowUp, DataAnalysis, FolderOpened, MoreFilled, Histogram, Share, CopyDocument, Aim, Close,
} from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { useViewerState } from '../composables/useViewerState'
import { capabilities } from '../capabilities'
import { useQuality } from '../composables/useQuality'
import type { DatasetFormat } from '../dataset/types'

const { t } = useI18n()

const {
  viewMode, headerCollapsed, datasetCount, totalFiles, totalAnnotations,
  currentDatasetName, datasets, hasDataset, showSettings, computing,
  activeFormat, workspaceBusy, activePaneState, closeDataset,
  onViewModeChange, handleLoadDataset, handleAddDataset, handleLoadSeparate,
  reloadActiveWithFormat, openComputeHashes, handleExport, openQualityCheck, openVersion,
  saveWorkspaceNow, restoreWorkspace, clearWorkspace,
} = useViewerState()

const { running: qualityRunning } = useQuality()

const formatOptions: DatasetFormat[] = ['yolo', 'voc', 'coco', 'labelme', 'folder', 'unknown']

function onLoadCommand(cmd: string) {
  if (cmd === 'add') handleAddDataset()
  else if (cmd === 'separate') handleLoadSeparate()
}

function onDatasetCommand(cmd: string) {
  if (cmd.startsWith('switch:')) switchToDataset(cmd.slice(7))
}

function switchToDataset(id: string) {
  const ds = datasets.value.find((d) => d.id === id)
  if (!ds) return
  const pane = activePaneState.value
  pane.setDataset(id)
  if (ds.fileList.length) pane.selectFile(ds.fileList[0])
}

function onMoreCommand(cmd: string) {
  if (cmd === 'hash') openComputeHashes()
  else if (cmd === 'settings') showSettings.value = !showSettings.value
  else if (cmd === 'quality') openQualityCheck()
  else if (cmd.startsWith('fmt:')) reloadActiveWithFormat(cmd.slice(4) as DatasetFormat)
}

function onWorkspaceCommand(cmd: string) {
  if (cmd === 'save') saveWorkspaceNow()
  else if (cmd === 'restore') restoreWorkspace()
  else if (cmd === 'clear') clearWorkspace()
}
</script>
