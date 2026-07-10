import { computed, watchEffect } from 'vue'
import { useStorage, usePreferredDark } from '@vueuse/core'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'dm-theme-mode'

// 持久化到 localStorage（默认监听跨标签页变更），刷新后保留用户选择
const themeMode = useStorage<ThemeMode>(STORAGE_KEY, 'system')

const preferredDark = usePreferredDark()

// 是否为深色：dark=强制深色，light=强制浅色，system=跟随系统
const isDark = computed(() => {
  if (themeMode.value === 'dark') return true
  if (themeMode.value === 'light') return false
  return preferredDark.value
})

// 同步到 <html> 的 dark/light class（Element Plus 深色变量依赖 .dark）
watchEffect(() => {
  const el = document.documentElement
  el.classList.toggle('dark', isDark.value)
  el.classList.toggle('light', !isDark.value)
})

export function useTheme() {
  return { themeMode, isDark }
}
