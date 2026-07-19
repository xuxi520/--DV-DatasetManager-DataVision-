/**
 * 哈希计算 WebWorker
 * 在 Worker 线程计算 MD5 + pHash + dHash + aHash，避免阻塞 UI。
 * 输入：{ id, bytes: ArrayBuffer }（bytes 通过 Transferable 零拷贝传入）
 * 输出：{ id, ok, md5, phash, dhash, ahash, width, height } 或 { id, ok:false, error }
 *
 * 缓存：先算 MD5（极廉价），以 md5 为内容键查 IndexedDB；命中则直接返回已存的感知哈希，
 *       跳过昂贵的图像解码（createImageBitmap + DCT）。未命中再解码计算并写回。
 *       md5 可由主线程经 statIndex 复用（质量检查已算过时跳过本步），不传则自行计算。
 *       这样「同内容不同路径」「重跑/重开」都能复用，无需重复解码。
 */
import SparkMD5 from 'spark-md5'
import { getHash, putHashBatch } from '../cache/idbCache'
import type { CachedHash } from '../cache/idbCache'

const ctx: any = self

// Worker 内逐消息 putHash 会产生大量 IndexedDB 事务。改为累积到阈值后单事务批量提交，
// 并用低频定时器兜底，确保运行结束后的残余缓冲也能落盘（数据不丢）。
const HASH_FLUSH = 128
let hashBuffer: CachedHash[] = []
let hashFlushTimer: ReturnType<typeof setInterval> | null = null

function scheduleHashFlush() {
  if (hashFlushTimer == null) {
    hashFlushTimer = setInterval(() => {
      void flushHashBuffer()
    }, 2000)
  }
}

async function flushHashBuffer(): Promise<void> {
  if (hashBuffer.length === 0) {
    // 缓冲空时撤掉定时器，避免运行间隙空转
    if (hashFlushTimer != null) {
      clearInterval(hashFlushTimer)
      hashFlushTimer = null
    }
    return
  }
  const batch = hashBuffer
  hashBuffer = []
  await putHashBatch(batch)
}

async function cacheHash(rec: CachedHash): Promise<void> {
  hashBuffer.push(rec)
  if (hashBuffer.length >= HASH_FLUSH) {
    await flushHashBuffer()
  } else {
    scheduleHashFlush()
  }
}

function toGray(data: Uint8ClampedArray, width: number, height: number): number[] {
  const gray: number[] = new Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4
    gray[i] = Math.round(0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2])
  }
  return gray
}

function resizeGray(src: number[], sw: number, sh: number, dw: number, dh: number): number[] {
  const dst: number[] = new Array(dw * dh)
  const xRatio = sw / dw
  const yRatio = sh / dh
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const srcX = Math.min(sw - 1, Math.floor(x * xRatio))
      const srcY = Math.min(sh - 1, Math.floor(y * yRatio))
      dst[y * dw + x] = src[srcY * sw + srcX]
    }
  }
  return dst
}

/** pHash：32x32 灰度 -> DCT 低频 8x8 -> 均值量化（64bit） */
function computePhash(data: Uint8ClampedArray, width: number, height: number): string {
  const gray = toGray(data, width, height)
  const small = resizeGray(gray, width, height, 32, 32)
  const dct: number[][] = []
  for (let y = 0; y < 8; y++) {
    dct[y] = []
    for (let x = 0; x < 8; x++) {
      let sum = 0
      for (let i = 0; i < 32; i++) {
        for (let j = 0; j < 32; j++) {
          sum += small[i * 32 + j] *
            Math.cos((Math.PI * x * (2 * i + 1)) / (2 * 32)) *
            Math.cos((Math.PI * y * (2 * j + 1)) / (2 * 32))
        }
      }
      dct[y][x] = sum
    }
  }
  let avg = 0
  let count = 0
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue
      avg += dct[y][x]
      count++
    }
  }
  avg /= count
  let hash = ''
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash += dct[y][x] > avg ? '1' : '0'
    }
  }
  return hash
}

/** dHash：9x8 灰度 -> 相邻列差分（64bit） */
function computeDHash(data: Uint8ClampedArray, width: number, height: number): string {
  const gray = toGray(data, width, height)
  const small = resizeGray(gray, width, height, 9, 8)
  let hash = ''
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = small[y * 9 + x]
      const right = small[y * 9 + x + 1]
      hash += left < right ? '1' : '0'
    }
  }
  return hash
}

/** aHash：8x8 灰度 -> 均值量化（64bit） */
function computeAHash(data: Uint8ClampedArray, width: number, height: number): string {
  const gray = toGray(data, width, height)
  const small = resizeGray(gray, width, height, 8, 8)
  let sum = 0
  for (const v of small) sum += v
  const avg = sum / small.length
  let hash = ''
  for (const v of small) hash += v >= avg ? '1' : '0'
  return hash
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

async function computeHashes(bytes: Uint8Array) {
  const file = new File([bytes as Uint8Array], 'x')
  const bitmap = await createImageBitmap(file)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const c = canvas.getContext('2d')!
  c.drawImage(bitmap, 0, 0)
  const imageData = c.getImageData(0, 0, bitmap.width, bitmap.height)

  const phash = computePhash(imageData.data, bitmap.width, bitmap.height)
  const dhash = computeDHash(imageData.data, bitmap.width, bitmap.height)
  const ahash = computeAHash(imageData.data, bitmap.width, bitmap.height)
  return {
    phash,
    dhash,
    ahash,
    width: bitmap.width,
    height: bitmap.height,
  }
}

ctx.onmessage = async (e: MessageEvent) => {
  const { id, bytes, md5: providedMd5 } = e.data
  try {
    // 1) 取 MD5：优先复用主线程经 statIndex 传来的（跨功能复用，省一次全文件哈希）；
    //    否则自行计算（廉价）。
    const md5 = providedMd5 ?? computeMd5(bytes as Uint8Array)
    const cached = await getHash(md5)
    if (cached) {
      ctx.postMessage({
        id,
        ok: true,
        md5,
        phash: cached.phash,
        dhash: cached.dhash,
        ahash: cached.ahash,
        width: cached.width,
        height: cached.height,
        cached: true,
      })
      return
    }

    // 2) 未命中：解码 + 计算感知哈希
    const h = await computeHashes(bytes as Uint8Array)
    await cacheHash({ md5, ...h })
    ctx.postMessage({ id, ok: true, md5, ...h })
  } catch (err: any) {
    ctx.postMessage({ id, ok: false, error: String(err?.message || err) })
  }
}
