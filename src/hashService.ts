/**
 * 哈希计算服务 - 管理WebWorker通信
 */
import type { ImageFile } from './types'

type HashCallback = (fileId: string, hash: string, phash: string) => void
type ProgressCallback = (processed: number, total: number) => void

class HashService {
  private worker: Worker | null = null
  private callbacks = new Map<string, HashCallback>()
  private onProgress: ProgressCallback | null = null
  private processed = 0
  private total = 0

  constructor() {
    this.initWorker()
  }

  private initWorker() {
    // 创建内联Worker（避免单独文件）
    const workerCode = `
      importScripts('https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js');
      
      function toGray(data, width, height) {
        const gray = new Array(width * height);
        for (let i = 0; i < width * height; i++) {
          const offset = i * 4;
          gray[i] = Math.round(0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]);
        }
        return gray;
      }
      
      function resizeGray(src, sw, sh, dw, dh) {
        const dst = new Array(dw * dh);
        const xRatio = sw / dw;
        const yRatio = sh / dh;
        for (let y = 0; y < dh; y++) {
          for (let x = 0; x < dw; x++) {
            const srcX = Math.floor(x * xRatio);
            const srcY = Math.floor(y * yRatio);
            dst[y * dw + x] = src[srcY * sw + srcX];
          }
        }
        return dst;
      }
      
      function computePhash(data, width, height) {
        const gray = toGray(data, width, height);
        const small = resizeGray(gray, width, height, 32, 32);
        let avg = 0;
        let count = 0;
        const dct = [];
        for (let y = 0; y < 8; y++) {
          dct[y] = [];
          for (let x = 0; x < 8; x++) {
            let sum = 0;
            for (let i = 0; i < 32; i++) {
              for (let j = 0; j < 32; j++) {
                sum += small[i * 32 + j] * 
                  Math.cos(Math.PI * x * (2 * i + 1) / 64) * 
                  Math.cos(Math.PI * y * (2 * j + 1) / 64);
              }
            }
            dct[y][x] = sum;
            if (!(x === 0 && y === 0)) {
              avg += sum;
              count++;
            }
          }
        }
        avg /= count;
        let hash = '';
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            hash += dct[y][x] > avg ? '1' : '0';
          }
        }
        return hash;
      }
      
      self.onmessage = async function(e) {
        const { type, fileId, fileData } = e.data;
        try {
          if (type === 'compute') {
            const file = new File([fileData], 'temp');
            const bitmap = await createImageBitmap(file);
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
            const phash = computePhash(imageData.data, bitmap.width, bitmap.height);
            
            // 计算MD5
            const spark = new SparkMD5.ArrayBuffer();
            spark.append(fileData);
            const hash = spark.end();
            
            self.postMessage({ fileId, hash, phash });
          }
        } catch (err) {
          self.postMessage({ fileId, error: err.message });
        }
      };
    `
    
    const blob = new Blob([workerCode], { type: 'application/javascript' })
    this.worker = new Worker(URL.createObjectURL(blob))
    
    this.worker.onmessage = (e) => {
      const { fileId, hash, phash } = e.data
      if (fileId && this.callbacks.has(fileId)) {
        this.callbacks.get(fileId)!(fileId, hash, phash)
        this.callbacks.delete(fileId)
        this.processed++
        if (this.onProgress) {
          this.onProgress(this.processed, this.total)
        }
      }
    }
  }

  async computeHashes(
    files: ImageFile[],
    onFileDone: HashCallback,
    onProgress: ProgressCallback
  ) {
    this.processed = 0
    this.total = files.length
    this.onProgress = onProgress

    for (const file of files) {
      if (!file.blob) continue
      
      this.callbacks.set(file.id, onFileDone)
      
      const arrayBuffer = await file.blob.arrayBuffer()
      this.worker!.postMessage({
        type: 'compute',
        fileId: file.id,
        fileData: arrayBuffer
      }, [arrayBuffer])
    }
  }

  destroy() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }
}

export const hashService = new HashService()
