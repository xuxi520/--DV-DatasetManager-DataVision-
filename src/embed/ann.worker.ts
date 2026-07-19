// ANN 索引 Worker：在独立线程构建并持有 HNSW 内存索引，主线程只发 build/search/reset。
// 这样重活（addItems ≈ O(N log N)）不阻塞 UI，useEmbeddings 保持为协调者而非上帝组件。
// hnswlib 惰性动态 import（Worker 本身仅在首次 ANN 检索时被实例化，wasm 进一步懒到首次构建）。
import type { AnnEntry, AnnHit } from './annIndex'
import { ANN_M, ANN_EF_CONSTRUCTION, ANN_RANDOM_SEED } from './annIndex'

type HnswModule = Awaited<ReturnType<typeof import('hnswlib-wasm')['loadHnswlib']>>
type HnswIndex = InstanceType<HnswModule['HierarchicalNSW']>

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

let libPromise: Promise<HnswModule> | null = null
function getLib(): Promise<HnswModule> {
  if (!libPromise) libPromise = import('hnswlib-wasm').then((m) => m.loadHnswlib())
  return libPromise
}

// 索引状态：仅在版本变化时重建
let index: HnswIndex | null = null
let labelToEntry = new Map<number, AnnEntry>()
let currentVersion = -1
let currentDim = 0

function resetState(): void {
  index = null
  labelToEntry = new Map<number, AnnEntry>()
  currentVersion = -1
  currentDim = 0
}

interface BuildMsg {
  type: 'build'
  reqId: number
  version: number
  dim: number
  entries: AnnEntry[]
}
interface SearchMsg {
  type: 'search'
  reqId: number
  query: Float32Array
  topK: number
  excludeMd5: string
}
interface ResetMsg {
  type: 'reset'
  reqId: number
}

async function doBuild(version: number, dim: number, entries: AnnEntry[]): Promise<void> {
  const lib = await getLib()
  const idx = new lib.HierarchicalNSW('ip', dim, '') as HnswIndex
  const maxElements = Math.max(entries.length, 1)
  idx.initIndex(maxElements, ANN_M, ANN_EF_CONSTRUCTION, ANN_RANDOM_SEED)
  const items = entries.map((e) => e.vec)
  const labels = idx.addItems(items, false)
  const map = new Map<number, AnnEntry>()
  labels.forEach((label, i) => {
    map.set(label, entries[i])
  })
  labelToEntry = map
  index = idx
  currentVersion = version
  currentDim = dim
}

ctx.onmessage = async (e: MessageEvent<BuildMsg | SearchMsg | ResetMsg>) => {
  const msg = e.data
  try {
    if (msg.type === 'build') {
      // 同版本且维度一致则复用既有索引
      if (index && msg.version === currentVersion && msg.dim === currentDim) {
        ctx.postMessage({ type: 'built', reqId: msg.reqId, ok: true, reused: true })
        return
      }
      await doBuild(msg.version, msg.dim, msg.entries)
      ctx.postMessage({ type: 'built', reqId: msg.reqId, ok: true, reused: false })
    } else if (msg.type === 'search') {
      if (!index) {
        ctx.postMessage({ type: 'result', reqId: msg.reqId, ok: false, error: 'no-index' })
        return
      }
      index.setEfSearch(Math.max(msg.topK * 2, 32))
      const res = index.searchKnn(msg.query, msg.topK + 1, undefined)
      const hits: AnnHit[] = []
      for (let i = 0; i < res.neighbors.length; i++) {
        const entry = labelToEntry.get(res.neighbors[i])
        if (!entry) continue
        if (entry.md5 === msg.excludeMd5) continue
        hits.push({
          label: res.neighbors[i],
          md5: entry.md5,
          fileId: entry.fileId,
          score: 1 - res.distances[i]
        })
      }
      ctx.postMessage({ type: 'result', reqId: msg.reqId, ok: true, hits })
    } else if (msg.type === 'reset') {
      resetState()
      ctx.postMessage({ type: 'reset-done', reqId: msg.reqId })
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (msg.type === 'build') {
      ctx.postMessage({ type: 'built', reqId: msg.reqId, ok: false, error })
    } else if (msg.type === 'search') {
      ctx.postMessage({ type: 'result', reqId: msg.reqId, ok: false, error })
    }
  }
}
