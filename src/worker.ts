/**
 * WebWorker - 哈希计算引擎
 * 负责：MD5完全重复检测、pHash感知相似检测
 * 不阻塞主线程
 */
import SparkMD5 from 'spark-md5'

// 图像数据转灰度
function toGray(data: Uint8ClampedArray, width: number, height: number): number[] {
  const gray: number[] = new Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4
    gray[i] = Math.round(0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2])
  }
  return gray
}

// 计算pHash
function computePhash(data: Uint8ClampedArray, width: number, height: number): string {
  // 1. 缩放到32x32灰度
  const gray = toGray(data, width, height)
  const small = resizeGray(gray, width, height, 32, 32)
  
  // 2. DCT变换（简化版：只取左上角8x8）
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
  
  // 3. 计算平均值（排除第一个系数）
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
  
  // 4. 生成哈希
  let hash = ''
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash += dct[y][x] > avg ? '1' : '0'
    }
  }
  return hash
}

// 灰度图像缩放
function resizeGray(src: number[], sw: number, sh: number, dw: number, dh: number): number[] {
  const dst: number[] = new Array(dw * dh)
  const xRatio = sw / dw
  const yRatio = sh / dh
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const srcX = Math.floor(x * xRatio)
      const srcY = Math.floor(y * yRatio)
      dst[y * dw + x] = src[srcY * sw + srcX]
    }
  }
  return dst
}

// 汉明距离
function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) dist++
  }
  return dist
}

// 计算MD5
async function computeMD5(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunkSize = 2 * 1024 * 1024 // 2MB chunks
    const chunks = Math.ceil(file.size / chunkSize)
    const spark = new SparkMD5.ArrayBuffer()
    let currentChunk = 0
    
    function loadNext() {
      const start = currentChunk * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      const reader = new FileReader()
      reader.onload = (e) => {
        spark.append(e.target!.result as ArrayBuffer)
        currentChunk++
        if (currentChunk < chunks) {
          loadNext()
        } else {
          resolve(spark.end())
        }
      }
      reader.onerror = reject
      reader.readAsArrayBuffer(file.slice(start, end))
    }
    
    loadNext()
  })
}

// 消息处理
self.onmessage = async (e: MessageEvent) => {
  const { type, file, fileId } = e.data
  
  try {
    if (type === 'md5') {
      const hash = await computeMD5(file)
      self.postMessage({ type: 'md5', fileId, hash })
    } else if (type === 'phash') {
      // 读取图片计算pHash
      const bitmap = await createImageBitmap(file)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      const phash = computePhash(imageData.data, bitmap.width, bitmap.height)
      self.postMessage({ type: 'phash', fileId, phash })
    }
  } catch (err) {
    self.postMessage({ type: 'error', fileId, error: (err as Error).message })
  }
}
