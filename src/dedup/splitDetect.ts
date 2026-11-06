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

// 各 split 的常见目录名（含带年份后缀、下划线变体），大小写不敏感
const SPLIT_KEYWORDS: Array<{ key: SplitKey; re: RegExp }> = [
  { key: 'train', re: /(^|[/\\])(train|trains?et|training|train\d*)([/\\]|$)/i },
  { key: 'val', re: /(^|[/\\])(val|valid|validation|valset|val\d*)([/\\]|$)/i },
  { key: 'test', re: /(^|[/\\])(test|testset|testing|test\d*)([/\\]|$)/i },
]

// 推断类别时应跳过的通用目录名（图/标注/掩码等容器，而非类别本身）
const GENERIC_DIRS = new Set([
  'images', 'image', 'imgs', 'img',
  'labels', 'label', 'annotations', 'annotation', 'ann',
  'masks', 'mask', 'seg', 'segmentation', 'segs',
  'groundtruth', 'gt', 'data', 'dataset', 'datasets',
])

export function detectSplitAndCategory(relativePath: string): SplitMeta {
  const norm = relativePath.replace(/\\/g, '/')
  let split: SplitKey = 'unknown'
  for (const s of SPLIT_KEYWORDS) {
    if (s.re.test(norm)) {
      split = s.key
      break
    }
  }

  // 类别 = 距文件名最近的一个「非 split、非通用目录」的祖先目录名。
  // 从倒数第二级向上回溯，跳过 images/labels/data 等容器目录，
  // 以兼容「图与标注混层 / 缺 data.yaml」的非标准结构（已知问题 #8）。
  const parts = norm.split('/').filter(Boolean)
  let category = ''
  for (let i = parts.length - 2; i >= 0; i--) {
    const cand = parts[i]
    const lower = cand.toLowerCase()
    if (lower === split) continue
    if (GENERIC_DIRS.has(lower)) continue
    category = cand
    break
  }

  return { split, category }
}
