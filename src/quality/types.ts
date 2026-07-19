/**
 * 质量检查模块类型定义
 * 对应 API_CONTRACT.md 预留的 IQualityChecker 接口。
 */

/** 质量检查阈值与采样参数（可在设置面板调整） */
export interface QualityOptions {
  /** 解码降采样的最大边长（质量指标对分辨率不敏感，缩到该值即可，默认 128） */
  maxEdge?: number
  /** 模糊判定阈值：拉普拉斯方差越低越模糊，默认 80（在 128px 降采样尺度下标定） */
  blurThreshold?: number
  /** 暗图平均亮度上限（0-255），默认 40 */
  darkThreshold?: number
  /** 亮图平均亮度下限（0-255），默认 220 */
  brightThreshold?: number
  /** 最小分辨率：宽或高低于此值判为低分辨率，默认 32 */
  minResolution?: number
  /** 单色判定：平均饱和度（0-100）低于此值视为近似灰度图，默认 8 */
  monochromeSaturation?: number
}

/** 单图质量结果 */
export interface QualityResult {
  fileId: string
  /** 拉普拉斯方差（越大越清晰） */
  blurScore: number
  /** 平均亮度 0-255 */
  brightness: number
  isDark: boolean
  isBright: boolean
  isLowRes: boolean
  isMonochrome: boolean
  /** 综合质量评分 0-100（越高越好） */
  overallScore: number
}

/** 质量问题的分类标签 */
export type QualityIssue = 'blur' | 'dark' | 'bright' | 'lowRes' | 'monochrome'

/** 质量统计聚合（用于统计页图表） */
export interface QualityStats {
  /** 已检查图片数（= results.size） */
  total: number
  checked: number
  blur: number
  dark: number
  bright: number
  lowRes: number
  monochrome: number
  /** 平均分（0-100） */
  avgScore: number
  /** 综合分分布（用于柱状图） */
  scoreBuckets: { range: string; count: number }[]
}

/** 默认阈值（与 API_CONTRACT.md / 设置面板初始值保持一致） */
export const DEFAULT_QUALITY_OPTIONS: Required<QualityOptions> = {
  maxEdge: 128,
  blurThreshold: 80,
  darkThreshold: 40,
  brightThreshold: 220,
  minResolution: 32,
  monochromeSaturation: 8,
}
