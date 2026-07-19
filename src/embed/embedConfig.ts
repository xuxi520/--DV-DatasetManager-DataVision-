/**
 * 特征抽取运行时配置（主线程单例 + localStorage 持久化）
 *
 * 注意：配置在「主线程」读取与修改，并通过 Worker 消息下发给 embed.worker。
 * 原因：Web Worker 上下文没有 localStorage / navigator 的部分 API 受限，
 * 无法在 Worker 内直接持久化或读取偏好，故统一由主线程持有并在派发任务时携带。
 *
 * 字段：
 * - preferWebGPU：优先用 WebGPU 后端做 GPU 推理，失败自动回退 wasm（CPU）。
 * - wasmThreads：wasm(CPU) 后端内部线程数。默认 1（单线程，免 SharedArrayBuffer /
 *   COOP-COEP 跨域隔离头，Tauri 与静态托管下最稳）；>1 需 SharedArrayBuffer，
 *   环境不具备时会被 embedModel 自动收敛回 1。
 */
export interface EmbedRuntimeConfig {
  /** 优先 WebGPU（GPU 加速），不可用 / 失败时回退 wasm */
  preferWebGPU: boolean
  /** wasm 后端内部线程数；1=单线程（默认）。多线程需 SharedArrayBuffer */
  wasmThreads: number
}

const STORAGE_KEY = 'dv.embed.config.v1'

const DEFAULTS: EmbedRuntimeConfig = {
  preferWebGPU: true,
  wasmThreads: 1,
}

let current: EmbedRuntimeConfig = load()

function load(): EmbedRuntimeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<EmbedRuntimeConfig>
      return {
        preferWebGPU:
          typeof parsed.preferWebGPU === 'boolean'
            ? parsed.preferWebGPU
            : DEFAULTS.preferWebGPU,
        wasmThreads:
          typeof parsed.wasmThreads === 'number' && parsed.wasmThreads >= 1
            ? Math.floor(parsed.wasmThreads)
            : DEFAULTS.wasmThreads,
      }
    }
  } catch {
    /* 忽略损坏的存储，回退默认 */
  }
  return { ...DEFAULTS }
}

export function getEmbedConfig(): EmbedRuntimeConfig {
  return { ...current }
}

export function setEmbedConfig(patch: Partial<EmbedRuntimeConfig>): EmbedRuntimeConfig {
  current = {
    preferWebGPU:
      typeof patch.preferWebGPU === 'boolean'
        ? patch.preferWebGPU
        : current.preferWebGPU,
    wasmThreads:
      typeof patch.wasmThreads === 'number' && patch.wasmThreads >= 1
        ? Math.floor(patch.wasmThreads)
        : current.wasmThreads,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    /* 隐私模式 / 配额满时不阻塞 */
  }
  return { ...current }
}
