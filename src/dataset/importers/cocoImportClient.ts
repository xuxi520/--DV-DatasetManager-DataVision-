// COCO 解析 Worker 的主线程客户端（单例，按 reqId 映射在途请求）。
import type { RawSample } from './cocoTransform'

interface WorkerReq {
  id: number
  path: string
  text: string
}
interface WorkerRes {
  id: number
  ok: boolean
  path: string
  samples?: RawSample[]
  classes?: { id: number; name: string }[]
  warnings?: string[]
  error?: string
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: WorkerRes) => void; reject: (e: unknown) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./cocoImport.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerRes>) => {
      const msg = e.data
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg)
      else p.reject(new Error(msg.error || 'coco worker failed'))
    }
    worker.onerror = (e: ErrorEvent) => {
      const err = new Error(e.message || 'coco worker error')
      for (const p of pending.values()) p.reject(err)
      pending.clear()
    }
  }
  return worker
}

/**
 * 把 json 文本交给 Worker 解析（文本由主线程异步读取后传入，读取本身不阻塞主线程；
 * 仅 JSON.parse 这一 CPU 重活在 Worker 中执行，UI 保持响应）。
 */
export function parseCocoInWorker(path: string, text: string): Promise<WorkerRes> {
  const w = getWorker()
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, path, text } as WorkerReq)
  })
}
