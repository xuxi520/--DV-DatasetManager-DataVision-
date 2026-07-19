/**
 * useActiveLearning —— 主动学习（导入模型输出 / 定位低置信·难样本）单例。
 * 收敛预测覆盖层的内存态与评分动作，供 ActiveLearningView 使用。
 * 预测覆盖层可持久化：导入后写入数据集根侧车（Tauri）与 IndexedDB（双端），
 * 跨会话重开数据集可恢复，支撑「导入→复核→导出难样本→标注」的 AL 闭环。
 */
import { ref } from 'vue'
import type { CanonicalDataset } from '../dataset/types'
import type { CanonicalAnnotation } from '../dataset/types'
import type { DataSet } from '../types'
import {
  scorePredictions,
  type ActiveLearningScore,
  type PredictionSet,
  type ScoreOptions,
  type ReviewStatus,
  type AlPersistedState,
} from './types'
import {
  serializeAlState,
  deserializeAlState,
  saveAlState,
  loadAlState,
  clearAlState,
} from './persistence'

function createActiveState() {
  /** datasetId -> 该数据集最近一次导入的模型输出 */
  const predictionSets = ref<Map<string, PredictionSet>>(new Map())

  /** datasetId -> (sampleId -> 复核状态)。独立持久化，不污染真值标注 */
  const reviewStatus = ref<Map<string, Map<string, ReviewStatus>>>(new Map())

  /** 低置信阈值（confMin < 此值标记低置信） */
  const confThreshold = ref(0.5)
  /** 难样本阈值（hardScore >= 此值标记难） */
  const hardThreshold = ref(0.6)

  function setPredictions(datasetId: string, set: PredictionSet): void {
    set.datasetId = datasetId
    const next = new Map(predictionSets.value)
    next.set(datasetId, set)
    predictionSets.value = next
  }

  function getPredictions(datasetId: string): PredictionSet | undefined {
    return predictionSets.value.get(datasetId)
  }

  /**
   * 取某数据集某样本（sampleId）的预测项，供画布叠加渲染。
   * PredictionSet 以模型图片键（imagePath）为索引，内部携带 sampleId，
   * 故需遍历匹配；找不到则返回 undefined。
   */
  function getPredictionItems(datasetId: string, sampleId: string): CanonicalAnnotation[] | undefined {
    const set = predictionSets.value.get(datasetId)
    if (!set) return undefined
    for (const pred of set.predictions.values()) {
      if (pred.sampleId === sampleId) return pred.items
    }
    return undefined
  }

  /** 该数据集是否已导入预测覆盖层 */
  function hasPredictions(datasetId: string): boolean {
    return (predictionSets.value.get(datasetId)?.predictions.size ?? 0) > 0
  }

  function clear(datasetId: string): void {
    const next = new Map(predictionSets.value)
    next.delete(datasetId)
    predictionSets.value = next
    // 同时清除该数据集的复核状态（内存）
    const rs = new Map(reviewStatus.value)
    rs.delete(datasetId)
    reviewStatus.value = rs
  }

  /** 取某样本复核状态（默认 pending） */
  function getReviewStatus(datasetId: string, sampleId: string): ReviewStatus {
    return reviewStatus.value.get(datasetId)?.get(sampleId) ?? 'pending'
  }

  /** 设置某样本复核状态（内存，需调用 persist 落盘） */
  function setReviewStatus(datasetId: string, sampleId: string, status: ReviewStatus): void {
    const next = new Map(reviewStatus.value)
    const cur = new Map(next.get(datasetId) ?? [])
    cur.set(sampleId, status)
    next.set(datasetId, cur)
    reviewStatus.value = next
  }

  /** 把一批样本标记为已导出为难样本队列（内存，需调用 persist 落盘） */
  function markExported(datasetId: string, sampleIds: string[]): void {
    if (!sampleIds.length) return
    const next = new Map(reviewStatus.value)
    const cur = new Map(next.get(datasetId) ?? [])
    for (const id of sampleIds) cur.set(id, 'exported')
    next.set(datasetId, cur)
    reviewStatus.value = next
  }

  /**
   * 持久化当前数据集的预测覆盖层：有预测则写盘，无预测则清除持久化，
   * 避免下次打开读到陈旧数据。
   */
  async function persist(dataset: DataSet): Promise<void> {
    const datasetId = dataset.id
    const set = predictionSets.value.get(datasetId)
    if (!set || set.predictions.size === 0) {
      await clearPersisted(dataset)
      return
    }
    const rs = reviewStatus.value.get(datasetId) ?? new Map<string, ReviewStatus>()
    const state: AlPersistedState = serializeAlState(set, dataset, rs, {
      confThreshold: confThreshold.value,
      hardThreshold: hardThreshold.value,
    })
    await saveAlState(dataset, state)
  }

  /**
   * 恢复当前数据集的持久化预测覆盖层（仅当本次会话尚未加载该数据集时），
   * 使 AL 闭环可跨会话。返回是否真正恢复到了非空预测。
   */
  async function loadPersisted(dataset: DataSet): Promise<boolean> {
    const datasetId = dataset.id
    if (predictionSets.value.has(datasetId)) return false
    let state: AlPersistedState | null = null
    try {
      state = await loadAlState(dataset)
    } catch {
      state = null
    }
    if (!state) return false
    const { set, reviewStatus: rs, confThreshold: ct, hardThreshold: ht } =
      deserializeAlState(state)
    if (set.predictions.size === 0) return false
    setPredictions(datasetId, set)
    if (rs.size) {
      const next = new Map(reviewStatus.value)
      next.set(datasetId, rs)
      reviewStatus.value = next
    }
    confThreshold.value = ct
    hardThreshold.value = ht
    return true
  }

  /** 清除持久化（清空预测覆盖层时调用） */
  async function clearPersisted(dataset: DataSet): Promise<void> {
    try {
      await clearAlState(dataset)
    } catch {
      /* noop */
    }
  }

  /** 对一份预测集合评分（可选结合嵌入离群度） */
  function score(
    set: PredictionSet,
    ds: CanonicalDataset,
    opts?: { outlierScores?: Map<string, number> },
  ): ActiveLearningScore[] {
    const o: ScoreOptions = {
      confThreshold: confThreshold.value,
      hardThreshold: hardThreshold.value,
      outlierScores: opts?.outlierScores,
    }
    return scorePredictions(set, ds, o)
  }

  return {
    predictionSets,
    reviewStatus,
    confThreshold,
    hardThreshold,
    setPredictions,
    getPredictions,
    getPredictionItems,
    getReviewStatus,
    setReviewStatus,
    markExported,
    hasPredictions,
    clear,
    persist,
    loadPersisted,
    clearPersisted,
    score,
  }
}

let _state: ReturnType<typeof createActiveState> | null = null

export function useActiveLearning() {
  if (!_state) _state = createActiveState()
  return _state
}
