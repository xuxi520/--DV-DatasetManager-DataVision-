/**
 * 特征抽取引擎（双端统一核心，镜像 qualityEngine 模式）
 * - ONNX 推理在 embed.worker 内（onnxruntime-web WASM），主线程零阻塞。
 * - 文件字节读取复用 dedup/fileOps 的环境分发（浏览器读 blob/sourceFile，Tauri 走批量 IPC）。
 * - 通过 WorkerPool 并行（4-8 Worker）处理万级图片。
 * - 内容寻址缓存（md5 -> 特征）在 Worker 内复用，重跑/跨数据集同内容无需重新推理。
 */
import type { ImageFile } from '../types'
import { getFileBytesBatch } from '../dedup/fileOps'
import { WorkerPool } from '../workers/workerPool'
import type { EmbedResponse, EmbedBackend } from './embedTypes'
import { getEmbedConfig } from './embedConfig'
import {
  buildStatKey,
  getStatMd5Batch,
  getEmbeddingBatch,
  putStatBatch,
} from '../cache/idbCache'

let pool: WorkerPool | null = null

/**
 * 特征抽取专用并发度（区别于 hash/quality 的通用 [4,8]）。
 * ONNX 推理与其它轻量任务不同：每个 Worker 各自持有一份 ONNX 会话
 * （模型≈16MB + wasm 运行时≈26MB），且单线程 wasm 推理是 CPU 密集型。
 * 若沿用 [4,8]，低配机（双核 / 4GB）会内存暴涨 + CPU 打满导致卡死。
 * 故按设备核数与内存自适应收敛到 1–4：
 * - 最多用一半核心，给 UI / 系统留余量；
 * - 依 deviceMemory 进一步限幅（每 Worker 约需 150–250MB）。
 */
function embedPoolSize(): number {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const cores = nav?.hardwareConcurrency && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : 4
  // deviceMemory：粗略设备内存(GB)，部分浏览器 / WebView 不提供
  const mem = (nav as unknown as { deviceMemory?: number } | undefined)?.deviceMemory

  // 至多用一半核心
  let n = Math.max(1, Math.floor(cores / 2))
  // 内存限幅
  if (typeof mem === 'number' && mem > 0) {
    if (mem <= 4) n = Math.min(n, 2)
    else if (mem <= 8) n = Math.min(n, 3)
    else n = Math.min(n, 4)
  } else {
    n = Math.min(n, 4)
  }
  return Math.max(1, Math.min(4, n))
}

function getPool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool(
      () =>
        new Worker(new URL('./embed.worker.ts', import.meta.url), {
          type: 'module',
        }),
      embedPoolSize(),
    )
  }
  return pool
}

export function destroyEmbedWorker(): void {
  if (pool) {
    pool.destroy()
    pool = null
  }
}

export interface EmbedResult {
  id: string
  md5: string
  vec: Float32Array
}

export interface EmbedCallbacks {
  onResult: (r: EmbedResult) => void
  onProgress?: (processed: number, total: number, cacheHits: number) => void
  /** 实际推理后端（webgpu/wasm + 线程数），首条成功响应即确定，用于 UI 展示 */
  onBackend?: (b: EmbedBackend) => void
  shouldCancel?: () => boolean
}

/**
 * 抽取一批文件的特征。与 MD5/质量同款的双层缓存范式：
 *  1) 主线程批量查 statIndex(path::size->md5) + 批量查 embeddings，已缓存的文件
 *     「免读字节 + 免 Worker 解码/推理」直接命中，仅计入 cacheHits；
 *  2) 仅未命中的文件才 getFileBytesBatch 读整图、发 Worker 池推理；
 *  3) 计算完成后回填 statIndex，使「仅算过特征」的数据集二次重跑也能免读字节。
 * Worker 内仍保留 md5 内容缓存作为兜底。运行时配置随任务下发。
 */
export async function runEmbedding(
  files: ImageFile[],
  cb: EmbedCallbacks,
): Promise<void> {
  const p = getPool()
  const total = files.length
  let processed = 0
  let cacheHits = 0
  let backendReported = false
  const cfg = getEmbedConfig()

  // stat 索引批量写缓冲：累积到阈值后单事务提交，避免万级文件逐条开事务
  const STAT_FLUSH = 256
  const statBuffer: { key: string; md5: string }[] = []
  const flushStat = () => {
    if (statBuffer.length === 0) return
    const batch = statBuffer.splice(0, statBuffer.length)
    void putStatBatch(batch)
  }

  // 1) 主线程批量查 stat 索引：已缓存且特征存在 -> 免读字节直接命中
  const statKeys = files.map((f) => buildStatKey(f.path, f.size))
  const statMap = await getStatMd5Batch(statKeys)
  const hitMd5s = Array.from(new Set(Array.from(statMap.values())))
  const eMap = hitMd5s.length ? await getEmbeddingBatch(hitMd5s) : new Map()

  const todo: ImageFile[] = []
  for (let i = 0; i < files.length; i++) {
    if (cb.shouldCancel?.()) break
    const f = files[i]
    const md5 = statMap.get(statKeys[i])
    const rec = md5 ? eMap.get(md5) : undefined
    if (rec) {
      // 主线程 statIndex->embedding 命中：免读字节 + 免 Worker 解码/推理
      cacheHits++
      cb.onResult({ id: f.id, md5: rec.md5, vec: rec.vec })
      processed++
      cb.onProgress?.(processed, total, cacheHits)
    } else {
      todo.push(f)
    }
  }

  if (todo.length === 0) {
    flushStat()
    return
  }

  const CHUNK = 16
  for (let s = 0; s < todo.length; s += CHUNK) {
    if (cb.shouldCancel?.()) break
    const slice = todo.slice(s, s + CHUNK)
    const bytesMap = await getFileBytesBatch(slice, CHUNK)
    await Promise.all(
      slice.map(async (file) => {
        const bytes = bytesMap.get(file.id)
        if (!bytes || bytes.length === 0) {
          processed++
          cb.onProgress?.(processed, total, cacheHits)
          return
        }
        try {
          const d = (await p.run(
            {
              id: file.id,
              bytes,
              config: cfg,
              // 复用 statIndex 中已有的 md5（可能来自哈希/质量先算），跳过 MD5 计算
              md5: statMap.get(buildStatKey(file.path, file.size)),
            },
            [bytes.buffer],
          )) as EmbedResponse
          if (d && d.ok && d.vec) {
            if (!backendReported && d.backend) {
              backendReported = true
              cb.onBackend?.(d.backend)
            }
            if (d.cached) cacheHits++
            const vec = d.vec instanceof Float32Array ? d.vec : new Float32Array(d.vec)
            cb.onResult({ id: file.id, md5: d.md5 as string, vec })
            // 回填 stat 索引：让「仅算过特征」的数据集再次重跑也能免读字节
            if (d.md5) statBuffer.push({ key: buildStatKey(file.path, file.size), md5: d.md5 })
          }
        } catch {
          // 单图失败不中断整体，仅跳过
        }
        processed++
        cb.onProgress?.(processed, total, cacheHits)
      }),
    )
    if (statBuffer.length >= STAT_FLUSH) flushStat()
  }
  flushStat()
}
