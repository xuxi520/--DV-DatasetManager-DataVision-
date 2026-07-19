// 主线程单例客户端：持有 ANN Worker，用 reqId 映射在途请求；失败兜底由调用方（useEmbeddings）回退暴力。
import type { AnnEntry, AnnHit } from './annIndex'

let worker: Worker | null = null
let seq = 0
interface Pending {
  resolve: (d: any) => void
  reject: (e: any) => void
}
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./ann.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (d == null || d.reqId == null) return
      const p = pending.get(d.reqId)
      if (!p) return
      pending.delete(d.reqId)
      if (d.ok) p.resolve(d)
      else p.reject(new Error(d.error || 'ANN Worker 失败'))
    }
    worker.onerror = (ev: ErrorEvent) => {
      // Worker 启动/运行失败只触发 onerror，手动 reject 所有在途请求
      const err = new Error(ev.message || 'ANN Worker 出错')
      for (const [, p] of pending) p.reject(err)
      pending.clear()
    }
  }
  return worker
}

export function destroyAnnWorker(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
  pending.clear()
}

// 构建（仅内存索引）。拷贝传入（不 transfer），保护主线程 embeddings 不被 neuter。
export function buildAnnIndex(entries: AnnEntry[], dim: number, version: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const w = getWorker()
    const reqId = ++seq
    pending.set(reqId, {
      resolve: () => resolve(),
      reject
    })
    w.postMessage({ type: 'build', reqId, version, dim, entries })
  }).then(() => undefined)
}

// 检索。query 经 postMessage 结构化克隆（不 transfer），主线程 q 保持可用。
export function searchAnn(query: Float32Array, topK: number, excludeMd5: string): Promise<AnnHit[]> {
  return new Promise<AnnHit[]>((resolve, reject) => {
    const w = getWorker()
    const reqId = ++seq
    pending.set(reqId, {
      resolve: (d: any) => resolve((d.hits as AnnHit[]) || []),
      reject
    })
    w.postMessage({ type: 'search', reqId, query: query.slice(), topK, excludeMd5 })
  })
}

export function resetAnnIndex(): void {
  if (!worker) return
  const reqId = ++seq
  worker.postMessage({ type: 'reset', reqId })
}
