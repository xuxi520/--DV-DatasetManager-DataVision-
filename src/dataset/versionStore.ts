/**
 * 数据集版本清单存储后端（双端）
 *
 * - IDB（dataset-manager-cache / versions）：全量版本历史，浏览器与 Tauri 通用，
 *   按 datasetKey（Tauri=根目录绝对路径；浏览器=数据集名）建索引。
 * - Tauri 落盘：每次保存把【最新】版本写 `dataset.dv.json` 到数据集根，作为自标识文件，
 *   下次打开目录可 detectMarker 识别已有迭代。
 * - 浏览器：无法写回源目录，提供 downloadManifest 下载该文件做便携标识，
 *   以及 importManifestFile 导入他人/历史标识文件到 IDB。
 */

import { env } from '../env'
import type { DataSet } from '../types'
import { MANIFEST_FILENAME, type DatasetVersionManifest } from './versioning'
import {
  putVersionManifest,
  getVersionManifest,
  listVersionManifests,
  deleteVersionManifest,
} from '../cache/idbCache'
import { downloadJSON } from '../dedup/report'
import { normSlash } from './importers/shared'

/** 数据集稳定键：Tauri 用根目录绝对路径，浏览器用数据集名 */
export function datasetKeyOf(dataset: DataSet): string {
  if (env === 'tauri' && dataset.rootAbsPath) return normSlash(dataset.rootAbsPath)
  return dataset.name || dataset.id
}

/** 保存一份版本：写 IDB 历史 +（Tauri）落盘最新标识文件 */
export async function saveVersion(
  dataset: DataSet,
  manifest: DatasetVersionManifest,
): Promise<void> {
  const key = datasetKeyOf(dataset)
  await putVersionManifest(key, manifest)
  if (env === 'tauri' && dataset.rootAbsPath) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const abs = normSlash(dataset.rootAbsPath) + '/' + MANIFEST_FILENAME
      await invoke('write_text_file', { path: abs, content: JSON.stringify(manifest, null, 2) })
    } catch {
      // 落盘失败不阻断：IDB 历史已保留，用户仍可正常使用 diff
    }
  }
}

export async function listVersions(dataset: DataSet): Promise<DatasetVersionManifest[]> {
  return listVersionManifests(datasetKeyOf(dataset))
}

export async function getVersion(
  dataset: DataSet,
  id: string,
): Promise<DatasetVersionManifest | undefined> {
  return getVersionManifest(datasetKeyOf(dataset), id)
}

export async function removeVersion(dataset: DataSet, id: string): Promise<void> {
  await deleteVersionManifest(datasetKeyOf(dataset), id)
}

/**
 * 打开目录时检测自标识版本文件（Tauri 专有）。
 * 返回根目录下 dataset.dv.json 的清单（若存在且 schema 兼容）；否则 null。
 */
export async function detectMarker(
  rootAbsPath?: string,
): Promise<DatasetVersionManifest | null> {
  if (env !== 'tauri' || !rootAbsPath) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const abs = normSlash(rootAbsPath) + '/' + MANIFEST_FILENAME
    const text = await invoke<string>('read_file_text', { path: abs })
    const m = JSON.parse(text) as DatasetVersionManifest
    if (m && typeof m.id === 'string' && Array.isArray(m.samples)) return m
    return null
  } catch {
    return null
  }
}

/** 浏览器端：下载版本清单为自标识文件（便携）。桌面端经由 saveFile 弹保存对话框。 */
export function downloadManifest(manifest: DatasetVersionManifest): Promise<boolean> {
  const safe = (manifest.datasetName || 'dataset').replace(/[^\w一-龥.-]+/g, '_')
  return downloadJSON(`${safe}_${manifest.id}.dv.json`, manifest)
}

/** 浏览器端：从下载的标识文件导入到 IDB（需提供所属 dataset 以定位 key） */
export async function importManifestFile(
  dataset: DataSet,
  file: File,
): Promise<DatasetVersionManifest> {
  const text = await file.text()
  const m = JSON.parse(text) as DatasetVersionManifest
  if (!m || typeof m.id !== 'string' || !Array.isArray(m.samples)) {
    throw new Error('文件不是有效的数据集版本清单（dataset.dv.json）')
  }
  await putVersionManifest(datasetKeyOf(dataset), m)
  return m
}
