/**
 * 多语言（i18n）基础设施。
 *
 * - 使用 vue-i18n（Composition API，legacy:false）。
 * - 默认简体中文；语言选择持久化到 localStorage。
 * - 同时导出 ElementPlus 语言包映射，供 <el-config-provider> 同步内置组件文案。
 */
import { createI18n } from 'vue-i18n'
import { computed } from 'vue'
import elZhCn from 'element-plus/es/locale/lang/zh-cn'
import elEn from 'element-plus/es/locale/lang/en'
import type { Language } from 'element-plus/es/locale'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'

export type LocaleKey = 'zh-CN' | 'en-US'

export const SUPPORTED_LOCALES: { value: LocaleKey; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
]

const STORAGE_KEY = 'dv-locale'

function detectDefault(): LocaleKey {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh-CN' || saved === 'en-US') return saved
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN'
  return nav && nav.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN'
}

export const i18n = createI18n({
  legacy: false,
  locale: detectDefault(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
})

/** 切换语言并持久化 */
export function setLocale(locale: LocaleKey): void {
  i18n.global.locale.value = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    /* ignore */
  }
}

/** 当前语言（响应式） */
export const currentLocale = computed<LocaleKey>(() => i18n.global.locale.value as LocaleKey)

const EL_LOCALES: Record<LocaleKey, Language> = {
  'zh-CN': elZhCn,
  'en-US': elEn,
}

/** 与当前语言同步的 ElementPlus 语言包（响应式），供 el-config-provider 使用 */
export const elLocale = computed<Language>(() => EL_LOCALES[currentLocale.value])
