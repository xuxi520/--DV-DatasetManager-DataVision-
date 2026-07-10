/**
 * 数据集结构分析器
 * 自动识别图片和标注文件的位置关系
 */

import type { DataSet, ImageFile, AnnotationFile } from './types'

// 支持的图片格式
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff']

// 支持的标注格式
const ANNOTATION_EXTENSIONS = ['.txt', '.xml', '.json', '.csv']

// 数据集拆分类型
export type SplitType = 'train' | 'val' | 'test' | 'unknown'

// 标注格式类型
export type AnnotationFormat = 'yolo' | 'voc' | 'coco' | 'labelme' | 'custom'

// 目录结构类型
export type DirectoryStructure = 
  | 'separated'      // 图片和标注分开存储
  | 'merged'         // 图片和标注在同一目录
  | 'hierarchical'   // 按类别分层存储
  | 'unknown'        // 无法识别

// 分析结果
export interface StructureAnalysisResult {
  structureType: DirectoryStructure
  splitType: SplitType
  imagePaths: string[]           // 图片目录列表
  annotationPaths: string[]      // 标注目录列表（如果分开存储）
  annotationFormat: AnnotationFormat
  matchingRule: MatchingRule     // 匹配规则
  datasetSplits: DatasetSplit[] // 识别出的数据集拆分
}

// 数据集拆分信息
export interface DatasetSplit {
  name: SplitType
  imagePath: string
  annotationPath?: string
  imageCount: number
  annotationCount: number
}

// 匹配规则
export interface MatchingRule {
  type: 'same_name' | 'same_dir' | 'custom'
  imagePattern: string          // 图片文件模式，如 "{name}.jpg"
  annotationPattern: string     // 标注文件模式，如 "{name}.txt"
  customRule?: string           // 自定义规则
}

/**
 * 分析目录结构
 */
export async function analyzeDirectoryStructure(
  rootPath: string,
  files: FileList | File[]
): Promise<StructureAnalysisResult> {
  // 1. 扫描所有文件
  const allFiles = Array.from(files)
  const imageFiles = allFiles.filter(f => isImageFile(f.name))
  const annotationFiles = allFiles.filter(f => isAnnotationFile(f.name))
  
  // 2. 分析目录结构
  const structureType = detectStructureType(allFiles)
  
  // 3. 识别数据集拆分
  const datasetSplits = detectDatasetSplits(allFiles)
  
  // 4. 识别标注格式
  const annotationFormat = detectAnnotationFormat(annotationFiles)
  
  // 5. 生成匹配规则
  const matchingRule = generateMatchingRule(imageFiles, annotationFiles)
  
  // 6. 提取图片和标注路径
  const { imagePaths, annotationPaths } = extractPaths(allFiles, structureType)
  
  return {
    structureType,
    splitType: datasetSplits.length === 1 ? datasetSplits[0].name : 'unknown',
    imagePaths,
    annotationPaths,
    annotationFormat,
    matchingRule,
    datasetSplits
  }
}

/**
 * 检测是否为图片文件
 */
export function isImageFile(filename: string): boolean {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.includes(ext)
}

/**
 * 检测是否为标注文件
 */
export function isAnnotationFile(filename: string): boolean {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase()
  return ANNOTATION_EXTENSIONS.includes(ext)
}

/**
 * 检测目录结构类型
 */
function detectStructureType(files: File[]): DirectoryStructure {
  // 获取所有目录路径
  const dirPaths = new Set<string>()
  files.forEach(f => {
    const dir = f.webkitRelativePath ? 
      f.webkitRelativePath.substring(0, f.webkitRelativePath.lastIndexOf('/')) : 
      ''
    if (dir) dirPaths.add(dir)
  })
  
  // 检查是否有 images/ 和 labels/ 或 annotations/ 目录
  const hasImagesDir = Array.from(dirPaths).some(p => p.includes('images'))
  const hasLabelsDir = Array.from(dirPaths).some(p => 
    p.includes('labels') || p.includes('annotations') || p.includes('annotations')
  )
  
  if (hasImagesDir && hasLabelsDir) {
    return 'separated'
  }
  
  // 检查是否在同一目录下有图片和标注
  const hasMixedDir = Array.from(dirPaths).some(p => {
    const filesInDir = files.filter(f => 
      f.webkitRelativePath && 
      f.webkitRelativePath.startsWith(p + '/')
    )
    const hasImage = filesInDir.some(f => isImageFile(f.name))
    const hasAnnotation = filesInDir.some(f => isAnnotationFile(f.name))
    return hasImage && hasAnnotation
  })
  
  if (hasMixedDir) {
    return 'merged'
  }
  
  // 检查是否按类别分层
  const hasCategoryDir = Array.from(dirPaths).some(p => {
    const parts = p.split('/')
    return parts.length >= 2
  })
  
  if (hasCategoryDir) {
    return 'hierarchical'
  }
  
  return 'unknown'
}

/**
 * 识别数据集拆分（train/val/test）
 */
