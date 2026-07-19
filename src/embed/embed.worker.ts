/**
 * 特征抽取 WebWorker
 * 复用 quality.worker 模版：逐消息内先做 MD5（廉价），以 md5 为内容键查 IndexedDB
 * 命中则直接返回已存特征，跳过图像解码与 ONNX 推理；未命中再解码推理并批量写回。
 * 输入：{ id, bytes: Uint8Array, md5?: string }
 * 输出：{ id, ok, md5, vec: Float32Array, cached? } 或 { id, ok:false, error }
 */
import SparkMD5 from 'spark-md5'
import { getEmbedding, putEmbeddingBatch } from '../cache/idbCache'
import type { EmbeddingRecord, EmbedBackend } from './embedTypes'
import type { EmbedRuntimeConfig } from './embedConfig'
import { embedImageBytes, loadModel, getEmbedBackend } from './embedModel'

const ctx: any = self

const EMBED_FLUSH = 128
let embedBuffer: EmbeddingRecord[] = []
let embedFlushTimer: ReturnType<typeof setInterval> | null = null
/** 本 Worker 当前生效的配置与后端（首条消息下发后确定） */
let activeConfig: { preferWebGPU: boolean; wasmThreads: number } | null = null
let activeBackend: EmbedBackend | null = null

function scheduleEmbedFlush() {
  if (embedFlushTimer == null) {
    embedFlushTimer = setInterval(() => {
      void flushEmbedBuffer()
    }, 2000)
  }
}

async function flushEmbedBuffer(): Promise<void> {
  if (embedBuffer.length === 0) {
    if (embedFlushTimer != null) {
      clearInterval(embedFlushTimer)
      embedFlushTimer = null
    }
    return
  }
  const batch = embedBuffer
  embedBuffer = []
  await putEmbeddingBatch(batch)
}

async function cacheEmbed(rec: EmbeddingRecord): Promise<void> {
  embedBuffer.push(rec)
  if (embedBuffer.length >= EMBED_FLUSH) {
    await flushEmbedBuffer()
  } else {
    scheduleEmbedFlush()
  }
}

function computeMd5(bytes: Uint8Array): string {
  const buf = bytes.buffer
  const clean = buf.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const spark = new SparkMD5.ArrayBuffer()
  spark.append(clean)
  return spark.end()
}

ctx.onmessage = async (e: MessageEvent) => {
  const { id, bytes, md5: providedMd5, config } = e.data as {
    id: string
    bytes: Uint8Array
    md5?: string
    config?: EmbedRuntimeConfig
  }
  try {
    await loadModel(config)
    activeConfig = config
      ? { preferWebGPU: config.preferWebGPU, wasmThreads: config.wasmThreads }
      : activeConfig
    activeBackend = getEmbedBackend()
    const md5 = providedMd5 ?? computeMd5(bytes as Uint8Array)
    const cached = await getEmbedding(md5)
    if (cached) {
      ctx.postMessage({
        id,
        ok: true,
        md5,
        vec: cached.vec,
        cached: true,
        backend: activeBackend,
        config: activeConfig ?? undefined,
      })
      return
    }
    const vec = await embedImageBytes(bytes as Uint8Array)
    await cacheEmbed({ md5, dim: vec.length, vec })
    ctx.postMessage({
      id,
      ok: true,
      md5,
      vec,
      backend: activeBackend,
      config: activeConfig ?? undefined,
    })
  } catch (err: any) {
    ctx.postMessage({ id, ok: false, error: String(err?.message || err) })
  }
}
