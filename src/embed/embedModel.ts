/**
 * 本地特征抽取（onnxruntime-web，WASM）
 *
 * 设计目标：全程本地推理、离线可用，契合「本地优先 / 隐私」定位。
 * - 模型：EfficientNet-B0 特征（或任意输出为特征向量的 ONNX），放置于 public/models/。
 *   注意：需使用「特征提取」变体（输出 1280 维特征，而非 1000 类分类 logits）；
 *   本模块对输出维度不做假设，直接 L2 归一化后作为特征使用。
 * - 预处理：cover resize 到 224×224，RGB / CHW，ImageNet 均值方差归一化（与训练一致）。
 * - wasm 路径：通过 Vite `?url` 导入 onnxruntime-web 的后端（.mjs）与权重（.wasm），
 *   以对象形式 `{ mjs, wasm }` 传给 `ort.env.wasm.wasmPaths`，由打包工具作为静态资源提供，
 *   避免 Vite dev 禁止 import public 目录下 JS 的冲突（无需把任何文件放进 public/onnx）。
 * - 后端策略：优先 WebGPU（GPU 加速）；不可用时 / 初始化失败时自动回退 wasm(CPU)。
 * - wasm(CPU) 后端内部线程数可配：默认 1（单线程，免 SharedArrayBuffer / COOP-COEP
 *   跨域隔离头，在 Tauri 自定义协议与静态托管下最稳）；>1 需环境提供 SharedArrayBuffer，
 *   否则会被自动收敛回 1（见 loadModel 内 sharedArrayBufferAvailable 判断）。
 * - 配置由主线程持有并通过 Worker 消息下发（Web Worker 无 localStorage），
 *   故本模块只接受「已解析好的配置对象」，不直接读取存储。
 */
import * as ort from 'onnxruntime-web'
// 通过 Vite ?url 导入，将 ort 后端（.mjs）与权重（.wasm）作为静态资源交给打包工具提供。
// 这样彻底规避 Vite dev「禁止 import public/ 下 JS」的冲突，也无需手动把文件复制进 public/onnx。
import ortWasmMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import ortWasmWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'
import type { EmbedRuntimeConfig } from './embedConfig'
import type { EmbedBackend } from './embedTypes'

const MODEL_URL = `${import.meta.env.BASE_URL}models/efficientnet-b0.onnx`
const TARGET_SIZE = 224
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

let session: ort.InferenceSession | null = null
let inputName = ''
let outputName = ''

let initPromise: Promise<void> | null = null

/** 实际选用的后端与线程信息（供 UI 展示 / 调试） */
let backend: EmbedBackend = { ep: 'unknown', threads: 0 }

const DEFAULT_CONFIG: EmbedRuntimeConfig = { preferWebGPU: true, wasmThreads: 1 }

/** 环境是否支持 SharedArrayBuffer（多线程 wasm 的前提，需 COOP/COEP） */
function sharedArrayBufferAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
}

/** WebGPU 后端可用性：navigator.gpu 且能 request 到 adapter */
async function webgpuAvailable(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } })
    .gpu
  if (!gpu || typeof gpu.requestAdapter !== 'function') return false
  try {
    const adapter = await gpu.requestAdapter()
    return !!adapter
  } catch {
    return false
  }
}

/**
 * 加载并缓存 ONNX 会话（幂等，多 Worker 各自持有一份）。
 * @param config 主线程下发的运行时配置；首次调用方决定生效配置，后续调用复用。
 */
export function loadModel(config?: EmbedRuntimeConfig): Promise<void> {
  if (initPromise) return initPromise
  const cfg = config ?? DEFAULT_CONFIG
  initPromise = (async () => {
    if (!session) {
      ort.env.wasm.wasmPaths = {
        mjs: ortWasmMjsUrl,
        wasm: ortWasmWasmUrl,
      }
      // wasm 内部线程数：配置 >1 且环境提供 SAB 才生效，否则收敛为单线程。
      const wantThreads = Math.max(1, Math.floor(cfg.wasmThreads))
      const threads = wantThreads > 1 && sharedArrayBufferAvailable() ? wantThreads : 1
      ort.env.wasm.numThreads = threads

      // 后端选择：优先 WebGPU，失败回退 wasm。
      let ep: 'webgpu' | 'wasm' = 'wasm'
      try {
        if (cfg.preferWebGPU && (await webgpuAvailable())) {
          session = await ort.InferenceSession.create(MODEL_URL, {
            executionProviders: ['webgpu'],
            graphOptimizationLevel: 'all',
          })
          ep = 'webgpu'
        } else {
          session = await ort.InferenceSession.create(MODEL_URL, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
          })
        }
      } catch (err) {
        if (ep === 'wasm') throw err
        // WebGPU 初始化失败：回退到 wasm
        console.warn('[embed] WebGPU 初始化失败，回退 wasm(CPU)：', err)
        session = await ort.InferenceSession.create(MODEL_URL, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        })
        ep = 'wasm'
      }
      inputName = session.inputNames[0]
      outputName = session.outputNames[0]
      backend = { ep, threads: ep === 'wasm' ? ort.env.wasm.numThreads : 0 }
    }
  })()
  return initPromise
}

/** 返回实际选用的后端与线程信息（供 UI 展示） */
export function getEmbedBackend(): EmbedBackend {
  return { ...backend }
}

/** 取模型输入张量名（供上层/调试） */
export function modelInputName(): string {
  return inputName
}

function normalize(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

/**
 * 从图片字节抽取 L2 归一化特征向量。
 * 解码走 createImageBitmap -> OffscreenCanvas（与 quality.worker 同模板）。
 */
export async function embedImageBytes(bytes: Uint8Array): Promise<Float32Array> {
  await loadModel()
  const file = new File([bytes as Uint8Array], 'e')
  const bitmap = await createImageBitmap(file)

  // cover resize：短边填满，避免拉伸变形
  const scale = Math.max(TARGET_SIZE / bitmap.width, TARGET_SIZE / bitmap.height)
  const dw = Math.round(bitmap.width * scale)
  const dh = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(dw, dh)
  const c = canvas.getContext('2d')!
  c.drawImage(bitmap, 0, 0, dw, dh)
  // 居中裁剪到 224×224
  const sx = Math.max(0, Math.floor((dw - TARGET_SIZE) / 2))
  const sy = Math.max(0, Math.floor((dh - TARGET_SIZE) / 2))
  const data = c.getImageData(sx, sy, TARGET_SIZE, TARGET_SIZE).data

  const input = new Float32Array(1 * 3 * TARGET_SIZE * TARGET_SIZE)
  const plane = TARGET_SIZE * TARGET_SIZE
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4] / 255
    const g = data[i * 4 + 1] / 255
    const b = data[i * 4 + 2] / 255
    input[i] = (r - MEAN[0]) / STD[0]
    input[i + plane] = (g - MEAN[1]) / STD[1]
    input[i + 2 * plane] = (b - MEAN[2]) / STD[2]
  }

  const tensor = new ort.Tensor('float32', input, [1, 3, TARGET_SIZE, TARGET_SIZE])
  const feeds: Record<string, ort.Tensor> = {}
  feeds[inputName] = tensor
  const results = await session!.run(feeds)
  const raw = results[outputName].data as Float32Array
  return normalize(raw)
}
