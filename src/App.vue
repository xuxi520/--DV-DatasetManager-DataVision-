<template>
  <el-config-provider :locale="elLocale">
    <div class="app-container">
      <!-- 顶部导航 -->
      <nav class="app-nav" :class="{ 'is-tauri': isTauri }" @mousedown="onNavMouseDown">
        <div class="nav-brand">
          <img class="nav-logo" src="/branding/logo-mark-square.png" alt="DV-DatasetManager" />
          <span>{{ t('app.brand') }}</span>
        </div>
        <div class="nav-right">
          <!-- 语言切换 -->
          <el-dropdown trigger="click" @command="(v: LocaleKey) => setLocale(v)">
            <el-button size="small" circle :title="t('app.language')">
              <el-icon><Operation /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="loc in SUPPORTED_LOCALES"
                  :key="loc.value"
                  :command="loc.value"
                  :class="{ active: currentLocale === loc.value }"
                >
                  {{ loc.label }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

          <!-- 主题：收进图标下拉，减少导航栏占用 -->
          <el-dropdown trigger="click" @command="(v: ThemeMode) => (themeMode = v)">
            <el-button size="small" circle :title="t('app.theme') + '：' + themeLabel">
              <el-icon><component :is="themeIcon" /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="light" :icon="Sunny" :class="{ active: themeMode === 'light' }">{{ t('app.themeLight') }}</el-dropdown-item>
                <el-dropdown-item command="dark" :icon="Moon" :class="{ active: themeMode === 'dark' }">{{ t('app.themeDark') }}</el-dropdown-item>
                <el-dropdown-item command="system" :icon="Monitor" :class="{ active: themeMode === 'system' }">{{ t('app.themeSystem') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

          <!-- 窗口控制（仅桌面端，无边框窗口需要） -->
          <div v-if="isTauri" class="window-controls">
            <button class="wc-btn" type="button" :title="t('app.minimize')" @click="minimize">
              <el-icon><Minus /></el-icon>
            </button>
            <button class="wc-btn" type="button" :title="t('app.toggleMaximize')" @click="toggleMaximize">
              <el-icon><component :is="isMaximized ? CopyDocument : FullScreen" /></el-icon>
            </button>
            <button class="wc-btn wc-close" type="button" :title="t('app.close')" @click="close">
              <el-icon><Close /></el-icon>
            </button>
          </div>
        </div>
      </nav>

      <!-- 浏览模式（内部用 viewMode 在 预览/统计/相似/去重 间切换） -->
      <DatasetViewer ref="viewerRef" />
    </div>

    <!-- 无边框窗口边缘缩放热区（仅桌面端） -->
    <template v-if="isTauri">
      <div class="resize-zone" data-edge="left" @mousedown="onResize('left')"></div>
      <div class="resize-zone" data-edge="right" @mousedown="onResize('right')"></div>
      <div class="resize-zone" data-edge="top" @mousedown="onResize('top')"></div>
      <div class="resize-zone" data-edge="bottom" @mousedown="onResize('bottom')"></div>
      <div class="resize-zone" data-edge="top-left" @mousedown="onResize('top-left')"></div>
      <div class="resize-zone" data-edge="top-right" @mousedown="onResize('top-right')"></div>
      <div class="resize-zone" data-edge="bottom-left" @mousedown="onResize('bottom-left')"></div>
      <div class="resize-zone" data-edge="bottom-right" @mousedown="onResize('bottom-right')"></div>
    </template>

    <!-- 拖拽文件夹到窗口加载数据集（Tauri 拖放 + 浏览器 HTML5 拖放） -->
    <transition name="drop-fade">
      <div v-if="dragOver" class="folder-drop-overlay">
        <div class="folder-drop-inner">
          <el-icon class="folder-drop-icon"><FolderOpened /></el-icon>
          <span>{{ t('app.dropToLoad') }}</span>
        </div>
      </div>
    </transition>
  </el-config-provider>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Monitor, Sunny, Moon, Operation, Minus, FullScreen, CopyDocument, Close, FolderOpened } from '@element-plus/icons-vue'
import DatasetViewer from './components/DatasetViewer.vue'
import { useTheme } from './composables/useTheme'
import { useWindowChrome } from './composables/useWindowChrome'
import { useViewerState } from './composables/useViewerState'
import { useFolderDrop } from './composables/useFolderDrop'
import { SUPPORTED_LOCALES, setLocale, currentLocale, elLocale, type LocaleKey } from './i18n'

type ThemeMode = 'light' | 'dark' | 'system'

const { t } = useI18n()
const { themeMode } = useTheme()
const { isTauri, isMaximized, minimize, toggleMaximize, close, startResize, startDragging } = useWindowChrome()
function onResize(edge: any) {
  startResize(edge)
}
// 标题栏拖拽改用 JS 驱动（避免 -webkit-app-region 与文件拖放冲突导致禁止光标）
function onNavMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  const t = e.target as HTMLElement
  if (t.closest('.nav-right') || t.closest('button') || t.closest('input') || t.closest('select')) return
  startDragging()
}

// 拖拽文件夹到窗口快速加载数据集
const { handleLoadDataset } = useViewerState()
const { dragOver } = useFolderDrop((opts) => handleLoadDataset(opts))
const themeIcon = computed(() => {
  if (themeMode.value === 'dark') return Moon
  if (themeMode.value === 'light') return Sunny
  return Monitor
})
const themeLabel = computed(() => {
  if (themeMode.value === 'dark') return t('app.themeDark')
  if (themeMode.value === 'light') return t('app.themeLight')
  return t('app.themeSystem')
})

const viewerRef = ref<InstanceType<typeof DatasetViewer> | null>(null)
</script>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

.app-nav {
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--text);
}

