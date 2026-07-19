/**
 * IndexedDB 持久化缓存（万级图片规模化必需）
 *
 * 三层存储：
 *  - hashes:    md5 -> 感知哈希（phash/dhash/ahash）+ 尺寸。跨路径同内容复用（内容寻址）。
 *  - quality:   md5 -> 质量检查结果。质量检查无需重复解码计算。
 *  - statIndex: "path::size" -> md5。主线程可「免读字节」快速判定某文件是否已缓存，
 *               reopen/重跑时直接命中，跳过昂贵的磁盘读取与 Worker 计算。
 *
 * 主线程与 Worker 各自持有一个连接，并发安全（IndexedDB 支持多连接）。
 */
import type { QualityResult } from '../quality/types'
import type { EmbeddingRecord } from '../embed/embedTypes'
import type { DatasetVersionManifest } from '../dataset/versioning'
import type { WorkspaceConfig } from '../workspace/workspaceStore'
import type { PersistedHandles } from '../workspace/workspaceStore'

const DB_NAME = 'dataset-manager-cache'
const DB_VERSION = 5
const STORE_HASHES = 'hashes'
const STORE_QUALITY = 'quality'
const STORE_STAT = 'statIndex'
const STORE_EMBEDDINGS = 'embeddings'
const STORE_VERSIONS = 'versions'
const STORE_WORKSPACE = 'workspace'
const STORE_HANDLES = 'handles'
const STORE_AL = 'alState'

export interface CachedHash {
  md5: string
  phash: string
  dhash: string
  ahash: string
  width: number
  height: number
}

export interface CachedQuality {
  md5: string
  result: QualityResult
}

