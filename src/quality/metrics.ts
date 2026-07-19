/**
 * 质量指标纯函数（无 DOM、可单测）
 * 输入均为解码后的 RGBA 像素（Uint8ClampedArray，长度 = w*h*4）。
 * 模糊/亮度/单色对分辨率不敏感，调用方应在降采样后传入以降低成本。
 */

import type { QualityOptions, QualityResult } from './types'

/** 平均亮度（0-255），基于 Rec.601 灰度权重 */
export function computeBrightness(data: Uint8ClampedArray): number {
  const n = data.length / 4
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  return sum / n
}

/**
 * 拉普拉斯方差（模糊度核心指标）。
 * 对灰度图做 3x3 拉普拉斯卷积，再求方差；方差越低越模糊。
 * 必须在固定降采样尺度下计算，阈值才稳定（见 QualityOptions.blurThreshold）。
 */
export function computeLaplacianVariance(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): number {
  if (w < 3 || h < 3) return 0
  const gray = new Float32Array(w * h)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]
      sum += v
      sumSq += v * v
      count++
    }
  }
  if (count === 0) return 0
  const mean = sum / count
  return sumSq / count - mean * mean
}

/** 平均饱和度（0-100，基于 RGB 极差近似 HSV 饱和度） */
export function computeAvgSaturation(data: Uint8ClampedArray): number {
  const n = data.length / 4
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    sum += max === 0 ? 0 : (max - min) / max
  }
  return (sum / n) * 100
}

/** 综合质量评分：从 100 起按问题加权扣分，下限 0 */
export function computeOverallScore(opts: {
  blurScore: number
  isDark: boolean
  isBright: boolean
  isLowRes: boolean
  isMonochrome: boolean
  blurThreshold: number
}): number {
  let score = 100
  if (opts.blurScore < opts.blurThreshold) {
    const ratio = Math.max(0, Math.min(1, opts.blurScore / opts.blurThreshold))
    score -= 40 * (1 - ratio) // 模糊最多扣 40
  }
  if (opts.isDark) score -= 15
  if (opts.isBright) score -= 15
  if (opts.isLowRes) score -= 20
  if (opts.isMonochrome) score -= 10
  return Math.max(0, Math.min(100, Math.round(score)))
}

/**
 * 汇总为 QualityResult（含阈值判定与综合分）。
 * @param origW 原始图片宽（用于低分辨率判定，不受降采样影响）
 * @param origH 原始图片高
 */
export function buildQualityResult(
  fileId: string,
  blurScore: number,
  brightness: number,
  avgSaturation: number,
  origW: number,
  origH: number,
  options: QualityOptions,
): QualityResult {
  const blurThreshold = options.blurThreshold ?? 80
  const darkThreshold = options.darkThreshold ?? 40
  const brightThreshold = options.brightThreshold ?? 220
  const minResolution = options.minResolution ?? 32
  const monoSat = options.monochromeSaturation ?? 8

  const isDark = brightness < darkThreshold
  const isBright = brightness > brightThreshold
  const isLowRes = Math.min(origW, origH) < minResolution
  const isMonochrome = avgSaturation < monoSat
  const overallScore = computeOverallScore({
    blurScore,
    isDark,
    isBright,
    isLowRes,
    isMonochrome,
    blurThreshold,
  })

  return {
    fileId,
    blurScore,
    brightness,
    isDark,
    isBright,
    isLowRes,
    isMonochrome,
    overallScore,
  }
}
