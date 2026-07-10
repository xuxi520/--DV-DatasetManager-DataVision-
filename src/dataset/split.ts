/**
 * 数据集重新划分（重划分 / re-split）
 *
 * 设计参考 FiftyOne random_split / sklearn StratifiedShuffleSplit：
 *  - 默认按「主类别」分层抽样，保证每个子集的类分布与整体一致；
 *  - 可锁定 test（held-out 不被动），仅对 train/val 重新按比例分配；
 *  - 用最大余数法让各子集总数精确贴合目标比例；
 *  - 种子化随机，结果可复现。
 *
 * 与去重解耦：本函数只改 sample.split；删除/去重是另一阶段（Phase 3）。
 */

import type { CanonicalDataset, SplitKey } from './types'
import { primaryClassId } from './naming'

export interface SplitTargets {
  train: number
  val: number
  test: number
}

export interface ReSplitOptions {
  /** 按主类别分层（默认 true） */
  stratifyByClass?: boolean
  /** 锁定当前 test 不动，仅重划 train/val（默认 false） */
  lockTest?: boolean
  /** 随机种子（默认 1） */
  seed?: number
}

/** mulberry32 种子化随机 */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 按目标比例把 total 拆成整数份（和=total），最大余数法 */
function allocateCounts(ratios: number[], total: number): number[] {
  const sum = ratios.reduce((a, b) => a + b, 0) || 1
  const norm = ratios.map((r) => r / sum)
  const raw = norm.map((r) => r * total)
  const floor = raw.map(Math.floor)
  const used = floor.reduce((a, b) => a + b, 0)
  const rem = total - used
  const order = raw
    .map((v, i) => ({ i, f: v - floor[i] }))
    .sort((a, b) => b.f - a.f)
  const counts = floor.slice()
  for (let k = 0; k < rem; k++) counts[order[k % order.length].i]++
  return counts
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const SPLIT_ORDER: SplitKey[] = ['train', 'val', 'test']

/**
 * 对数据集重新划分。直接修改 sample.split，返回被改变的样本数。
 */
export function rebalanceSplits(
  ds: CanonicalDataset,
  targets: SplitTargets,
  opts: ReSplitOptions = {}
): number {
  const stratify = opts.stratifyByClass !== false
  const lockTest = opts.lockTest === true
  const rng = mulberry32(opts.seed ?? 1)

  // 1) 按分层键分组
  const groups = new Map<string, number[]>()
  ds.samples.forEach((s, idx) => {
    const key = stratify ? `c${primaryClassId(s, ds.classes)}` : '__all__'
    let arr = groups.get(key)
    if (!arr) {
      arr = []
      groups.set(key, arr)
    }
    arr.push(idx)
  })

  // 2) 锁定 test：记录每个分层当前 test 集合
  const lockedTest = new Set<number>()
  if (lockTest) {
    for (const idx of ds.samples.keys()) {
      if (ds.samples[idx].split === 'test') lockedTest.add(idx)
    }
  }

  let changed = 0
  const setSplit = (idx: number, split: SplitKey) => {
    if (ds.samples[idx].split !== split) {
      ds.samples[idx].split = split
      changed++
    }
  }

  for (const idxs of groups.values()) {
    // 候选（训练/验证）池：排除锁定的 test
    const candidates = shuffle(
      idxs.filter((i) => !lockedTest.has(i)),
      rng
    )
    const lockedInGroup = idxs.filter((i) => lockedTest.has(i))

    let trainCount: number
    let valCount: number
    let testCount: number

    if (lockTest) {
      const remaining = candidates.length
      const rTrain = targets.train / (targets.train + targets.val || 1)
      trainCount = Math.round(remaining * rTrain)
      valCount = remaining - trainCount
      testCount = lockedInGroup.length
    } else {
      const [t, v, te] = allocateCounts(
        [targets.train, targets.val, targets.test],
        idxs.length
      )
      trainCount = t
      valCount = v
      testCount = te
    }

    let p = 0
    for (let k = 0; k < trainCount && p < candidates.length; k++, p++)
      setSplit(candidates[p], 'train')
    for (let k = 0; k < valCount && p < candidates.length; k++, p++)
      setSplit(candidates[p], 'val')
    for (let k = 0; k < testCount && p < candidates.length; k++, p++)
      setSplit(candidates[p], 'test')
    // 候选里剩余的归入 train（应对舍入余数）
    for (; p < candidates.length; p++) setSplit(candidates[p], 'train')
    // 锁定的 test 保持
    for (const i of lockedInGroup) setSplit(i, 'test')
  }

  return changed
}

/** 统计各子集样本数 */
export function splitCounts(ds: CanonicalDataset): Record<SplitKey, number> {
  const out: Record<SplitKey, number> = { train: 0, val: 0, test: 0, unknown: 0 }
  for (const s of ds.samples) out[s.split]++
  return out
}