.nav-logo {
  height: 22px;
  width: 22px;
  object-fit: contain;
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

:deep(.el-dropdown-menu__item.active) {
  color: var(--el-color-primary);
  font-weight: 600;
}

/* 无边框窗口标题栏（拖拽由 JS startDragging 驱动，见 onNavMouseDown） */

/* 窗口控制按钮 */
.window-controls {
  display: flex;
  align-items: center;
  margin-left: 6px;
}
.wc-btn {
  width: 34px;
  height: 30px;
  border: none;
  background: transparent;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 4px;
  font-size: 14px;
}
.wc-btn:hover {
  background: rgba(127, 127, 127, 0.22);
}
.wc-btn.wc-close:hover {
  background: #e81123;
  color: #fff;
}

/* 无边框窗口边缘缩放热区（仅桌面端） */
.resize-zone {
  position: fixed;
  z-index: 2000;
}
.resize-zone[data-edge='top'] { top: 0; left: 0; right: 0; height: 4px; cursor: ns-resize; }
.resize-zone[data-edge='bottom'] { bottom: 0; left: 0; right: 0; height: 4px; cursor: ns-resize; }
.resize-zone[data-edge='left'] { top: 0; bottom: 0; left: 0; width: 4px; cursor: ew-resize; }
.resize-zone[data-edge='right'] { top: 0; bottom: 0; right: 0; width: 4px; cursor: ew-resize; }
.resize-zone[data-edge='top-left'] { top: 0; left: 0; width: 8px; height: 8px; cursor: nwse-resize; }
.resize-zone[data-edge='top-right'] { top: 0; right: 0; width: 8px; height: 8px; cursor: nesw-resize; }
.resize-zone[data-edge='bottom-left'] { bottom: 0; left: 0; width: 8px; height: 8px; cursor: nesw-resize; }
.resize-zone[data-edge='bottom-right'] { bottom: 0; right: 0; width: 8px; height: 8px; cursor: nwse-resize; }

/* 拖拽文件夹加载遮罩（pointer-events:none 不拦截拖放事件） */
.folder-drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(64, 158, 255, 0.08);
  backdrop-filter: blur(1px);
}
.folder-drop-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 40px 64px;
  border: 2px dashed var(--el-color-primary);
  border-radius: 16px;
  color: var(--el-color-primary);
  background: rgba(255, 255, 255, 0.72);
  font-size: 16px;
  font-weight: 600;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}
html.dark .folder-drop-inner {
  background: rgba(28, 32, 40, 0.82);
}
.folder-drop-icon {
  font-size: 52px;
}
.drop-fade-enter-active,
.drop-fade-leave-active {
  transition: opacity 0.15s ease;
}
.drop-fade-enter-from,
.drop-fade-leave-to {
  opacity: 0;
}
</style>
