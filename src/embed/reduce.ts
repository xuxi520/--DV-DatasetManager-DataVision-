/**
 * 降维：将高维视觉特征（如 EfficientNet-B0 的 1280 维）投影到 2 维，供散点可视化。
 * - pca2d：幂迭代求前两个主成分，不显式构造协方差矩阵，复杂度 O(N·D·iters)；
 *   纯算法、离线可用、确定性结果。
 * - umap2d：umap-js（纯 JS）做 UMAP 降维，更擅长保留局部流形结构；样本过少回退 PCA。
 */
import { UMAP } from 'umap-js'

export type Vec = Float32Array
export type Point2D = [number, number]

/** PCA 降维到 2 维（幂迭代求前两主成分）。 */
export function pca2d(vectors: Vec[]): Point2D[] {
  const N = vectors.length
  if (N === 0) return []
  const D = vectors[0]?.length ?? 0
  if (D === 0) return []

  const mean = new Float32Array(D)
  for (const v of vectors) for (let j = 0; j < D; j++) mean[j] += v[j]
  for (let j = 0; j < D; j++) mean[j] /= N

  const Xc: number[][] = vectors.map((v) => {
    const r = new Array<number>(D)
    for (let j = 0; j < D; j++) r[j] = v[j] - mean[j]
    return r
  })

  // C·v = Xcᵀ (Xc·v)，避免显式构造 D×D 协方差矩阵
  const Cmul = (v: number[]): number[] => {
    const a = new Array<number>(N).fill(0)
    for (let i = 0; i < N; i++) {
      const xi = Xc[i]
      let s = 0
      for (let j = 0; j < D; j++) s += xi[j] * v[j]
      a[i] = s
    }
    const out = new Array<number>(D).fill(0)
    for (let i = 0; i < N; i++) {
      const ai = a[i]
      const xi = Xc[i]
      for (let j = 0; j < D; j++) out[j] += xi[j] * ai
    }
    return out
  }

  const normalize = (v: number[]): number[] => {
    let n = 0
    for (const x of v) n += x * x
    n = Math.sqrt(n) || 1
    return v.map((x) => x / n)
  }

  const powerIter = (C: (v: number[]) => number[]): number[] => {
    let v = normalize(Array.from({ length: D }, () => Math.random() - 0.5))
    let last = v
    for (let it = 0; it < 200; it++) {
      v = normalize(C(v))
      let dot = 0
      for (let j = 0; j < D; j++) dot += v[j] * last[j]
      if (Math.abs(Math.abs(dot) - 1) < 1e-7) break
      last = v
    }
    return v
  }

  const v1 = powerIter(Cmul)
  let lambda = 0
  {
    const Cv = Cmul(v1)
    for (let j = 0; j < D; j++) lambda += v1[j] * Cv[j]
  }
  //  deflation：C' = C - λ·v1·v1ᵀ，再对 C' 幂迭代得第二主成分
  const C2 = (v: number[]): number[] => {
    const Cv = Cmul(v)
    let dot = 0
    for (let j = 0; j < D; j++) dot += v[j] * v1[j]
    for (let j = 0; j < D; j++) Cv[j] -= lambda * v1[j] * dot
    return Cv
  }
  const v2 = powerIter(C2)

  const proj1 = Xc.map((xi) => {
    let s = 0
    for (let j = 0; j < D; j++) s += xi[j] * v1[j]
    return s
  })
  const proj2 = Xc.map((xi) => {
    let s = 0
    for (let j = 0; j < D; j++) s += xi[j] * v2[j]
    return s
  })

  return Xc.map((_, i) => [proj1[i], proj2[i]] as Point2D)
}

/** UMAP 降维到 2 维（umap-js）。样本 < 4 时回退 PCA。 */
export function umap2d(vectors: Vec[], nNeighbors = 15): Point2D[] {
  const N = vectors.length
  if (N < 4) return pca2d(vectors)
  const data = vectors.map((v) => Array.from(v))
  const k = Math.min(nNeighbors, N - 1)
  const umap = new UMAP({ nComponents: 2, nNeighbors: k })
  const emb = umap.fit(data)
  return emb.map((p) => [p[0], p[1]] as Point2D)
}
