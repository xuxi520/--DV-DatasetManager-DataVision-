/**
 * 降维 & 离群分析 WebWorker
 * 把 O(N²·D) 级别的 UMAP / PCA / kNN 离群计算从主线程挪到 Worker，
 * 避免「计算特征」后几千张图做分析时主线程被长时间占用、界面卡死。
 *
 * 输入：{ id, method: 'pca'|'umap', vecs: Float32Array[], k }
 * 输出：{ id, ok, coords: [number,number][], scores: number[] } 或 { id, ok:false, error }
 * 注意：vecs 走 structured clone（拷贝），不 transfer，主线程的特征向量不被 neuter。
 */
import { pca2d, umap2d } from './reduce'
import { knnOutlierScores } from './outlier'
import type { Vec } from './reduce'

const ctx: any = self

interface AnalysisMsg {
  id: string
  method: 'pca' | 'umap'
  vecs: Vec[]
  k: number
}

ctx.onmessage = (e: MessageEvent) => {
  const { id, method, vecs, k } = e.data as AnalysisMsg
  try {
    const coords = method === 'umap' ? umap2d(vecs) : pca2d(vecs)
    const scores = knnOutlierScores(vecs, k)
    ctx.postMessage({ id, ok: true, coords, scores })
  } catch (err: any) {
    ctx.postMessage({ id, ok: false, error: String(err?.message || err) })
  }
}
