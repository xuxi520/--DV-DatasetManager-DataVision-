/**
 * 工作区结构配置（多数据集持久化）
 *
 * 把「当前加载了哪些数据集、它们的来源结构（Tauri 绝对路径 / 浏览器目录句柄）、
 * 各窗格绑定、视图与显示设置」序列化为一份 WorkspaceConfig，存进 IndexedDB
 * （dataset-manager-cache / workspace），使应用重启后可通过「恢复工作区」一键还原
 * 多数据集结构，无需重新逐个选择目录。
 *
 * - Tauri：数据集以根目录绝对路径（imageRoot / labelRoot）标识，恢复时重新扫描目录重建。
 * - 浏览器：目录句柄（FileSystemDirectoryHandle）可结构化克隆直接存入 IDB（handles 表），
 *   恢复时需重新申请读权限（handle.requestPermission）；config 仅存句柄的 key。
 *
 * 该模块只负责「配置的形态与底层读写」，数据集的实际重建（重扫描 / 重导入）由
 * useViewerState 调用 loadCanonical 的 reload* 函数完成。
 */

import type { CanonicalDataset } from '../dataset/types'

/** 浏览器端持久化的目录句柄（结构化克隆可存 IDB） */
export interface PersistedHandles {
  id: string
  imageHandle: FileSystemDirectoryHandle
  labelHandle: FileSystemDirectoryHandle | null
}

/** 单个数据集的持久化条目（JSON 可序列化，句柄以 handleKey 引用） */
export interface WsDataset {
  /** 保存时的数据集 id（恢复时映射为新的运行时 id） */
  id: string
  name: string
  env: 'tauri' | 'browser'
  /** 识别格式覆盖：'' = 自动识别；其余为纠错后指定的格式 */
  sourceFormat: CanonicalDataset['sourceFormat'] | ''
  /** Tauri：图片根绝对路径 */
  imageRoot?: string
  /** Tauri：分目录加载时的标注根绝对路径 */
  labelRoot?: string
  /** 浏览器：目录句柄在 handles 表的 key */
  handleKey?: string
}

/** 窗格绑定（paneId -> 数据集 id + 当前选中文件名，用于恢复时还原标注面板） */
export interface WsPane {
  id: string
  datasetId: string
  /** 恢复时重新选中该文件，使标注面板随界面一并还原（按文件名匹配，id 会变化） */
  selectedFile?: string | null
}

/** 显示设置（跨窗格共享） */
export interface WsDisplay {
  showAnnotations: boolean
  showAnnotationLabels: boolean
  showConfidence: boolean
  autoFit: boolean
  showImageInfo: boolean
  showAnnotationList: boolean
}

/** 完整工作区结构配置 */
export interface WorkspaceConfig {
  schemaVersion: number
  datasets: WsDataset[]
  panes: WsPane[]
  activePane: string
  viewMode: 'single' | 'stats' | 'similarity' | 'dedup' | 'active'
  headerCollapsed: boolean
  sidebarCollapsed: boolean
  filePanelCollapsed: boolean
  annotationPanelCollapsed: boolean
  syncByFilename: boolean
  display: WsDisplay
}

export const WORKSPACE_SCHEMA_VERSION = 1

/** 运行时记录某数据集的来源元信息（不持久化到 config；浏览器句柄存 handles 表） */
export interface DatasetMeta {
  sourceFormat: CanonicalDataset['sourceFormat'] | ''
  imageRoot?: string
  labelRoot?: string
  handleKey?: string
  /** 浏览器端在内存中持有句柄引用，避免每次保存都重新取 */
  imageHandle?: FileSystemDirectoryHandle | null
  labelHandle?: FileSystemDirectoryHandle | null
}
