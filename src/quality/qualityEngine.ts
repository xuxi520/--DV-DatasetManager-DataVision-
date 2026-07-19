/**
 * 质量检查引擎（双端统一核心）
 * - 像素级指标在 Worker 中计算（quality.worker.ts），主线程零阻塞。
 * - 文件字节读取复用 dedup/fileOps 的环境分发（浏览器读 blob/sourceFile，Tauri 走批量 IPC）。
 * - 通过 WorkerPool 并行（4-8 个 Worker）处理万级图片，取代原单 Worker 顺序处理。
 * - 双层 IndexedDB 缓存：stat 索引（path::size -> md5）在主线程批量查询实现「免读字节」命中；
 *   质量结果（md5 -> result）在 Worker 内复用，重跑/跨数据集同内容无需重新解码计算。
 */
import type { ImageFile } from '../types'
import type { QualityOptions, QualityResult } from './types'
import { getFileBytesBatch } from '../dedup/fileOps'
import { WorkerPool, defaultPoolSize } from '../workers/workerPool'
import {
  buildStatKey,
  getStatMd5Batch,
  getQualityBatch,
  putStatBatch,
} from '../cache/idbCache'

let pool: WorkerPool | null = null

function getPool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool(
      () =>
        new Worker(new URL('./quality.worker.ts', import.meta.url), {
          type: 'module',
        }),
      defaultPoolSize(),
    )
  }
  return pool
}

export function destroyQualityWorker(): void {
  if (pool) {
    pool.destroy()
    pool = null
  }
}

export interface QualityRunCallbacks {
  /** 单图完成回调（解码失败不触发） */
  onResult: (r: QualityResult) => void
  /** 进度回调（第三个参数为已命中缓存、跳过少计算的文件数） */
  onProgress?: (processed: number, total: number, cacheHits: number) => void
  /** 取消判定（返回 true 时停止后续处理） */
  shouldCancel?: () => boolean
}

/**
 * 检查一批文件（便于上报进度与取消）。
 * 按块（CHUNK=32）批量取字节，逐张发给 Worker 池（并行），transfer 释放内存。
 */
export async function runQualityCheck(
  files: ImageFile[],
  options: QualityOptions,
  cb: QualityRunCallbacks,
): Promise<void> {
  const p = getPool()
  const total = files.length
  let processed = 0
  // 缓存命中计数：主线程 statIndex->quality 命中（免读字节）+ Worker 内容缓存命中（免解码）
  let cacheHits = 0

  // stat 索引批量写缓冲：累积到阈值后单事务提交，避免万级文件逐条开事务
  const STAT_FLUSH = 256
  const statBuffer: { key: string; md5: string }[] = []
  const flushStat = () => {
    if (statBuffer.length === 0) return
    const batch = statBuffer.splice(0, statBuffer.length)
    void putStatBatch(batch)
  }

  // 1) 主线程批量查 stat 索引：已缓存且未改动的文件「免读字节」直接命中
  const statKeys = files.map((f) => buildStatKey(f.path, f.size))
  const statMap = await getStatMd5Batch(statKeys)
  const hitMd5s = Array.from(new Set(Array.from(statMap.values())))
  const qMap = hitMd5s.length ? await getQualityBatch(hitMd5s) : new Map()

  const todo: ImageFile[] = []
  for (let i = 0; i < files.length; i++) {
    if (cb.shouldCancel?.()) break
    const f = files[i]
    const md5 = statMap.get(statKeys[i])
    const cached = md5 ? qMap.get(md5) : undefined
    if (cached) {
      // 主线程 statIndex->quality 命中：免读字节 + 免 Worker 解码，计入缓存命中
      cacheHits++
      // 用当前文件 id 覆盖（跨路径同内容复用结果时归属当前文件）
      cb.onResult({ ...cached.result, fileId: f.id })
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

  const CHUNK = 32
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
          const d = await p.run(
            {
              id: file.id,
              bytes,
              options: { ...options },
              // 复用 statIndex 中已有的 md5（可能来自哈希功能先算），跳过 MD5 计算
              md5: statMap.get(buildStatKey(file.path, file.size)),
            },
            [bytes.buffer],
          )
          if (d && d.ok) {
            // Worker 内容缓存命中（md5 已在 quality 表中，跳过图像解码）：计入缓存命中
            if ((d as any).cached) cacheHits++
            // 累积 stat 索引，循环末批量提交（避免万级文件逐条开事务）
            statBuffer.push({ key: buildStatKey(file.path, file.size), md5: d.md5 })
            cb.onResult(d.result as QualityResult)
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
