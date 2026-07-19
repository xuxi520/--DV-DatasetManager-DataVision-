/**
 * 运行环境能力清单（集中式）
 *
 * 应用同时支持「桌面端（Tauri）」与「浏览器端」。两者能力不对等：
 * - 桌面端可把编辑直接写回原标注文件、用系统对话框选目录；
 * - 浏览器端无法写回磁盘，只能把编辑打包成 ZIP 下载；目录选择依赖
 *   File System Access API（仅 Chromium 系浏览器可用）。
 *
 * 本文件把「浏览器无法实现」的能力集中声明，供各组件做 UI 隔离（隐藏/禁用/改文案），
 * 避免把不可用的功能原样暴露给用户（如「写回原文件」按钮在浏览器端误导）。
 */
import type { EnvType } from './types'
import { env } from './env'

/** 浏览器是否支持 File System Access API（'showDirectoryPicker'），仅 Chromium 系为 true */
export const canPickDirectory =
  typeof window !== 'undefined' && 'showDirectoryPicker' in window

export interface Capabilities {
  /** 运行环境：'tauri' | 'browser' */
  env: EnvType
  /** 能否直接写回原标注文件（桌面端 true；浏览器只能 ZIP 下载） */
  canWriteFiles: boolean
  /** 编辑能否持久化到原始数据集（桌面端 true；浏览器仅能导出 ZIP） */
  canPersistEdits: boolean
  /** 能否用系统文件夹选择器加载数据集（浏览器需 Chromium） */
  canPickDirectory: boolean
  /** 能否导出（两端均可，均经 ZIP） */
  canExport: boolean
}

export const capabilities: Capabilities = {
  env,
  canWriteFiles: env === 'tauri',
  canPersistEdits: env === 'tauri',
  canPickDirectory,
  canExport: true,
}
