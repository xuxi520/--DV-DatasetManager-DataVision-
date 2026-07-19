/**
 * 特征嵌入模块公共类型（P2 数据策展护城河）
 * - EmbeddingRecord：内容寻址（md5）存储的 L2 归一化特征向量。
 * - SimilarHit：相似检索命中（余弦相似度 [0,1]）。
 */

/** 内容寻址的特征向量记录（md5 为内容键，跨路径同图复用） */
export interface EmbeddingRecord {
  md5: string
  /** 向量维度（如 EfficientNet-B0 特征 = 1280） */
  dim: number
  /** L2 归一化后的特征向量 */
  vec: Float32Array
}

/** 相似检索单条命中 */
export interface SimilarHit {
  /** 命中文档的 fileId（当前会话内有效） */
  fileId: string
  md5: string
  /** 余弦相似度 [-1,1]，归一化向量下即 = 点积，范围 [0,1] */
  score: number
}

/** Worker 入参 */
export interface EmbedRequest {
  id: string
  bytes: Uint8Array
  /** 可选复用主线程已算的 md5（省一次全文件哈希） */
  md5?: string
}

/** 实际选用的推理后端与线程信息 */
export interface EmbedBackend {
  ep: 'webgpu' | 'wasm' | 'unknown'
  /** 实际生效的 wasm 内部线程数（webgpu 模式恒为 0） */
  threads: number
}

/** Worker 回包 */
export interface EmbedResponse {
  id: string
  ok: boolean
  md5?: string
  /** 序列化后的特征向量（Float32 内容） */
  vec?: number[] | Float32Array
  error?: string
  /** 命中 IndexedDB 内容缓存（跳过解码与推理） */
  cached?: boolean
  /** 实际使用的推理后端（首条成功响应即确定，后续复用） */
  backend?: EmbedBackend
  /** 可选：本 Worker 使用的运行时配置（用于诊断） */
  config?: { preferWebGPU: boolean; wasmThreads: number }
}
