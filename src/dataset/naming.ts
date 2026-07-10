/**
 * 导出文件命名 + 主类别推断
 * 统一命名策略，避免原始目录的命名混乱（空格/大小写/中文）污染导出结果。
 */

import type { CanonicalSample, ClassDef } from './types'

export type NamingPolicy = 'class_seq' | 'hash' | 'seq' | 'preserve'

/** 清洗为安全文件名片段：小写、非字母数字替换为 _ */
export function sanitizeName(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'img'
  )
}

function baseNoExt(p: string): string {
  const f = p.split('/').pop() || p
  const i = f.lastIndexOf('.')
  return i > 0 ? f.slice(0, i) : f
}

/** 短哈希（djb2），用于稳定且唯一的文件名 */
function hash8(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0').slice(0, 8)
}

/** 推断样本的主类别 id（用于分层与命名） */
export function primaryClassId(sample: CanonicalSample, classes: ClassDef[]): number {
  if (sample.annotations.length > 0) return sample.annotations[0].classId
  if (sample.category) {
    const k = sanitizeName(sample.category)
    const c = classes.find(
      (x) => sanitizeName(x.name) === k || (x.aliases || []).some((a) => sanitizeName(a) === k)
    )
    if (c) return c.id
  }
  return -1
}

export interface Namer {
  next(sample: CanonicalSample, className: string): string
}

/** 生成一个命名器，保证数据集内文件名唯一 */
export function makeNamer(policy: NamingPolicy): Namer {
  const used = new Set<string>()
  let seq = 0

  function next(sample: CanonicalSample, className: string): string {
    let base: string
    switch (policy) {
      case 'class_seq':
        base = `${sanitizeName(className || 'img')}_${String(++seq).padStart(6, '0')}`
        break
      case 'hash':
        base = `${hash8(sample.id)}_${String(++seq).padStart(4, '0')}`
        break
      case 'seq':
        base = `img_${String(++seq).padStart(6, '0')}`
        break
      case 'preserve':
        base = sanitizeName(baseNoExt(sample.sourcePath))
        break
    }
    let cand = base
    let i = 1
    while (used.has(cand)) cand = `${base}_${i++}`
    used.add(cand)
    return cand
  }

  return { next }
}
