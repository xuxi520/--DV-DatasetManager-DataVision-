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
    label: '严格（精确去重）',
    description: '仅 MD5 完全相同的文件判定为重复，毫发无损。适合清理完全相同的拷贝。',
    phashThreshold: 0,
    dhashThreshold: 0,
    useExact: true,
  },
  standard: {
    key: 'standard',
    label: '标准（近似去重）',
    description: 'pHash/dHash 汉明距离极小（缩放、压缩、水印、轻微裁剪）判为重复。推荐默认。',
    phashThreshold: 10,
    dhashThreshold: 12,
    useExact: false,
  },
  loose: {
    key: 'loose',
    label: '宽松（模糊去重）',
    description: '更宽松的视觉相似度阈值，可捕获风格相近的图，但可能出现误删，请人工复核。',
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
