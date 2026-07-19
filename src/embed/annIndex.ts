// ANN 共享类型与常量（索引构建/检索逻辑已迁至 ann.worker.ts，主线程仅经 annClient 调用）。
export interface AnnEntry {
  md5: string
  fileId: string
  vec: Float32Array
}

export interface AnnHit {
  label: number
  md5: string
  fileId: string
  score: number
}

// HNSW 调参（与 ann.worker.ts 保持一致）
export const ANN_M = 16
export const ANN_EF_CONSTRUCTION = 200
export const ANN_RANDOM_SEED = 100
