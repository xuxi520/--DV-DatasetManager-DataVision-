/**
 * 目录结构 -> 拆分/类别 识别
 * 与加载数据集一样，数据集可能存在多种嵌套/结构形式：
 *   train/images/cat/1.jpg
 *   train/labels/cat/1.txt
 *   images/train/...
 *   data/val/...
 * 通过路径关键字识别 train/val/test，倒数第二级目录作为类别。
 */
import type { SplitKey, SplitMeta } from './types'

const SPLIT_KEYWORDS: Array<{ key: SplitKey; re: RegExp }> = [
  { key: 'train', re: /(^|[/\\])(train|training|trainset)([/\\]|$)/i },
  { key: 'val', re: /(^|[/\\])(val|valid|validation|valset)([/\\]|$)/i },
  { key: 'test', re: /(^|[/\\])(test|testing|testset)([/\\]|$)/i },
]

export function detectSplitAndCategory(relativePath: string): SplitMeta {
  const norm = relativePath.replace(/\\/g, '/')
  let split: SplitKey = 'unknown'
  for (const s of SPLIT_KEYWORDS) {
    if (s.re.test(norm)) {
      split = s.key
      break
    }
  }

  // 类别 = 倒数第二级目录名（若存在且不是 split 本身）
  const parts = norm.split('/').filter(Boolean)
  let category = ''
  if (parts.length >= 2) {
    const candidate = parts[parts.length - 2]
    if (candidate.toLowerCase() !== split) {
      category = candidate
    }
  }

  return { split, category }
}
