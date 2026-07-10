/**
 * 数据集加载服务 V2
 * 支持：图片文件 + 标注文件一起加载和解析
 */

import { env, pickDirectoryBrowser, readDirBrowser, getImageDimensions } from './env'
import { parseAllAnnotations, type ParsedAnnotation } from './annotationParser'
import type { DataSet, ImageFile } from './types'

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif', 'tiff', 'tif', 'avif'])
const ANNOTATION_EXTS = new Set(['json', 'txt', 'xml'])

/**
 * 扩展的文件信息（包含原始 File 对象）
 */
interface FileEntry {
  file: File
  name: string
  path: string
  content?: string // 标注文件内容
}

/**
 * 加载数据集（包含标注）
 */
export async function loadDatasetWithAnnotations(
  onProgress?: (current: number, total: number, status: string) => void
): Promise<{
  dataset: DataSet
  annotations: Map<string, ParsedAnnotation[]>
  categoryColors: Map<string, string>
}> {
  if (env === 'browser') {
    return loadDatasetBrowserV2(onProgress)
  } else {
    throw new Error('Tauri 版本尚未实现')
  }
}

/**
 * 浏览器版加载（V2）
 */
async function loadDatasetBrowserV2(
  onProgress?: (current: number, total: number, status: string) => void
): Promise<{
  dataset: DataSet
  annotations: Map<string, ParsedAnnotation[]>
  categoryColors: Map<string, string>
}> {
  const handle = await pickDirectoryBrowser()
  if (!handle) throw new Error('用户取消选择')
  
  onProgress?.(0, 100, '正在扫描文件...')
  
  // 递归读取所有文件
  const entries = await readDirBrowser(handle)
  
  onProgress?.(10, 100, `找到 ${entries.length} 个文件，正在分类...`)
  
  // 分类文件
  const imageEntries: { path: string; file: File }[] = []
  const annotationEntries: { path: string; file: File }[] = []
  
  for (const { path, file } of entries) {
    const ext = getExt(file.name)
    if (IMAGE_EXTS.has(ext)) {
      imageEntries.push({ path, file })
    } else if (ANNOTATION_EXTS.has(ext)) {
      annotationEntries.push({ path, file })
    }
  }
  
  onProgress?.(15, 100, `找到 ${imageEntries.length} 张图片，${annotationEntries.length} 个标注文件`)
  
  // 读取标注文件内容
  const annotationFiles = new Map<string, FileEntry>()
  
  for (let i = 0; i < annotationEntries.length; i++) {
    const { path, file } = annotationEntries[i]
    try {
      const content = await file.text()
      annotationFiles.set(path, { file, name: file.name, path, content })
    } catch (e) {
      annotationFiles.set(path, { file, name: file.name, path })
    }
    
    if (i % 10 === 0) {
      onProgress?.(15 + (i / annotationEntries.length) * 15, 100, '正在读取标注文件...')
    }
  }
  
  onProgress?.(30, 100, `正在读取图片信息...`)
  
  // 构建 ImageFile 列表
  const files = new Map<string, ImageFile>()
  const fileList: ImageFile[] = []
  const allFiles = new Map<string, FileEntry>()
  
  // 添加图片文件
  for (const { path, file } of imageEntries) {
    allFiles.set(path, { file, name: file.name, path })
  }
  
  // 添加标注文件
  for (const [path, entry] of annotationFiles) {
    if (!allFiles.has(path)) {
      allFiles.set(path, entry)
    }
  }
  
  // 读取图片尺寸
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
      const pct = 30 + (i / imageEntries.length) * 40
      onProgress?.(Math.round(pct), 100, `正在读取图片信息... (${i}/${imageEntries.length})`)
    }
  }
  
  onProgress?.(70, 100, '正在解析标注...')
  
  // 解析标注
  const categoryColors = new Map<string, string>()
  const CATEGORY_COLOR_LIST = [
    '#F59E0B', '#3B82F6', '#10B981', '#EF4444', 
    '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'
  ]
  let colorIndex = 0
  
  function getCategoryColor(category: string): string {
    if (!categoryColors.has(category)) {
      categoryColors.set(category, CATEGORY_COLOR_LIST[colorIndex % CATEGORY_COLOR_LIST.length])
      colorIndex++
    }
    return categoryColors.get(category)!
  }
  
  const annotations = parseAllAnnotations(
    allFiles,
    fileList.map(f => f.path),
    getCategoryColor
  )
  
  onProgress?.(100, 100, '加载完成！')
  
  const dataset: DataSet = {
    id: uid(),
    name: handle.name,
    files,
    fileList,
    totalCount: fileList.length,
    dupCount: 0,
    uniqueCount: fileList.length,
    annotations // 存储标注
  }
  
  return { dataset, annotations, categoryColors }
}

/**
 * 生成唯一 ID
 */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

/**
 * 获取文件扩展名
 */
function getExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.substr(i + 1).toLowerCase() : ''
}

/**
 * 计算重复文件（基于 MD5）
 */
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

/**
 * 交叉比对两个数据集
 */
export function compareDatasets(setA: DataSet, setB: DataSet): import('./types').CompareResult[] {
  const results: import('./types').CompareResult[] = []
  const mapA = new Map<string, ImageFile[]>()
  const mapB = new Map<string, ImageFile[]>()
  
  // 按 hash 分组
  for (const f of setA.fileList) {
    if (f.hash) {
      const group = mapA.get(f.hash) || []
      group.push(f)
      mapA.set(f.hash, group)
    }
  }
  for (const f of setB.fileList) {
    if (f.hash) {
      const group = mapB.get(f.hash) || []
      group.push(f)
      mapB.set(f.hash, group)
    }
  }
  
  const matchedA = new Set<string>()
  const matchedB = new Set<string>()
  
  // 找出 A∩B（重复）
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
  
  // A 有 B 无
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
  
  // B 有 A 无
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
