/**
 * 通用 Web Worker 池（4-8 并行）
 * 解决「单 Worker 顺序处理万级图片」的性能瓶颈：池持有 N 个同构 Worker，
 * 任务按队列派发给空闲 Worker；每个 Worker 同一时刻只处理一个任务，
 * 由 pool 控制整体并发度（= Worker 数）。Worker 彼此可互换，返回按任务 id 匹配。
 *
 * 适用于 hash.worker / quality.worker 等同构任务。Transferable 零拷贝传入也支持。
 */

export type PoolFactory = () => Worker

interface PendingJob {
  payload: any
  transfer?: Transferable[]
  resolve: (data: any) => void
  reject: (err: any) => void
}

export class WorkerPool {
  private factory: PoolFactory
  private size: number
  private workers: Worker[] = []
  private idle: Worker[] = []
  private queue: PendingJob[] = []
  private active = new Map<
    Worker,
    { resolve: (data: any) => void; reject: (err: any) => void }
  >()
  private destroyed = false

  constructor(factory: PoolFactory, size = 4) {
    this.factory = factory
    this.size = Math.max(1, size)
  }

  /** 当前并发度（Worker 数） */
  get concurrency(): number {
    return this.size
  }

  private ensure(): void {
    if (this.destroyed) return
    while (this.workers.length < this.size) {
      const w = this.factory()
      w.onerror = (ev: ErrorEvent) => {
        const cur = this.active.get(w)
        if (cur) {
          this.active.delete(w)
          cur.reject(new Error(ev.message || 'Worker 运行出错'))
          this.pump()
        }
      }
      this.workers.push(w)
      this.idle.push(w)
    }
  }

  /** 派发一个任务，返回解析为 Worker 回包的 Promise */
  run(payload: any, transfer?: Transferable[]): Promise<any> {
    if (this.destroyed) return Promise.reject(new Error('WorkerPool 已销毁'))
    return new Promise((resolve, reject) => {
      this.queue.push({ payload, transfer, resolve, reject })
      this.pump()
    })
  }

  private pump(): void {
    if (this.destroyed) return
    this.ensure()
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop() as Worker
      const job = this.queue.shift() as PendingJob
      this.active.set(w, job)

      const onMsg = (e: MessageEvent) => {
        w.removeEventListener('message', onMsg)
        this.active.delete(w)
        this.idle.push(w)
        const data = e.data
        if (data && data.ok === false && data.error) {
          job.reject(new Error(data.error))
        } else {
          job.resolve(data)
        }
        this.pump()
      }
      w.addEventListener('message', onMsg)

      try {
        if (job.transfer && job.transfer.length) {
          w.postMessage(job.payload, job.transfer)
        } else {
          w.postMessage(job.payload)
        }
      } catch (err) {
        w.removeEventListener('message', onMsg)
        this.active.delete(w)
        this.idle.push(w)
        job.reject(err)
        this.pump()
      }
    }
  }

  /** 销毁所有 Worker 并拒绝在途任务 */
  destroy(): void {
    this.destroyed = true
    for (const w of this.workers) w.terminate()
    this.workers = []
    this.idle = []
    this.active.clear()
    const pending = this.queue
    this.queue = []
    for (const j of pending) j.reject(new Error('WorkerPool 已销毁'))
  }
}

/** 依据 CPU 核数推导池大小，约束在 [4, 8]（万级图片规模化推荐区间） */
export function defaultPoolSize(): number {
  const cores =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4
  return Math.min(8, Math.max(4, cores))
}
