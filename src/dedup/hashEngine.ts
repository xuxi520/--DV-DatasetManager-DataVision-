/**
 * 哈希计算引擎（双端统一核心）
 * - 核心算法在 Worker 中执行，与运行环境无关。
 * - 通过 WorkerPool 并行（4-8 个 Worker）处理万级图片，取代原单 Worker 顺序处理。
 * - 双层 IndexedDB 缓存：
 *    1) stat 索引（path::size -> md5）在主线程批量查询，已缓存且未改动的文件「免读字节」直接命中；
 *    2) 内容哈希（md5 -> 感知哈希）在 Worker 内复用，跨路径同内容 / 重跑均无需重新解码。
 * - 文件字节读取由调用方通过 getBytes() 注入（浏览器读 blob / Tauri 读本地文件），
 *   以此实现「判断环境分发文件读取」的统一核心逻辑。
 */
import type { FileHash } from './types'
import { WorkerPool, defaultPoolSize } from '../workers/workerPool'
import {
  buildStatKey,
  getStatMd5Batch,
  getHashBatch,
  putStatBatch,
} from '../cache/idbCache'

interface HashJob {
  id: string
  path: string
  /** 用于缓存失效判定（尺寸变化即视为改动）。缺省按 0 处理（仅按路径） */
  size?: number
  getBytes: () => Promise<Uint8Array>
}

/** 批量读取器：给定一批 job，返回 id -> 字节 的映射（Tauri 下走单次/分块 IPC 批量读） */
export type BatchByteReader = (
  jobs: HashJob[],
) => Promise<Map<string, Uint8Array>>

let pool: WorkerPool | null = null

function getPool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool(
      () => new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' }),
      defaultPoolSize(),
    )
  }
  return pool
}

export function destroyHashWorker() {
  if (pool) {
    pool.destroy()
    pool = null
  }
}

function emitHash(
  j: HashJob,
  d: any,
  onFile: (id: string, h: FileHash | null) => void,
  statBuffer: { key: string; md5: string }[],
  cacheHits: { count: number },
): FileHash | null {
  if (d && d.ok) {
    // Worker 内容缓存命中（md5 已在 hashes 表中，跳过图像解码）：计入缓存命中
    if (d.cached) cacheHits.count++
    // 累积 stat 索引，由调用方批量提交（避免万级文件逐条开事务）
    statBuffer.push({ key: buildStatKey(j.path, j.size ?? 0), md5: d.md5 })
    const h: FileHash = {
      md5: d.md5,
      phash: d.phash,
      dhash: d.dhash,
      ahash: d.ahash,
    }
    onFile(j.id, h)
    return h
  }
  onFile(j.id, null)
  return null
}

/**
 * 计算一批文件的哈希（便于上报进度与取消）。
 * @param jobs         待计算任务（已过滤掉可复用缓存的项）
 * @param onFile       单文件完成回调（h 为 null 表示解码/读取失败）
 * @param onProgress   进度回调（第三个参数为已命中缓存、跳过少计算的文件数）
 * @param shouldCancel 取消判定
 * @param batchReader  批量读取器（Tauri 下分块 IPC 批量读，性能更优）
 */
export async function computeHashesForFiles(
  jobs: HashJob[],
  onFile: (id: string, h: FileHash | null) => void,
  onProgress: (processed: number, total: number, cacheHits: number) => void,
  shouldCancel?: () => boolean,
  batchReader?: BatchByteReader,
): Promise<void> {
  const p = getPool()
  const total = jobs.length
  let processed = 0
  // 缓存命中计数：主线程 statIndex->hashes 命中（免读字节）+ Worker 内容缓存命中（免解码）
  const cacheHits = { count: 0 }

  // stat 索引批量写缓冲：累积到阈值后单事务提交，避免万级文件逐条开事务
  const STAT_FLUSH = 256
  const statBuffer: { key: string; md5: string }[] = []
  const flushStat = () => {
    if (statBuffer.length === 0) return
    const batch = statBuffer.splice(0, statBuffer.length)
    void putStatBatch(batch)
  }

  // 1) 主线程批量查 stat 索引：未改动的文件「免读字节」直接命中
  const statKeys = jobs.map((j) => buildStatKey(j.path, j.size ?? 0))
  const statMap = await getStatMd5Batch(statKeys)
  const hitMd5s = Array.from(new Set(Array.from(statMap.values())))
  const hashMap = hitMd5s.length ? await getHashBatch(hitMd5s) : new Map()

  const todo: HashJob[] = []
  // statIndex 中已有的 md5 一并随任务下发到 Worker，命中则跳过 MD5 计算（跨功能复用）
  const md5ByKey = new Map<string, string | undefined>()
  for (let i = 0; i < jobs.length; i++) {
    if (shouldCancel?.()) break
    const j = jobs[i]
    const key = statKeys[i]
    const md5 = statMap.get(key)
    md5ByKey.set(key, md5)
    const cached = md5 ? hashMap.get(md5) : undefined
    if (cached) {
      onFile(j.id, {
        md5: cached.md5,
        phash: cached.phash,
        dhash: cached.dhash,
        ahash: cached.ahash,
      })
      processed++
      cacheHits.count++
      onProgress(processed, total, cacheHits.count)
    } else {
      todo.push(j)
    }
  }

  if (todo.length === 0) {
    flushStat()
    return
  }

  // 2) 计算未命中项（Worker 池并行；Worker 内再次按 md5 复用跨路径缓存）
  if (batchReader) {
    const CHUNK = 32
    for (let start = 0; start < todo.length; start += CHUNK) {
      if (shouldCancel?.()) break
      const slice = todo.slice(start, start + CHUNK)
      const bytesMap = await batchReader(slice)
      await Promise.all(
        slice.map((j) => {
          const bytes = bytesMap.get(j.id)
          if (!bytes || bytes.length === 0) {
            onFile(j.id, null)
            processed++
            onProgress(processed, total, cacheHits.count)
            return Promise.resolve()
          }
          return p
            .run(
              { id: j.id, bytes, md5: md5ByKey.get(buildStatKey(j.path, j.size ?? 0)) },
              [bytes.buffer],
            )
            .then((d) => emitHash(j, d, onFile, statBuffer, cacheHits))
            .finally(() => {
              processed++
              onProgress(processed, total, cacheHits.count)
            })
        }),
      )
      if (statBuffer.length >= STAT_FLUSH) flushStat()
    }
    flushStat()
    return
  }

  // 回退模式（无批量读取器，如浏览器单张读）：逐张读取 + Worker 池
  for (const j of todo) {
    if (shouldCancel?.()) break
    let bytes: Uint8Array
    try {
      bytes = await j.getBytes()
    } catch {
      onFile(j.id, null)
      processed++
      onProgress(processed, total, cacheHits.count)
      continue
    }
    if (!bytes || bytes.length === 0) {
      onFile(j.id, null)
      processed++
      onProgress(processed, total, cacheHits.count)
      continue
    }
    try {
      const d = await p.run(
        { id: j.id, bytes, md5: md5ByKey.get(buildStatKey(j.path, j.size ?? 0)) },
        [bytes.buffer],
      )
      emitHash(j, d, onFile, statBuffer, cacheHits)
    } catch {
      onFile(j.id, null)
    }
    processed++
    onProgress(processed, total, cacheHits.count)
    if (statBuffer.length >= STAT_FLUSH) flushStat()
  }
  flushStat()
}
