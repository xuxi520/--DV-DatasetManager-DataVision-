/**
 * 哈希计算 WebWorker
 * 在 Worker 线程计算 MD5 + pHash + dHash + aHash，避免阻塞 UI。
 * 输入：{ id, bytes: ArrayBuffer }（bytes 通过 Transferable 零拷贝传入）
 * 输出：{ id, ok, md5, phash, dhash, ahash, width, height } 或 { id, ok:false, error }
 */
import SparkMD5 from 'spark-md5'

const ctx: any = self

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

ctx.onmessage = async (e: MessageEvent) => {
  const { id, bytes } = e.data
  try {
    const file = new File([bytes as Uint8Array], 'x')
    const bitmap = await createImageBitmap(file)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const c = canvas.getContext('2d')!
    c.drawImage(bitmap, 0, 0)
    const imageData = c.getImageData(0, 0, bitmap.width, bitmap.height)

    const phash = computePhash(imageData.data, bitmap.width, bitmap.height)
    const dhash = computeDHash(imageData.data, bitmap.width, bitmap.height)
    const ahash = computeAHash(imageData.data, bitmap.width, bitmap.height)

    // MD5（基于原始字节）
    const buf = (bytes as Uint8Array).buffer
    const clean = buf.slice((bytes as Uint8Array).byteOffset, (bytes as Uint8Array).byteOffset + (bytes as Uint8Array).byteLength)
    const spark = new SparkMD5.ArrayBuffer()
    spark.append(clean as ArrayBuffer)
    const md5 = spark.end()

    ctx.postMessage({
      id,
      ok: true,
      md5,
      phash,
      dhash,
      ahash,
      width: bitmap.width,
      height: bitmap.height,
    })
  } catch (err: any) {
    ctx.postMessage({ id, ok: false, error: String(err?.message || err) })
  }
}
