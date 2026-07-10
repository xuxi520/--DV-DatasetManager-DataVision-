/**
 * 数据集加载服务
 * 负责：选择文件夹、递归读取文件、过滤图片、生成缩略图、识别数据集结构
 */
import { env, pickDirectoryBrowser, readDirBrowser, getImageDimensions } from './env'
import { analyzeDirectoryStructure, type StructureAnalysisResult } from './datasetStructureAnalyzer'
import type { DataSet, ImageFile, CompareResult } from './types'

const IMG_EXTS = new Set(['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif', 'tiff', 'tif', 'avif'])

/** 生成唯一ID */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

/** 获取文件扩展名 */
function getExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.substr(i + 1).toLowerCase() : ''
}

/** 加载数据集 */
export async function loadDataset(
  onProgress?: (current: number, total: number, status: string) => void
): Promise<DataSet> {
  if (env === 'browser') {
    return loadDatasetBrowser(onProgress)
  } else {
    return loadDatasetTauri(onProgress)
  }
}

/** 浏览器版加载 */
async function loadDatasetBrowser(
  onProgress?: (current: number, total: number, status: string) => void
): Promise<DataSet> {
  const handle = await pickDirectoryBrowser()
  if (!handle) throw new Error('用户取消选择')

  onProgress?.(0, 100, '正在扫描文件...')

  // 递归读取所有文件
  const entries = await readDirBrowser(handle)
  
  onProgress?.(5, 100, `找到 ${entries.length} 个文件，正在分析目录结构...`)

  // 分析数据集结构
  const structureAnalysis = await analyzeDirectoryStructure(handle.name, entries.map(e => e.file))
  
  onProgress?.(10, 100, `找到 ${entries.length} 个文件，正在过滤图片...`)

  // 过滤图片文件
  const imageEntries = entries.filter(({ path, file }) => {
    const ext = getExt(file.name)
    return IMG_EXTS.has(ext)
  })

  onProgress?.(20, 100, `找到 ${imageEntries.length} 张图片，正在读取尺寸...`)

  // 构建 ImageFile 列表
  const files = new Map<string, ImageFile>()
  const fileList: ImageFile[] = []

  for (let i = 0; i < imageEntries.length; i++) {
    const { path, file } = imageEntries[i]
    
    try {
      const dims = await getImageDimensions(file)
      const id = uid()
      const imageFile: ImageFile = {
        id,
        name: file.name,
        path,
        size: file.size,
        width: dims.width,
        height: dims.height,
        blob: file,
        url: URL.createObjectURL(file)
      }
      files.set(path, imageFile)
      fileList.push(imageFile)
    } catch (e) {
      console.warn(`跳过损坏文件: ${path}`)
    }

    if (i % 50 === 0) {
      const pct = 20 + (i / imageEntries.length) * 60
      onProgress?.(Math.round(pct), 100, `正在读取图片信息... (${i}/${imageEntries.length})`)
    }
  }

  onProgress?.(100, 100, '加载完成！')

  return {
    id: uid(),
    name: handle.name,
    files,
    fileList,
    totalCount: fileList.length,
    dupCount: 0,
    uniqueCount: fileList.length
  }
}

/** Tauri版加载（占位） */
async function loadDatasetTauri(
  onProgress?: (current: number, total: number, status: string) => void
): Promise<DataSet> {
  // TODO: 实现Tauri版本
  throw new Error('Tauri版本尚未实现')
}

/** 计算重复文件 */
export function findDuplicates(dataset: DataSet): Map<string, ImageFile[]> {
  const hashMap = new Map<string, ImageFile[]>()
  
  for (const file of dataset.fileList) {
    if (!file.hash) continue
    const group = hashMap.get(file.hash) || []
    group.push(file)
    hashMap.set(file.hash, group)
  }

  // 只返回有重复的分组
  const duplicates = new Map<string, ImageFile[]>()
  for (const [hash, files] of hashMap) {
    if (files.length > 1) {
      duplicates.set(hash, files)
    }
  }
  return duplicates
}

/** 交叉比对两个数据集 */
export function compareDatasets(setA: DataSet, setB: DataSet): CompareResult[] {
  const results: CompareResult[] = []
  const mapA = new Map<string, ImageFile[]>()
  const mapB = new Map<string, ImageFile[]>()

  // 按hash分组
  for (const f of setA.fileList) {
    if (f.hash) {
      const group = mapA.get(f.hash) ?? []
      group.push(f)
      mapA.set(f.hash, group)
    }
  }
  for (const f of setB.fileList) {
    if (f.hash) {
      const group = mapB.get(f.hash) ?? []
      group.push(f)
      mapB.set(f.hash, group)
    }
  }

  const matchedA = new Set<string>()
  const matchedB = new Set<string>()

  // 找出A∩B（重复）
  for (const [hash, filesA] of mapA) {
    const filesB = mapB.get(hash)
    if (filesB) {
      for (const fa of filesA) {
        for (const fb of filesB) {
          results.push({
            type: 'duplicate',
            fileA: fa,
            fileB: fb,
            similarity: 1.0,
            groupId: hash
          })
          matchedA.add(fa.id)
          matchedB.add(fb.id)
        }
      }
    }
  }

  // A有B无
  for (const f of setA.fileList) {
    if (!matchedA.has(f.id)) {
      results.push({
        type: 'onlyA',
        fileA: f,
        similarity: 0,
        groupId: f.id
      })
    }
  }

  // B有A无
  for (const f of setB.fileList) {
    if (!matchedB.has(f.id)) {
      results.push({
        type: 'onlyB',
        fileB: f,
        similarity: 0,
        groupId: f.id
      })
    }
  }

  return results
}
