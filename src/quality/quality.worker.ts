/**
 * 质量检查 WebWorker
 * 在 Worker 线程降采样解码图片并计算质量指标，避免阻塞 UI。
 * 复用 hash.worker.ts 的「createImageBitmap -> OffscreenCanvas -> getImageData」解码模版。
 * 输入：{ id, bytes: Uint8Array, options?: QualityOptions }（bytes 经 Transferable 零拷贝传入）
 * 输出：{ id, ok:true, md5, result: QualityResult } 或 { id, ok:false, error }
 *
 * 缓存：先算 MD5（廉价），以 md5 为内容键查 IndexedDB；命中则直接返回已存质量结果，
 *       跳过图像解码与指标计算。未命中再计算并写回。
 *       md5 可由主线程经 statIndex 复用（哈希功能已算过时跳过本步），不传则自行计算。
 */
import type { QualityOptions, QualityResult } from './types'
import SparkMD5 from 'spark-md5'
import { getQuality, putQualityBatch } from '../cache/idbCache'
import type { CachedQuality } from '../cache/idbCache'
import {
  computeBrightness,
  computeLaplacianVariance,
  computeAvgSaturation,
  buildQualityResult,
} from './metrics'

const ctx: any = self

// Worker 内逐消息 putQuality 会产生大量 IndexedDB 事务。改为累积到阈值后单事务批量提交，
// 并用低频定时器兜底，确保运行结束后的残余缓冲也能落盘（数据不丢）。
const QUALITY_FLUSH = 128
let qualityBuffer: CachedQuality[] = []
let qualityFlushTimer: ReturnType<typeof setInterval> | null = null

function scheduleQualityFlush() {
  if (qualityFlushTimer == null) {
    qualityFlushTimer = setInterval(() => {
      void flushQualityBuffer()
    }, 2000)
  }
}

async function flushQualityBuffer(): Promise<void> {
  if (qualityBuffer.length === 0) {
    if (qualityFlushTimer != null) {
      clearInterval(qualityFlushTimer)
      qualityFlushTimer = null
    }
    return
  }
  const batch = qualityBuffer
  qualityBuffer = []
  await putQualityBatch(batch)
}

async function cacheQuality(rec: CachedQuality): Promise<void> {
  qualityBuffer.push(rec)
  if (qualityBuffer.length >= QUALITY_FLUSH) {
    await flushQualityBuffer()
  } else {
    scheduleQualityFlush()
  }
}

function computeMd5(bytes: Uint8Array): string {
  const buf = bytes.buffer
  const clean = buf.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const spark = new SparkMD5.ArrayBuffer()
  spark.append(clean)
  return spark.end()
}

ctx.onmessage = async (e: MessageEvent) => {
  const { id, bytes, options, md5: providedMd5 } = e.data as {
    id: string
    bytes: Uint8Array
    options?: QualityOptions
    md5?: string
  }
  try {
    // 1) 取 MD5：优先复用主线程经 statIndex 传来的（跨功能复用，省一次全文件哈希）；
    //    否则自行计算（廉价）。
    const md5 = providedMd5 ?? computeMd5(bytes as Uint8Array)
    const cached = await getQuality(md5)
    if (cached) {
      // 用当前文件 id 覆盖（跨路径同内容复用结果时 fileId 应归属当前文件）
      ctx.postMessage({ id, ok: true, md5, result: { ...cached.result, fileId: id }, cached: true })
      return
    }

    const file = new File([bytes as Uint8Array], 'q')
    const bitmap = await createImageBitmap(file)
    const ow = bitmap.width
    const oh = bitmap.height

    // 降采样到 maxEdge，质量指标对分辨率不敏感，缩图即可大幅降成本
    const maxEdge = options?.maxEdge ?? 128
    const scale = Math.min(1, maxEdge / Math.max(ow, oh))
    const dw = Math.max(1, Math.round(ow * scale))
    const dh = Math.max(1, Math.round(oh * scale))

    const canvas = new OffscreenCanvas(dw, dh)
    const c = canvas.getContext('2d')!
    c.drawImage(bitmap, 0, 0, dw, dh)
    const data = c.getImageData(0, 0, dw, dh).data

    const blurScore = computeLaplacianVariance(data, dw, dh)
    const brightness = computeBrightness(data)
    const avgSaturation = computeAvgSaturation(data)
    const result: QualityResult = buildQualityResult(
      id,
      blurScore,
      brightness,
      avgSaturation,
      ow,
      oh,
      options ?? {},
    )

    await cacheQuality({ md5, result })
    ctx.postMessage({ id, ok: true, md5, result })
  } catch (err: any) {
    ctx.postMessage({ id, ok: false, error: String(err?.message || err) })
  }
}