function detectDatasetSplits(files: File[]): DatasetSplit[] {
  const splits: DatasetSplit[] = []
  const splitNames: SplitType[] = ['train', 'val', 'test']
  
  for (const splitName of splitNames) {
    // 检查是否有对应的目录
    const hasSplitDir = files.some(f => 
      f.webkitRelativePath && 
      f.webkitRelativePath.toLowerCase().includes(splitName)
    )
    
    if (hasSplitDir) {
      // 统计该拆分中的图片和标注数量
      const imageCount = files.filter(f => 
        f.webkitRelativePath && 
        f.webkitRelativePath.toLowerCase().includes(splitName) &&
        isImageFile(f.name)
      ).length
      
      const annotationCount = files.filter(f => 
        f.webkitRelativePath && 
        f.webkitRelativePath.toLowerCase().includes(splitName) &&
        isAnnotationFile(f.name)
      ).length
      
      splits.push({
        name: splitName,
        imagePath: splitName + '/images',
        annotationPath: splitName + '/labels',
        imageCount,
        annotationCount
      })
    }
  }
  
  // 如果没有识别到拆分，则整个数据集作为一个拆分
  if (splits.length === 0) {
    const imageCount = files.filter(f => isImageFile(f.name)).length
    const annotationCount = files.filter(f => isAnnotationFile(f.name)).length
    
    splits.push({
      name: 'unknown',
      imagePath: '',
      imageCount,
      annotationCount
    })
  }
  
  return splits
}

/**
 * 检测标注格式
 */
function detectAnnotationFormat(files: File[]): AnnotationFormat {
  // 检查文件扩展名
  const hasTxt = files.some(f => f.name.endsWith('.txt'))
  const hasXml = files.some(f => f.name.endsWith('.xml'))
  const hasJson = files.some(f => f.name.endsWith('.json'))
  
  // 检查文件内容（读取前几个文件）
  if (hasTxt) {
    // YOLO 格式通常是 .txt，内容为：class_id x_center y_center width height
    return 'yolo'
  }
  
  if (hasXml) {
    // VOC 格式通常是 .xml
    return 'voc'
  }
  
  if (hasJson) {
    // 可能是 COCO 或 LabelMe
    return 'coco' // 默认 COCO，后续可根据内容判断
  }
  
  return 'custom'
}

/**
 * 生成匹配规则
 */
function generateMatchingRule(imageFiles: File[], annotationFiles: File[]): MatchingRule {
  // 如果没有标注文件，则返回默认规则
  if (annotationFiles.length === 0) {
    return {
      type: 'same_name',
      imagePattern: '{name}.jpg',
      annotationPattern: '{name}.txt'
    }
  }
  
  // 检查是否有相同文件名的文件（忽略扩展名）
  const imageNames = imageFiles.map(f => 
    f.name.substring(0, f.name.lastIndexOf('.'))
  )
  
  const annotationNames = annotationFiles.map(f => 
    f.name.substring(0, f.name.lastIndexOf('.'))
  )
  
  // 计算匹配率
  const matchedNames = imageNames.filter(n => annotationNames.includes(n))
  const matchRate = matchedNames.length / Math.max(imageNames.length, 1)
  
  if (matchRate > 0.8) {
    // 高匹配率，使用相同文件名规则
    const imageExt = imageFiles[0]?.name.substring(imageFiles[0].name.lastIndexOf('.')) || '.jpg'
    const annotationExt = annotationFiles[0]?.name.substring(annotationFiles[0].name.lastIndexOf('.')) || '.txt'
    
    return {
      type: 'same_name',
      imagePattern: `{name}${imageExt}`,
      annotationPattern: `{name}${annotationExt}`
    }
  }
  
  // 低匹配率，可能需要自定义规则
  return {
    type: 'custom',
    imagePattern: '{name}.*',
    annotationPattern: '{name}.*',
    customRule: 'Please configure manually'
  }
}

/**
 * 提取图片和标注路径
 */
function extractPaths(
  files: File[], 
  structureType: DirectoryStructure
): { imagePaths: string[], annotationPaths: string[] } {
  const imagePaths: string[] = []
  const annotationPaths: string[] = []
  
  // 根据结构类型提取路径
  // 这里需要根据实际情况实现
  // 简化处理：返回根路径
  
  return { imagePaths, annotationPaths }
}

/**
 * 手动配置匹配规则
 */
export function configureMatchingRule(
  imageFiles: File[],
  annotationFiles: File[],
  rule: Partial<MatchingRule>
): MatchingRule {
  // 根据用户配置生成匹配规则
  return {
    type: rule.type || 'same_name',
    imagePattern: rule.imagePattern || '{name}.*',
    annotationPattern: rule.annotationPattern || '{name}.*',
    customRule: rule.customRule
  }
}

/**
 * 根据匹配规则找到对应的标注文件
 */
export function findMatchingAnnotation(
  imageFile: File,
  annotationFiles: File[],
  rule: MatchingRule
): File | null {
  const imageName = imageFile.name.substring(0, imageFile.name.lastIndexOf('.'))
  
  // 根据规则生成标注文件名
  let annotationFileName = ''
  
  switch (rule.type) {
    case 'same_name':
      // 相同文件名，不同扩展名
      const annotationExt = rule.annotationPattern.substring(rule.annotationPattern.indexOf('.'))
      annotationFileName = imageName + annotationExt
      break
      
    case 'same_dir':
      // 同一目录下
      annotationFileName = imageName + '.*'
      break
      
    case 'custom':
      // 自定义规则（简化实现）
      annotationFileName = imageName + '.*'
      break
  }
  
  // 查找匹配的标注文件
  return annotationFiles.find(f => {
    if (annotationFileName.includes('*')) {
      const pattern = annotationFileName.replace('*', '.*')
      const regex = new RegExp(`^${imageName}\\.`)
      return regex.test(f.name)
    } else {
      return f.name === annotationFileName
    }
  }) || null
}
