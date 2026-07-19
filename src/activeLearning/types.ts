/**
 * 主动学习钩子公共类型（导入模型输出，定位低置信/难样本）
 *
 * 设计要点：
 *  - 模型预测（Predictions）作为「覆盖层」独立存储，绝不覆盖 Ground-Truth 标注
 *    （CanonicalSample.annotations），导入时只读取、不回写 annotations。
 *  - 每个预测样本对齐回数据集的 CanonicalSample（经 sampleId），以便后续结合
 *    嵌入离群度、导出待标注清单时解析回文件名/路径。
 */

import type { CanonicalAnnotation, CanonicalDataset } from '../dataset/types'

/** 单条预测（继承规范标注结构，带 confidence） */
export type PredictionItem = CanonicalAnnotation

/** 单张图的预测结果 */
export interface PredictionSample {
  /** 模型输出 JSON 中的图片键（相对路径或文件名） */
  imagePath: string
  /** 对齐回的 CanonicalSample.id（对齐失败时为空） */
  sampleId: string
  /** 检测框 / 分割等预测（classId 已映射到数据集类别） */
  items: PredictionItem[]
  /** 分类概率向量（可选），顺序对齐 dataset.classes */
  classProbs?: number[]
}

/** 一个数据集的一次模型输出（一个模型跑一遍得到一份） */
export interface PredictionSet {
  datasetId: string
  /** 来源标识（模型名 / 文件名 / 备注），展示用 */
  sourceName: string
  /** 键 = 模型输出 JSON 的图片键；值 = 该图预测 */
  predictions: Map<string, PredictionSample>
  /** classProbs 的顺序（类别名），用于解释概率向量 */
  classOrder: string[]
  /** bbox 归一化假设（解析时记录，便于 UI 提示） */
  bboxFormat: 'yolo' | 'coco' | 'tl_norm' | 'tl_px' | 'auto'
  importedAt: number
}

/** 单张图的主动学习打分（供排序 / 筛选 / 导出） */
export interface ActiveLearningScore {
  sampleId: string
  imagePath: string
  /** 最小 / 均值 / 最大 置信度（无可用置信度时为空） */
  confMin: number | null
  confMean: number | null
  confMax: number | null
  /** 综合难度分 [0,1]，越大越「难」（低置信 + 嵌入离群） */
  hardScore: number
  /** 是否低置信（confMin < 阈值） */
  lowConfidence: boolean
  /** 是否难样本（hardScore >= 阈值） */
  hard: boolean
}

/** 评分选项 */
export interface ScoreOptions {
  /** 低置信阈值（confMin < 此值即标记低置信） */
  confThreshold: number
  /** 难样本阈值（hardScore >= 此值即标记难） */
  hardThreshold: number
  /** 样本 id -> 嵌入离群度（越大越孤立/OOD）。可选，提供则纳入 hardScore */
  outlierScores?: Map<string, number>
}

/** bbox 格式提示（解析时通过 JSON 顶层 bbox_format 指定，缺省 auto 推断） */
export type BboxFormat = PredictionSet['bboxFormat']

/** 把 PredictionSet 投影成可排序的打分列表 */
export function scorePredictions(
  set: PredictionSet,
  ds: CanonicalDataset,
  opts: ScoreOptions,
): ActiveLearningScore[] {
  const idToSample = new Map(ds.samples.map((s) => [s.id, s]))

  // 嵌入离群度归一化（0..1），无则记为 0
  const outlierVals = opts.outlierScores ? [...opts.outlierScores.values()] : []
  const maxOutlier = outlierVals.length ? Math.max(...outlierVals, 1e-6) : 1

  const out: ActiveLearningScore[] = []
  for (const pred of set.predictions.values()) {
    const sample = idToSample.get(pred.sampleId)
    const imagePath = pred.imagePath || sample?.sourcePath || pred.sampleId

    // 置信度来源：检测框 confidence > 分类概率最大值
    const confs: number[] = []
    for (const it of pred.items) {
      if (typeof it.confidence === 'number') confs.push(it.confidence)
    }
    if (confs.length === 0 && pred.classProbs?.length) {
      confs.push(Math.max(...pred.classProbs))
    }

    const confMin = confs.length ? Math.min(...confs) : null
    const confMean = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null
    const confMax = confs.length ? Math.max(...confs) : null

    const confPart = confMean != null ? 1 - confMean : 0.5
    const oRaw = pred.sampleId ? opts.outlierScores?.get(pred.sampleId) ?? 0 : 0
    const outlierPart = maxOutlier > 0 ? oRaw / maxOutlier : 0
    // 有嵌入离群度时加权融合，否则纯看置信度
    const hardScore = opts.outlierScores
      ? Math.max(0, Math.min(1, 0.6 * confPart + 0.4 * outlierPart))
      : Math.max(0, Math.min(1, confPart))

    out.push({
      sampleId: pred.sampleId,
      imagePath,
      confMin,
      confMean,
      confMax,
      hardScore,
      lowConfidence: confMin != null && confMin < opts.confThreshold,
      hard: hardScore >= opts.hardThreshold,
    })
  }
  return out
}

/**
 * 单样本复核状态（AL 闭环的工作流标记，**独立于真值标注**）。
 * 仅用于记录用户对预测样本的处理进度，随预测覆盖层一起持久化到数据集根，
 * 使「导入→复核→导出难样本→标注→重开数据集」可跨会话闭环。
 */
export type ReviewStatus =
  | 'pending' // 待复核（默认）
  | 'reviewed' // 已查看
  | 'accepted' // 预测正确，无需修改
  | 'rejected' // 预测错误
  | 'labeled' // 已补/改真值标注
  | 'exported' // 已导出为难样本队列

/** 持久化到磁盘（Tauri 数据集根侧车）或 IndexedDB 的主动学习状态快照 */
export interface AlPersistedState {
  schemaVersion: number
  datasetId: string
  datasetName: string
  sourceName: string
  importedAt: number
  confThreshold: number
  hardThreshold: number
  bboxFormat: BboxFormat
  classOrder: string[]
  /** PredictionSet.predictions（Map）序列化后的数组 */
  predictions: PredictionSample[]
  /** sampleId -> 复核状态 */
  reviewStatus: Record<string, ReviewStatus>
  /** 最近一次导出难样本队列的时间戳 */
  lastExportedAt?: number
  /** 最近一次导出包含的 sampleId 列表 */
  exportedSampleIds?: string[]
}
