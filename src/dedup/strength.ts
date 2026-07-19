/**
 * 去重强度预设
 * 借鉴 fastdup / ImageAtlas 的多级相似度判定思路：
 *  - strict  : 仅 MD5 完全相同 -> 精确拷贝
 *  - standard: pHash/dHash 极小距离 -> 缩放/压缩/水印/微裁剪的近似重复（默认推荐）
 *  - loose   : 更宽松视觉阈值 -> 风格相近，可能误删，需人工复核
 */
import type { DedupStrength, StrengthPreset } from './types'

export const STRENGTH_PRESETS: Record<DedupStrength, StrengthPreset> = {
  strict: {
    key: 'strict',
    label: 'dedup.strengthStrict',
    description: 'dedup.strengthStrictDesc',
    phashThreshold: 0,
    dhashThreshold: 0,
    useExact: true,
  },
  standard: {
    key: 'standard',
    label: 'dedup.strengthStandard',
    description: 'dedup.strengthStandardDesc',
    phashThreshold: 10,
    dhashThreshold: 12,
    useExact: false,
  },
  loose: {
    key: 'loose',
    label: 'dedup.strengthLoose',
    description: 'dedup.strengthLooseDesc',
    phashThreshold: 18,
    dhashThreshold: 22,
    useExact: false,
  },
}

export const STRENGTH_LIST: StrengthPreset[] = [
  STRENGTH_PRESETS.strict,
  STRENGTH_PRESETS.standard,
  STRENGTH_PRESETS.loose,
]
