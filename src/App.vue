<template>
  <el-config-provider :locale="elLocale">
    <div class="app-container">
      <!-- 顶部导航 -->
      <nav class="app-nav">
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
        </div>
      </nav>

      <!-- 浏览模式（内部用 viewMode 在 预览/统计/相似/去重 间切换） -->
      <DatasetViewer ref="viewerRef" />
    </div>
  </el-config-provider>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Monitor, Sunny, Moon, Operation } from '@element-plus/icons-vue'
import DatasetViewer from './components/DatasetViewer.vue'
import { useTheme } from './composables/useTheme'
import { SUPPORTED_LOCALES, setLocale, currentLocale, elLocale, type LocaleKey } from './i18n'

type ThemeMode = 'light' | 'dark' | 'system'

const { t } = useI18n()
const { themeMode } = useTheme()
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
</style>