interface StatIndexEntry {
  key: string
  md5: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_HASHES)) {
        db.createObjectStore(STORE_HASHES, { keyPath: 'md5' })
      }
      if (!db.objectStoreNames.contains(STORE_QUALITY)) {
        db.createObjectStore(STORE_QUALITY, { keyPath: 'md5' })
      }
      if (!db.objectStoreNames.contains(STORE_STAT)) {
        db.createObjectStore(STORE_STAT, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_EMBEDDINGS)) {
        db.createObjectStore(STORE_EMBEDDINGS, { keyPath: 'md5' })
      }
      if (!db.objectStoreNames.contains(STORE_VERSIONS)) {
        db.createObjectStore(STORE_VERSIONS, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_WORKSPACE)) {
        db.createObjectStore(STORE_WORKSPACE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        // 浏览器端目录句柄（FileSystemDirectoryHandle）可结构化克隆直接存入 IDB，
        // 用于跨会话持久化「多数据集结构配置」，再次打开时重新申请权限即可复用。
        db.createObjectStore(STORE_HANDLES, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_AL)) {
        db.createObjectStore(STORE_AL, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function store(
  db: IDBDatabase,
  name: string,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(name, mode).objectStore(name)
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 构造 stat 索引键：路径 + 尺寸（尺寸变化即视为文件已改动，缓存失效） */
export function buildStatKey(path: string, size: number): string {
  return `${path}::${size}`
}

export async function getHash(md5: string): Promise<CachedHash | undefined> {
  const db = await openDb()
  return reqToPromise<CachedHash | undefined>(
    store(db, STORE_HASHES, 'readonly').get(md5) as IDBRequest<CachedHash | undefined>,
  )
}

export async function putHash(rec: CachedHash): Promise<void> {
  const db = await openDb()
  await reqToPromise(store(db, STORE_HASHES, 'readwrite').put(rec))
}

/** 批量写哈希（单事务），供 Worker 内累积后提交，避免逐条开启事务 */
export async function putHashBatch(records: CachedHash[]): Promise<void> {
  if (records.length === 0) return
  const db = await openDb()
  const tx = db.transaction(STORE_HASHES, 'readwrite')
  const s = tx.objectStore(STORE_HASHES)
  for (const r of records) s.put(r)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function getQuality(md5: string): Promise<CachedQuality | undefined> {
  const db = await openDb()
  return reqToPromise<CachedQuality | undefined>(
    store(db, STORE_QUALITY, 'readonly').get(md5) as IDBRequest<CachedQuality | undefined>,
  )
}

export async function putQuality(rec: CachedQuality): Promise<void> {
  const db = await openDb()
  await reqToPromise(store(db, STORE_QUALITY, 'readwrite').put(rec))
}

/** 批量写质量结果（单事务），供 Worker 内累积后提交，避免逐条开启事务 */
export async function putQualityBatch(records: CachedQuality[]): Promise<void> {
  if (records.length === 0) return
  const db = await openDb()
  const tx = db.transaction(STORE_QUALITY, 'readwrite')
  const s = tx.objectStore(STORE_QUALITY)
  for (const r of records) s.put(r)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function getStatMd5(key: string): Promise<string | undefined> {
  const db = await openDb()
  const rec = await reqToPromise<StatIndexEntry | undefined>(
    store(db, STORE_STAT, 'readonly').get(key) as IDBRequest<StatIndexEntry | undefined>,
  )
  return rec?.md5
}

export async function putStat(key: string, md5: string): Promise<void> {
  const db = await openDb()
  await reqToPromise(store(db, STORE_STAT, 'readwrite').put({ key, md5 }))
}

/** 批量写 stat 索引（单事务），用于万级文件避免逐条开启事务 */
export async function putStatBatch(
  entries: { key: string; md5: string }[],
): Promise<void> {
  if (entries.length === 0) return
  const db = await openDb()
  const tx = db.transaction(STORE_STAT, 'readwrite')
  const s = tx.objectStore(STORE_STAT)
  for (const e of entries) s.put({ key: e.key, md5: e.md5 })
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** 批量查 stat 索引（单事务），返回 statKey -> md5 */
export async function getStatMd5Batch(
  keys: string[],
): Promise<Map<string, string>> {
  const db = await openDb()
  const s = store(db, STORE_STAT, 'readonly')
  const out = new Map<string, string>()
  await Promise.all(
    keys.map(async (k) => {
      const rec = await reqToPromise<StatIndexEntry | undefined>(
        s.get(k) as IDBRequest<StatIndexEntry | undefined>,
      )
      if (rec) out.set(k, rec.md5)
    }),
  )
  return out
}

/** 批量查哈希（单事务），返回 md5 -> CachedHash */
export async function getHashBatch(
  md5s: string[],
): Promise<Map<string, CachedHash>> {
  const db = await openDb()
  const s = store(db, STORE_HASHES, 'readonly')
  const out = new Map<string, CachedHash>()
  await Promise.all(
    md5s.map(async (m) => {
      const rec = await reqToPromise<CachedHash | undefined>(
        s.get(m) as IDBRequest<CachedHash | undefined>,
      )
      if (rec) out.set(m, rec)
    }),
  )
  return out
}

/** 批量查质量结果（单事务），返回 md5 -> CachedQuality */
export async function getQualityBatch(
  md5s: string[],
): Promise<Map<string, CachedQuality>> {
  const db = await openDb()
  const s = store(db, STORE_QUALITY, 'readonly')
  const out = new Map<string, CachedQuality>()
  await Promise.all(
    md5s.map(async (m) => {
      const rec = await reqToPromise<CachedQuality | undefined>(
        s.get(m) as IDBRequest<CachedQuality | undefined>,
      )
      if (rec) out.set(m, rec)
    }),
  )
  return out
}

/* ============ 特征嵌入缓存（P2 数据策展） ============ */

export async function getEmbedding(md5: string): Promise<EmbeddingRecord | undefined> {
  const db = await openDb()
  return reqToPromise<EmbeddingRecord | undefined>(
    store(db, STORE_EMBEDDINGS, 'readonly').get(md5) as IDBRequest<EmbeddingRecord | undefined>,
  )
}

/** 批量写特征（单事务），累积到阈值后提交，避免逐条开事务 */
export async function putEmbeddingBatch(records: EmbeddingRecord[]): Promise<void> {
  if (records.length === 0) return
  const db = await openDb()
  const tx = db.transaction(STORE_EMBEDDINGS, 'readwrite')
  const s = tx.objectStore(STORE_EMBEDDINGS)
  for (const r of records) s.put(r)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** 批量查特征（单事务），返回 md5 -> 记录（供主线程 statIndex 预筛免读字节） */
export async function getEmbeddingBatch(
  md5s: string[],
): Promise<Map<string, EmbeddingRecord>> {
  const db = await openDb()
  const s = store(db, STORE_EMBEDDINGS, 'readonly')
  const out = new Map<string, EmbeddingRecord>()
  await Promise.all(
    md5s.map(async (m) => {
      const rec = await reqToPromise<EmbeddingRecord | undefined>(
        s.get(m) as IDBRequest<EmbeddingRecord | undefined>,
      )
      if (rec) out.set(m, rec)
    }),
  )
  return out
}

/** 游标扫描全部特征：返回 md5 -> 向量（供相似检索在内存做暴力余弦） */
export async function getAllEmbeddings(): Promise<Map<string, Float32Array>> {
  const db = await openDb()
  const s = store(db, STORE_EMBEDDINGS, 'readonly')
  const out = new Map<string, Float32Array>()
  return new Promise((resolve, reject) => {
    const req = s.openCursor()
    req.onsuccess = () => {
      const cur = req.result
      if (cur) {
        const rec = cur.value as EmbeddingRecord
        out.set(rec.md5, rec.vec)
        cur.continue()
      } else {
        resolve(out)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

/** 清空全部缓存 */
export async function clearCache(): Promise<void> {
  const db = await openDb()
  await reqToPromise(store(db, STORE_HASHES, 'readwrite').clear())
  await reqToPromise(store(db, STORE_QUALITY, 'readwrite').clear())
  await reqToPromise(store(db, STORE_STAT, 'readwrite').clear())
  await reqToPromise(store(db, STORE_EMBEDDINGS, 'readwrite').clear())
  await reqToPromise(store(db, STORE_VERSIONS, 'readwrite').clear())
  await reqToPromise(store(db, STORE_WORKSPACE, 'readwrite').clear())
  await reqToPromise(store(db, STORE_HANDLES, 'readwrite').clear())
}

/* ============ 数据集版本清单（迭代间 diff） ============ */
// 键为 `${datasetKey}::${versionId}`，值内联 key 字段便于 range 扫描。

function versionKeyOf(datasetKey: string, id: string): string {
  return `${datasetKey}::${id}`
}

export async function putVersionManifest(
  datasetKey: string,
  manifest: DatasetVersionManifest,
): Promise<void> {
  const db = await openDb()
  await reqToPromise(
    store(db, STORE_VERSIONS, 'readwrite').put({
      key: versionKeyOf(datasetKey, manifest.id),
      ...manifest,
    }),
  )
}

export async function getVersionManifest(
  datasetKey: string,
  id: string,
): Promise<DatasetVersionManifest | undefined> {
  const db = await openDb()
  const rec = await reqToPromise<any>(
    store(db, STORE_VERSIONS, 'readonly').get(versionKeyOf(datasetKey, id)),
  )
  return rec ? stripVersionKey(rec) : undefined
}

/** 列出某数据集的全部版本（按创建时间升序） */
export async function listVersionManifests(
  datasetKey: string,
): Promise<DatasetVersionManifest[]> {
  const db = await openDb()
  const s = store(db, STORE_VERSIONS, 'readonly')
  const out: DatasetVersionManifest[] = []
  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.bound(
      `${datasetKey}::`,
      `${datasetKey}::\uFFFF`,
    )
    const req = s.openCursor(range)
    req.onsuccess = () => {
      const cur = req.result
      if (cur) {
        out.push(stripVersionKey(cur.value))
        cur.continue()
      } else {
        out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        resolve(out)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

export async function deleteVersionManifest(
  datasetKey: string,
  id: string,
): Promise<void> {
  const db = await openDb()
  await reqToPromise(
    store(db, STORE_VERSIONS, 'readwrite').delete(versionKeyOf(datasetKey, id)),
  )
}

/* ============ 工作区结构配置（多数据集持久化） ============ */
// workspace：单条记录（id='current'）存整份 WorkspaceConfig（JSON 可序列化）。
// handles：浏览器端目录句柄（FileSystemDirectoryHandle，结构化克隆可存），
//          按 handleKey 索引，供跨会话恢复数据集。Tauri 端用绝对路径，不写此表。

const WORKSPACE_KEY = 'current'

export async function saveWorkspaceConfig(cfg: WorkspaceConfig): Promise<void> {
  const db = await openDb()
  await reqToPromise(
    store(db, STORE_WORKSPACE, 'readwrite').put({ id: WORKSPACE_KEY, config: cfg }),
  )
}

export async function loadWorkspaceConfig(): Promise<WorkspaceConfig | null> {
  const db = await openDb()
  const rec = await reqToPromise<any>(
    store(db, STORE_WORKSPACE, 'readonly').get(WORKSPACE_KEY),
  )
  return rec && rec.config ? (rec.config as WorkspaceConfig) : null
}

export async function clearWorkspaceConfig(): Promise<void> {
  const db = await openDb()
  await reqToPromise(store(db, STORE_WORKSPACE, 'readwrite').delete(WORKSPACE_KEY))
  await reqToPromise(store(db, STORE_HANDLES, 'readwrite').clear())
}

export async function saveHandles(
  id: string,
  imageHandle: FileSystemDirectoryHandle | null,
  labelHandle: FileSystemDirectoryHandle | null,
): Promise<void> {
  if (!imageHandle) return
  const db = await openDb()
  await reqToPromise(
    store(db, STORE_HANDLES, 'readwrite').put({ id, imageHandle, labelHandle }),
  )
}

export async function loadHandles(
  id: string,
): Promise<PersistedHandles | undefined> {
  const db = await openDb()
  return reqToPromise<PersistedHandles | undefined>(
    store(db, STORE_HANDLES, 'readonly').get(id) as IDBRequest<PersistedHandles | undefined>,
  )
}

function stripVersionKey(rec: any): DatasetVersionManifest {
  const { key, ...rest } = rec
  void key
  return rest as DatasetVersionManifest
}

export interface CacheStats {
  /** hashes 表中已缓存感知哈希的文件数 */
  hashes: number
  /** quality 表中已缓存质量结果的文件数 */
  quality: number
  /** statIndex 表中 path::size -> md5 索引条数 */
  statIndex: number
  /** embeddings 表中已缓存特征向量的文件数 */
  embeddings: number
  /** 预估占用字节数（按各 store 平均单条字节估算，非精确值） */
  estimatedBytes: number
}

// 各 store 单条记录的平均字节估算（用于「缓存占用」展示，非精确值）：
//  - hashes：{md5(32)+phash/dhash/ahash(各 64)+width/height} ≈ 280B
//  - quality：{md5 + QualityResult(JSON，含分数/问题数组)} ≈ 420B
//  - statIndex：{key("path::size") + md5} ≈ 200B
//  - embeddings：{md5 + Float32(1280 维)*4B} ≈ 5.4KB
const AVG_HASH_BYTES = 280
const AVG_QUALITY_BYTES = 420
const AVG_STAT_BYTES = 200
const AVG_EMBED_BYTES = 5400

/** 读取各表的计数与预估占用，用于设置面板「缓存可视化」展示 */
export async function getCacheStats(): Promise<CacheStats> {
  const db = await openDb()
  const [hashes, quality, statIndex, embeddings] = await Promise.all([
    reqToPromise(store(db, STORE_HASHES, 'readonly').count()),
    reqToPromise(store(db, STORE_QUALITY, 'readonly').count()),
    reqToPromise(store(db, STORE_STAT, 'readonly').count()),
    reqToPromise(store(db, STORE_EMBEDDINGS, 'readonly').count()),
  ])
  const estimatedBytes =
    hashes * AVG_HASH_BYTES +
    quality * AVG_QUALITY_BYTES +
    statIndex * AVG_STAT_BYTES +
    embeddings * AVG_EMBED_BYTES
  return { hashes, quality, statIndex, embeddings, estimatedBytes }
}

/* ============ 主动学习预测覆盖层持久化 ============ */
// alState：按 datasetKey 存整份 AlPersistedState（JSON 可序列化），
//          双端通用；Tauri 端额外落盘到数据集根侧车（见 activeLearning/persistence.ts）。

/**
 * 写入主动学习状态快照。
 * @param datasetKey datasetKeyOf(ds)，Tauri=根绝对路径，浏览器=数据集名
 * @param state 已序列化的 AlPersistedState
 */
export async function putAlState(datasetKey: string, state: unknown): Promise<void> {
  const db = await openDb()
  await reqToPromise(store(db, STORE_AL, 'readwrite').put({ key: datasetKey, state }))
}

/** 读取主动学习状态快照；不存在时返回 undefined */
export async function getAlState(datasetKey: string): Promise<unknown | undefined> {
  const db = await openDb()
  const rec = await reqToPromise<any>(
    store(db, STORE_AL, 'readonly').get(datasetKey) as IDBRequest<any>,
  )
  return rec ? rec.state : undefined
}

/** 删除主动学习状态快照（清空预测覆盖层时调用） */
export async function deleteAlState(datasetKey: string): Promise<void> {
  const db = await openDb()
  await reqToPromise(store(db, STORE_AL, 'readwrite').delete(datasetKey))
}
