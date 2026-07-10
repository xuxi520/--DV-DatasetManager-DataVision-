/**
 * 标注文件匹配服务
 * 负责：匹配图片文件和标注文件、读取标注内容、同步去重操作
 */

import type { ImageFile, AnnotationFile, AnnotationFormat, MatchingRule } from './types'

/**
 * 匹配图片和标注文件
 */
export function matchAnnotations(
  imageFiles: ImageFile[],
  annotationFiles: AnnotationFile[],
  rule: MatchingRule
): Map<string, AnnotationFile> {
  const matches = new Map<string, AnnotationFile>()
  
  for (const imageFile of imageFiles) {
    const annotation = findMatchingAnnotation(imageFile, annotationFiles, rule)
    if (annotation) {
      matches.set(imageFile.id, annotation)
    }
  }
  
  return matches
}

/**
 * 根据匹配规则找到对应的标注文件
 */
function findMatchingAnnotation(
  imageFile: ImageFile,
  annotationFiles: AnnotationFile[],
  rule: MatchingRule
): AnnotationFile | null {
  const imageName = imageFile.name.substring(0, imageFile.name.lastIndexOf('.'))
  
  for (const annotation of annotationFiles) {
    const annotationName = annotation.name.substring(0, annotation.name.lastIndexOf('.'))
    
    let matched = false
    
    switch (rule.type) {
      case 'same_name':
        // 相同文件名（忽略扩展名）
        matched = imageName === annotationName
        break
        
      case 'same_dir':
        // 同一目录下
        const imageDir = imageFile.path.substring(0, imageFile.path.lastIndexOf('/'))
        const annotationDir = annotation.path.substring(0, annotation.path.lastIndexOf('/'))
        matched = imageDir === annotationDir && imageName === annotationName
        break
        
      case 'custom':
        // 自定义规则（简化实现）
        // TODO: 实现更复杂的自定义规则
        matched = imageName === annotationName
        break
    }
    
    if (matched) {
      return annotation
    }
  }
  
  return null
}

/**
 * 读取标注文件内容
 */
export async function readAnnotationContent(
  annotation: AnnotationFile,
  env: 'browser' | 'tauri',
  getFileContent: (path: string) => Promise<string>
): Promise<string> {
  if (annotation.content) {
    return annotation.content
  }
  
  try {
    const content = await getFileContent(annotation.path)
    annotation.content = content
    return content
  } catch (e) {
    console.error(`读取标注文件失败：${annotation.path}`, e)
    return ''
  }
}

/**
 * 解析标注内容
 */
export function parseAnnotation(
  content: string,
  format: AnnotationFormat
): any {
  switch (format) {
    case 'yolo':
      return parseYoloAnnotation(content)
      
    case 'voc':
      return parseVocAnnotation(content)
      
    case 'coco':
      return parseCocoAnnotation(content)
      
    case 'labelme':
      return parseLabelMeAnnotation(content)
      
    default:
      return null
  }
}

/**
 * 解析 YOLO 格式标注
 * 格式：class_id x_center y_center width height
 */
function parseYoloAnnotation(content: string): any {
  const lines = content.trim().split('\n')
  const annotations = []
  
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 5) {
      annotations.push({
        classId: parseInt(parts[0]),
        bbox: {
          x: parseFloat(parts[1]),
          y: parseFloat(parts[2]),
          width: parseFloat(parts[3]),
          height: parseFloat(parts[4])
        }
      })
    }
  }
  
  return { format: 'yolo', annotations }
}

/**
 * 解析 VOC 格式标注
 * 格式：XML
 */
function parseVocAnnotation(content: string): any {
  // 简化实现：使用 DOMParser 解析 XML
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(content, 'text/xml')
  
  const objects = xmlDoc.getElementsByTagName('object')
  const annotations = []
  
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i]
    const className = obj.getElementsByTagName('name')[0]?.textContent || ''
    const bndbox = obj.getElementsByTagName('bndbox')[0]
    
    if (bndbox) {
      annotations.push({
        className,
        bbox: {
          xmin: parseInt(bndbox.getElementsByTagName('xmin')[0]?.textContent || '0'),
          ymin: parseInt(bndbox.getElementsByTagName('ymin')[0]?.textContent || '0'),
          xmax: parseInt(bndbox.getElementsByTagName('xmax')[0]?.textContent || '0'),
          ymax: parseInt(bndbox.getElementsByTagName('ymax')[0]?.textContent || '0')
        }
      })
    }
  }
  
  return { format: 'voc', annotations }
}

/**
 * 解析 COCO 格式标注
 * 格式：JSON
 */
function parseCocoAnnotation(content: string): any {
  try {
    const data = JSON.parse(content)
    return { format: 'coco', data }
  } catch (e) {
    console.error('解析 COCO 标注失败：', e)
    return null
  }
}

/**
 * 解析 LabelMe 格式标注
 * 格式：JSON
 */
function parseLabelMeAnnotation(content: string): any {
  try {
    const data = JSON.parse(content)
    return { format: 'labelme', data }
  } catch (e) {
    console.error('解析 LabelMe 标注失败：', e)
    return null
  }
}

/**
 * 同步去重操作到标注文件
 * 当删除重复图片时，自动删除对应的标注文件
 */
export function syncDeleteWithAnnotations(
  imageFile: ImageFile,
  annotationMap: Map<string, AnnotationFile>,
  onDeleteAnnotation: (annotation: AnnotationFile) => void
) {
  const annotation = annotationMap.get(imageFile.id)
  if (annotation) {
    onDeleteAnnotation(annotation)
  }
}

/**
 * 同步移动操作到标注文件
 * 当移动图片时，自动移动对应的标注文件
 */
export function syncMoveWithAnnotations(
  imageFile: ImageFile,
  annotationMap: Map<string, AnnotationFile>,
  newPath: string,
  onMoveAnnotation: (annotation: AnnotationFile, newPath: string) => void
) {
  const annotation = annotationMap.get(imageFile.id)
  if (annotation) {
    const newAnnotationPath = newPath.substring(0, newPath.lastIndexOf('.')) + 
                              annotation.name.substring(annotation.name.lastIndexOf('.'))
    onMoveAnnotation(annotation, newAnnotationPath)
  }
}

/**
 * 生成标注文件匹配报告
 */
export function generateMatchReport(
  imageFiles: ImageFile[],
  annotationMap: Map<string, AnnotationFile>
): string {
  const totalImages = imageFiles.length
  const matchedCount = annotationMap.size
  const unmatchedCount = totalImages - matchedCount
  const matchRate = totalImages > 0 ? (matchedCount / totalImages * 100).toFixed(1) : 0
  
  let report = '# 标注文件匹配报告\n\n'
  report += `- 总图片数：${totalImages}\n`
  report += `- 已匹配标注：${matchedCount}\n`
  report += `- 未匹配标注：${unmatchedCount}\n`
  report += `- 匹配率：${matchRate}%\n\n`
  
  if (unmatchedCount > 0) {
    report += '## 未匹配标注的图片\n\n'
    for (const image of imageFiles) {
      if (!annotationMap.has(image.id)) {
        report += `- ${image.name}\n`
      }
    }
  }
  
  return report
}
