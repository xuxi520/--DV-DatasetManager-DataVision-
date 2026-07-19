import { env } from '../env'
import type { DataSet } from '../types'
import { normSlash } from '../dataset/importers/shared'
import { datasetKeyOf } from '../dataset/versionStore'
import { putAlState, getAlState, deleteAlState } from '../cache/idbCache'
import { downloadJSON } from '../dedup/report'
import type {
  PredictionSet,
  PredictionSample,
  BboxFormat,
  ReviewStatus,
  AlPersistedState,
} from './types'

/** 持久化 schema 版本，结构变动时 +1 并与旧版本不兼容读取 */
export const AL_SCHEMA_VERSION = 1

/** 数据集根下的侧车相对路径（Tauri 端落盘处；隐藏 .dv 目录与版本清单同构） */
export const AL_SIDECAR_REL = '.dv/al_predictions.json'

/** 把内存态 PredictionSet 序列化为可落盘快照 */
export function serializeAlState(
  set: PredictionSet,
  ds: DataSet,
  reviewStatus: Map<string, ReviewStatus>,
  params: {
    confThreshold: number
    hardThreshold: number
    lastExportedAt?: number
    exportedSampleIds?: string[]
  },
): AlPersistedState {
  const rs: Record<string, ReviewStatus> = {}
  for (const [k, v] of reviewStatus) rs[k] = v
  return {
    schemaVersion: AL_SCHEMA_VERSION,
    datasetId: set.datasetId || ds.id,
    datasetName: ds.name,
    sourceName: set.sourceName,
    importedAt: set.importedAt,
    confThreshold: params.confThreshold,
    hardThreshold: params.hardThreshold,
    bboxFormat: set.bboxFormat,
    classOrder: set.classOrder,
    predictions: [...set.predictions.values()],
    reviewStatus: rs,
    lastExportedAt: params.lastExportedAt,
    exportedSampleIds: params.exportedSampleIds,
  }
}

/** 把落盘快照反序列化为内存态（PredictionSet + 复核状态 + 阈值） */
export function deserializeAlState(data: AlPersistedState): {
  set: PredictionSet
  reviewStatus: Map<string, ReviewStatus>
  confThreshold: number
  hardThreshold: number
} {
  const predictions = new Map<string, PredictionSample>()
  for (const s of data.predictions ?? []) predictions.set(s.imagePath, s)
  const set: PredictionSet = {
    datasetId: data.datasetId,
    sourceName: data.sourceName,
    predictions,
    classOrder: data.classOrder ?? [],
    bboxFormat: (data.bboxFormat ?? 'auto') as BboxFormat,
    importedAt: data.importedAt ?? Date.now(),
  }
  const reviewStatus = new Map<string, ReviewStatus>()
  for (const [k, v] of Object.entries(data.reviewStatus ?? {})) {
    reviewStatus.set(k, v as ReviewStatus)
  }
  return {
    set,
    reviewStatus,
    confThreshold: data.confThreshold ?? 0.5,
    hardThreshold: data.hardThreshold ?? 0.6,
  }
}

/** 侧车文件绝对路径（仅 Tauri 且数据集有根路径时有效） */
function sidecarAbs(ds: DataSet): string | null {
  if (env !== 'tauri' || !ds.rootAbsPath) return null
  return normSlash(ds.rootAbsPath) + '/' + AL_SIDECAR_REL
}

/**
 * 持久化主动学习状态：
 * - 双端：写入 IndexedDB（key = datasetKeyOf(ds)），浏览器端唯一来源。
 * - Tauri：额外落盘到数据集根侧车 `.dv/al_predictions.json`，使状态随数据集迁移、跨会话可恢复。
 */
export async function saveAlState(ds: DataSet, state: AlPersistedState): Promise<void> {
  const key = datasetKeyOf(ds)
  try {
    await putAlState(key, state)
  } catch {
    /* IDB 不可用时降级为仅 Tauri 侧车 */
  }
  const abs = sidecarAbs(ds)
  if (abs) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('write_text_file', { path: abs, content: JSON.stringify(state) })
    } catch {
      /* 侧车写入失败不阻塞主流程 */
    }
  }
}

/**
 * 读取主动学习状态：
 * - Tauri：优先读数据集根侧车（随数据集迁移的最新来源），回退 IDB。
 * - 浏览器：只读 IDB。
 * 返回 null 表示无持久化状态。
 */
export async function loadAlState(ds: DataSet): Promise<AlPersistedState | null> {
  const abs = sidecarAbs(ds)
  if (abs) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const text = await invoke<string>('read_file_text', { path: abs })
      const data = JSON.parse(text) as AlPersistedState
      if (data && data.schemaVersion === AL_SCHEMA_VERSION) return data
    } catch {
      /* 侧车缺失/损坏，回退 IDB */
    }
  }
  try {
    const rec = (await getAlState(datasetKeyOf(ds))) as AlPersistedState | undefined
    if (rec && rec.schemaVersion === AL_SCHEMA_VERSION) return rec
  } catch {
    /* IDB 不可用时返回 null */
  }
  return null
}

/** 清除持久化状态（清空预测覆盖层时调用） */
export async function clearAlState(ds: DataSet): Promise<void> {
  try {
    await deleteAlState(datasetKeyOf(ds))
  } catch {
    /* noop */
  }
  const abs = sidecarAbs(ds)
  if (abs) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('write_text_file', { path: abs, content: JSON.stringify(emptyAlState(ds)) })
    } catch {
      /* noop */
    }
  }
}

/** 生成一个「空」快照（用于 clear 时覆盖侧车，避免下次打开读到陈旧数据） */
function emptyAlState(ds: DataSet): AlPersistedState {
  return {
    schemaVersion: AL_SCHEMA_VERSION,
    datasetId: ds.id,
    datasetName: ds.name,
    sourceName: '',
    importedAt: Date.now(),
    confThreshold: 0.5,
    hardThreshold: 0.6,
    bboxFormat: 'auto',
    classOrder: [],
    predictions: [],
    reviewStatus: {},
  }
}

/**
 * 浏览器端：把状态快照下载为本地文件（与 Tauri 侧车同构，便于在浏览器间/冷备份迁移）。
 * Tauri 端侧车已落盘数据集根，无需此下载。
 */
export function downloadAlState(state: AlPersistedState): void {
  downloadJSON(`al_predictions_${state.datasetName || 'dataset'}.json`, state)
}
