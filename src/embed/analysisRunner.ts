/**
 * 降维 & 离群分析的运行器（单例 Worker 封装）
 * 复用 analysis.worker，把重计算放到后台线程，主线程保持响应。
 * 仅维护一个 Worker：分析本身是「全局一次性」任务，无需多 Worker 并行。
 */
import type { Vec, Point2D } from './reduce'

let worker: Worker | null = null
let seq = 0

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), {
      type: 'module',
    })
  }
  return worker
}

/** 终止并释放分析 Worker（一般不需要，留作清理入口） */
export function destroyAnalysisWorker(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
}

/**
 * 分析结果的会话内内存缓存：按 key（数据集 + 方法 + 特征版本）命中后直接返回，
 * 免去后台 Worker 重算（PCA/UMAP 切换、重复点「分析」均秒回）。
 * 特征重算（embed.version 变化）或切数据集会使 key 失效，自动重新计算。
 */
type AnalysisResult = { coords: Point2D[]; scores: number[] }
const analysisCache = new Map<string, AnalysisResult>()

/** 清空分析缓存（特征重算后可由调用方触发，确保不命中旧结果） */
export function clearAnalysisCache(): void {
  analysisCache.clear()
}

/**
 * 带缓存的分析入口。命中缓存时不启动 Worker，直接返回缓存结果。
 * @param key 缓存键（调用方用 `数据集id|方法|特征版本` 拼接）
 */
export function runAnalysisCached(
  key: string,
  vecs: Vec[],
  method: 'pca' | 'umap',
  k = 5,
): Promise<{ coords: Point2D[]; scores: number[]; cached: boolean }> {
  const hit = analysisCache.get(key)
  if (hit) {
    return Promise.resolve({ ...hit, cached: true })
  }
  return runAnalysis(vecs, method, k).then((res) => {
    analysisCache.set(key, { coords: res.coords, scores: res.scores })
    return { ...res, cached: false }
  })
}

/**
 * 在后台线程执行降维 + 离群度计算。
 * @param vecs 特征向量（L2 归一化后的 Float32Array 列表）
 * @param method 'pca' | 'umap'
 * @param k 离群检测的近邻数
 */
export function runAnalysis(
  vecs: Vec[],
  method: 'pca' | 'umap',
  k = 5,
): Promise<{ coords: Point2D[]; scores: number[] }> {
  return new Promise((resolve, reject) => {
    const w = getWorker()
    const id = `an${++seq}`

    const onMsg = (e: MessageEvent) => {
      const d = e.data
      if (!d || d.id !== id) return
      w.removeEventListener('message', onMsg)
      w.removeEventListener('error', onErr)
      if (d.ok) {
        resolve({ coords: d.coords as Point2D[], scores: d.scores as number[] })
      } else {
        reject(new Error(d.error || '分析失败'))
      }
    }
    const onErr = (ev: ErrorEvent) => {
      w.removeEventListener('message', onMsg)
      w.removeEventListener('error', onErr)
      reject(new Error(ev.message || '分析 Worker 出错'))
    }
    w.addEventListener('message', onMsg)
    w.addEventListener('error', onErr)

    // 拷贝传入（不 transfer），保护主线程 embeddings 不被 neuter
    w.postMessage({ id, method, vecs, k })
  })
}
