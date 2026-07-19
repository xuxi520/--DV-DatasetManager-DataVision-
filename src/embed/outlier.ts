/**
 * 离群检测：基于 k 近邻的余弦离群度。
 * 特征向量已 L2 归一化，故余弦相似度 = 点积，余弦距离 = 1 - 点积。
 * 每个点到其第 k 近邻的余弦距离越大，说明它越孤立（可能为脏图 / 分布外样本）。
 *
 * 复杂度 O(N²·D)，适用于「计算特征」后的当前集合（数百 ~ 数千张）；
 * 百万级为 P2-2 ANN 范畴，本期不做。
 */
import type { Vec } from './reduce'

/** 返回与输入对齐的离群度分数（越大越孤立）。 */
export function knnOutlierScores(vectors: Vec[], k = 5): number[] {
  const N = vectors.length
  if (N === 0) return []
  const kk = Math.min(k, N - 1)
  const scores = new Array<number>(N).fill(0)
  for (let i = 0; i < N; i++) {
    const a = vectors[i]
    const dists: number[] = []
    for (let j = 0; j < N; j++) {
      if (i === j) continue
      const b = vectors[j]
      const n = Math.min(a.length, b.length)
      let dot = 0
      for (let t = 0; t < n; t++) dot += a[t] * b[t]
      dists.push(1 - dot)
    }
    dists.sort((x, y) => x - y)
    scores[i] = dists[kk - 1] ?? dists[dists.length - 1] ?? 0
  }
  return scores
}
