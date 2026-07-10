/**
 * 哈希计算引擎（双端统一核心）
 * - 核心算法在 Worker 中执行，与运行环境无关
 * - 文件字节读取由调用方通过 getBytes() 注入（浏览器读 blob / Tauri 读本地文件）
 *   以此实现「判断环境分发文件读取」的统一核心逻辑。
 */
import type { FileHash } from './types'

interface HashJob {
  id: string
  path: string
  getBytes: () => Promise<Uint8Array>
}

let worker: Worker | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

export function destroyHashWorker() {
  if (worker) {
    worker.terminate()
    worker = null
  }
}

/**
 * 顺序计算一批文件的哈希（便于上报进度与取消）。
 * @param jobs      待计算任务（已过滤掉可复用缓存的项）
 * @param onFile    单文件完成回调（h 为 null 表示解码失败）
 * @param onProgress 进度回调
 * @param shouldCancel 取消判定
 */
export async function computeHashesForFiles(
  jobs: HashJob[],
  onFile: (id: string, h: FileHash | null) => void,
  onProgress: (processed: number, total: number) => void,
  shouldCancel?: () => boolean
): Promise<void> {
  const w = getWorker()
  const total = jobs.length
  let processed = 0

  for (const job of jobs) {
    if (shouldCancel?.()) break
    let bytes: Uint8Array
    try {
      bytes = await job.getBytes()
    } catch (err) {
      // 读取失败 -> 视为失败
      onFile(job.id, null)
      processed++
      onProgress(processed, total)
      continue
    }

    try {
      const res: any = await new Promise((resolve) => {
        const handler = (e: MessageEvent) => {
          const d = e.data
          if (d && d.id === job.id) {
            w.removeEventListener('message', handler)
            resolve(d)
          }
        }
        w.addEventListener('message', handler)
        // 零拷贝传输底层 ArrayBuffer
        w.postMessage({ id: job.id, bytes }, [bytes.buffer])
      })

      if (res && res.ok) {
        onFile(job.id, {
          md5: res.md5,
          phash: res.phash,
          dhash: res.dhash,
          ahash: res.ahash,
        })
      } else {
        onFile(job.id, null)
      }
    } catch {
      onFile(job.id, null)
    }

    processed++
    onProgress(processed, total)
  }
}
