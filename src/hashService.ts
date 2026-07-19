/**
 * 哈希计算服务（UI 门面）
 * 委托给 dedup/hashEngine（WorkerPool 并行 + IndexedDB 双层缓存）。
 * 取代原「内联 CDN Worker」实现：原实现单 Worker 顺序、且依赖 jsdelivr 拉取 spark-md5，
 * 在桌面端/离线环境不可用；现统一走 hashEngine，浏览器与 Tauri 双端一致。
 */
import type { ImageFile } from './types'
import { computeHashesForFiles, destroyHashWorker } from './dedup/hashEngine'
import { getFileBytes } from './dedup/fileOps'

type HashCallback = (fileId: string, hash: string, phash: string) => void
type ProgressCallback = (processed: number, total: number, cacheHits: number) => void

class HashService {
  async computeHashes(
    files: ImageFile[],
    onFileDone: HashCallback,
    onProgress: ProgressCallback,
    shouldCancel?: () => boolean,
  ) {
    const jobs = files.map((f) => ({
      id: f.id,
      path: f.path,
      size: f.size,
      // 环境分发读取（浏览器读 blob/sourceFile，Tauri 读本地文件）
      getBytes: () => getFileBytes(f),
    }))
    await computeHashesForFiles(
      jobs,
      (id, h) => {
        if (h) onFileDone(id, h.md5, h.phash)
      },
      onProgress,
      shouldCancel,
    )
  }

  destroy() {
    destroyHashWorker()
  }
}

export const hashService = new HashService()
