/**
 * 标注解析器
 * 支持格式：COCO JSON、LabelMe JSON、YOLO TXT、VOC XML
 *           DOTA (旋转框)、MOT (多目标跟踪)、PPOCR (文本检测识别)
 *           参考 X-AnyLabeling 格式规范
 */

import type { AnnotationFile, ImageFile } from './types'

/**
 * 扩展的标注类型
 */
export interface ParsedAnnotation {
  type: 'bbox' | 'polygon' | 'circle' | 'rotation' | 'keypoint' | 'polyline'
  bbox?: [number, number, number, number] // [x, y, width, height]
  points?: [number, number][] // 多边形点 / 关键点
  rotation?: number // 旋转角度 (DOTA 格式)
  keypoints?: { x: number; y: number; v: number }[] // 关键点 (YOLO-Pose/COCO)
  groupId?: number // 分组ID (YOLO-Pose 中关联框和关键点)
  bboxType?: 'hbb' | 'obb' | 'qbb' // 边界框类型：水平/定向/四边形
  trackId?: number // 跟踪ID (MOT 格式)
  text?: string // 文本内容 (PPOCR 格式)
  category: string
  normalized?: boolean // YOLO 格式是否归一化
  color?: string // 类别颜色
  confidence?: number // 置信度
  description?: string // 文本描述
}

/**
 * 解析所有标注文件
 */
export function parseAllAnnotations(
  files: Map<string, { file: File; name: string; path: string; content?: string }>,
  imagePaths: string[],
  getCategoryColor: (category: string) => string
): Map<string, ParsedAnnotation[]> {
  const annotations = new Map<string, ParsedAnnotation[]>()
  
  // 分类文件
  const jsons: string[] = []
  const txts: string[] = []
  const xmls: string[] = []
  
  files.forEach((f, path) => {
    const ext = path.split('.').pop()?.toLowerCase() || ''
    if (ext === 'json') jsons.push(path)
    else if (ext === 'txt') txts.push(path)
    else if (ext === 'xml') xmls.push(path)
  })
  
  // 解析 COCO 格式
  let isCoco = false
  for (const path of jsons) {
    if (isCoco) continue
    try {
      const content = files.get(path)?.content
      if (!content) continue
      const data = JSON.parse(content)
      if (data.images && data.annotations && Array.isArray(data.images)) {
        parseCoco(annotations, data, files, imagePaths, getCategoryColor)
        isCoco = true
      }
    } catch (e) {
      // 不是 COCO 格式，继续
    }
  }
  
  // 解析 LabelMe 格式
  for (const path of jsons) {
    try {
      const content = files.get(path)?.content
      if (!content) continue
      const data = JSON.parse(content)
      if (data.shapes && Array.isArray(data.shapes)) {
        parseLabelMe(annotations, data, path, files, imagePaths, getCategoryColor)
      }
    } catch (e) {
      // 不是 LabelMe 格式，继续
    }
  }
  
  // 解析通用 JSON 格式
  for (const path of jsons) {
    try {
      const content = files.get(path)?.content
      if (!content) continue
      const data = JSON.parse(content)
      if (!data.images && !data.shapes && typeof data === 'object' && Object.keys(data).length > 0) {
        parseGeneric(annotations, data, path, files, imagePaths, getCategoryColor)
      }
    } catch (e) {
      // 不是通用格式，继续
    }
  }
  
  // 解析 YOLO 格式
  for (const path of txts) {
    if (/classes\.txt$/i.test(path)) continue // 跳过类别文件
    if (/yolov8_pose\.yaml$/i.test(path)) continue // 跳过配置文件
    parseYolo(annotations, path, files, imagePaths, getCategoryColor)
  }
  
  // 解析 VOC 格式
  for (const path of xmls) {
    parseVoc(annotations, path, files, imagePaths, getCategoryColor)
  }
  
  // 解析 DOTA 格式 (旋转框检测)
  for (const path of txts) {
    if (/classes\.txt$/i.test(path)) continue
    parseDota(annotations, path, files, imagePaths, getCategoryColor)
  }
  
  // 解析 MOT 格式 (多目标跟踪)
  const motFiles = [...files.keys()].filter(k => /gt\.txt$|det\.txt$/i.test(k))
  for (const path of motFiles) {
    parseMot(annotations, path, files, imagePaths, getCategoryColor)
  }
  
  // 解析 PPOCR 格式 (文本检测识别)
  const ppocrFiles = [...files.keys()].filter(k => /Label\.txt$/i.test(k))
  for (const path of ppocrFiles) {
    parsePpocr(annotations, path, files, imagePaths, getCategoryColor)
  }
  
  return annotations
}

/**
 * 解析 COCO 格式
 */
function parseCoco(
  annotations: Map<string, ParsedAnnotation[]>,
  data: any,
  files: Map<string, { file: File; name: string; path: string; content?: string }>,
  imagePaths: string[],
  getCategoryColor: (category: string) => string
): void {
  // 构建类别映射
  const categoryMap = new Map<number, string>()
  ;(data.categories || []).forEach((c: any) => {
    categoryMap.set(c.id, c.name)
    getCategoryColor(c.name) // 预分配颜色
  })
  
  // 构建图片路径映射
  const imageMap = new Map<number, string>()
  ;(data.images || []).forEach((img: any) => {
    const fileName = img.file_name || ''
    // 查找匹配的图片路径
    const imagePath = imagePaths.find(p => 
      p.split('/').pop() === fileName || 
      p.split('\\').pop() === fileName
    ) || imagePaths.find(p => 
      stem(p) === fileName.replace(/\.[^.]+$/, '')
    )
    if (imagePath) {
      imageMap.set(img.id, imagePath)
    }
  })
  
  // 解析标注
  ;(data.annotations || []).forEach((ann: any) => {
    const imagePath = imageMap.get(ann.image_id)
    if (!imagePath) return
    
    const category = categoryMap.get(ann.category_id) || 'unknown'
    getCategoryColor(category)
    
    const parsed: ParsedAnnotation = {
      type: 'bbox',
      bbox: ann.bbox || [0, 0, 0, 0],
      category,
      color: getCategoryColor(category),
      confidence: ann.score || undefined, // COCO 格式可能有 score 字段
      description: ann.description || undefined
    }
    
    // 如果有分割信息，转为多边形
    if (ann.segmentation && ann.segmentation.length) {
      const seg = ann.segmentation[0]
      if (Array.isArray(seg) && seg.length >= 6) {
        parsed.type = 'polygon'
        parsed.points = []
        for (let i = 0; i < seg.length; i += 2) {
          parsed.points!.push([seg[i], seg[i + 1]])
        }
      }
    }
    
    if (!annotations.has(imagePath)) {
      annotations.set(imagePath, [])
    }
    annotations.get(imagePath)!.push(parsed)
  })
}

/**
 * 解析 LabelMe 格式
 */
function parseLabelMe(
  annotations: Map<string, ParsedAnnotation[]>,
  data: any,
  jsonPath: string,
  files: Map<string, { file: File; name: string; path: string; content?: string }>,
  imagePaths: string[],
  getCategoryColor: (category: string) => string
): void {
  const jsonStem = stem(jsonPath)
  const jsonDir = dir(jsonPath)
  
  // 查找匹配图片
  let imagePath = imagePaths.find(p => 
    stem(p) === jsonStem && dir(p) === jsonDir
  ) || imagePaths.find(p => stem(p) === jsonStem)
  
  if (!imagePath) return
  
  const parsed = (data.shapes || []).map((shape: any) => {
    const category = shape.label || 'unknown'
    getCategoryColor(category)
    
    const ann: ParsedAnnotation = {
      type: 'bbox',
      category,
      color: getCategoryColor(category),
      confidence: shape.score, // 解析置信度
      description: shape.description // 解析描述信息
    }
    
    if ((shape.shape_type === 'rectangle' || shape.shape_type === 'rect') && shape.points.length >= 2) {
      const [a, b] = shape.points
      ann.bbox = [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.abs(b[0] - a[0]),
        Math.abs(b[1] - a[1])
      ]
    } else if (shape.shape_type === 'circle' && shape.points.length >= 2) {
      const [center, radius] = shape.points
      const r = Math.hypot(radius[0] - center[0], radius[1] - center[1])
      ann.bbox = [center[0] - r, center[1] - r, r * 2, r * 2]
    } else if (shape.points && shape.points.length >= 3) {
      ann.type = 'polygon'
      ann.points = shape.points.map((pt: number[]) => [pt[0], pt[1]])
      // 计算边界框
      const xs = ann.points!.map(p => p[0])
      const ys = ann.points!.map(p => p[1])
      ann.bbox = [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys)
      ]
    }
    
    return ann
  }).filter(Boolean)
  
  if (parsed.length) {
    if (!annotations.has(imagePath)) {
      annotations.set(imagePath, [])
    }
    annotations.get(imagePath)!.push(...parsed)
  }
}

/**
 * 解析通用 JSON 格式
 */
function parseGeneric(
  annotations: Map<string, ParsedAnnotation[]>,
  data: any,
  jsonPath: string,
  files: Map<string, { file: File; name: string; path: string; content?: string }>,
  imagePaths: string[],
  getCategoryColor: (category: string) => string
): void {
  const jsonStem = stem(jsonPath)
  const jsonDir = dir(jsonPath)
  
  let imagePath = imagePaths.find(p => 
    stem(p) === jsonStem && dir(p) === jsonDir
  ) || imagePaths.find(p => stem(p) === jsonStem)
  
  if (!imagePath) return
  
  const items = Array.isArray(data) ? data : (data.objects || data.detections || data.annotations || data.labels || [])
  if (!Array.isArray(items) || !items.length) return
  
  const parsed = items.map((obj: any) => {
    const category = obj.label || obj.name || obj.category || obj.class || 'object'
    getCategoryColor(category)
    
    const ann: ParsedAnnotation = {
      type: 'bbox',
      category,
      color: getCategoryColor(category),
      confidence: obj.confidence || obj.score || undefined,
      description: obj.description || obj.text || undefined
    }
    
    if (obj.bbox && Array.isArray(obj.bbox) && obj.bbox.length >= 4) {
      const [x, y, w, h] = obj.bbox
      ann.bbox = [x, y, Math.abs(w), Math.abs(h)]
    } else if (obj.x != null && obj.width != null) {
      ann.bbox = [obj.x || 0, obj.y || 0, obj.width || 0, obj.height || 0]
    } else if (obj.points && Array.isArray(obj.points) && obj.points.length >= 3) {
      ann.type = 'polygon'
      ann.points = obj.points.map((pt: any) =>
        Array.isArray(pt) ? [pt[0], pt[1]] : [pt.x || 0, pt.y || 0]
      )
      const xs = ann.points!.map(p => p[0])
      const ys = ann.points!.map(p => p[1])
      ann.bbox = [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys)
      ]
    }
    
    return ann
  }).filter(Boolean)
  
  if (parsed.length) {
    if (!annotations.has(imagePath)) {
      annotations.set(imagePath, [])
    }
    annotations.get(imagePath)!.push(...parsed)
  }
}

/**
 * 解析 YOLO 格式
 */
function parseYolo(
  annotations: Map<string, ParsedAnnotation[]>,
  txtPath: string,
  files: Map<string, { file: File; name: string; path: string; content?: string }>,
  imagePaths: string[],
  getCategoryColor: (category: string) => string
): void {
  const file = files.get(txtPath)
  if (!file || !file.content || !file.content.trim()) return
  
  const txtStem = stem(txtPath)
  const txtDir = dir(txtPath)
  
  // 查找匹配图片
  let imagePath = imagePaths.find(p => 
    stem(p) === txtStem && (
      dir(p) === txtDir || 
      dir(p).replace(/labels?\/?$/i, '') === txtDir.replace(/labels?\/?$/i, '')
    )
  ) || imagePaths.find(p => stem(p) === txtStem)
  
  if (!imagePath) return
  
  // 读取类别名称
  let classNames: string[] = []
  const classFile = [...files.keys()].find(k => /classes\.txt$/i.test(k))
  if (classFile) {
    classNames = (files.get(classFile)?.content || '').trim().split('\n').map(s => s.trim()).filter(Boolean)
  }
  
  // 解析标注
  const parsed = file.content.trim().split('\n').filter(l => l.trim()).map(line => {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) return null
    
    const classId = parseInt(parts[0])
    const cx = parseFloat(parts[1])
    const cy = parseFloat(parts[2])
    const w = parseFloat(parts[3])
    const h = parseFloat(parts[4])
    
    if (isNaN(cx) || isNaN(cy) || isNaN(w) || isNaN(h)) return null
    
    const category = classNames[classId] || `class_${classId}`
    getCategoryColor(category)
    
    return {
      type: 'bbox' as const,
      bbox: [cx - w / 2, cy - h / 2, w, h] as [number, number, number, number],
      category,
      normalized: true,
      color: getCategoryColor(category)
    }
  }).filter(Boolean) as ParsedAnnotation[]
  
  if (parsed.length) {
    if (!annotations.has(imagePath)) {
      annotations.set(imagePath, [])
    }
    annotations.get(imagePath)!.push(...parsed)
  }
}

/**
 * 解析 VOC XML 格式
 */
function parseVoc(
  annotations: Map<string, ParsedAnnotation[]>,
  xmlPath: string,
  files: Map<string, { file: File; name: string; path: string; content?: string }>,
  imagePaths: string[],
  getCategoryColor: (category: string) => string
): void {
  const file = files.get(xmlPath)
  if (!file || !file.content) return
  
  const xmlStem = stem(xmlPath)
  const xmlDir = dir(xmlPath)
  
  // 查找匹配图片
  let imagePath = imagePaths.find(p => 
    stem(p) === xmlStem && dir(p) === xmlDir
  ) || imagePaths.find(p => stem(p) === xmlStem)
  
  if (!imagePath) return
  
  parseVocContent(annotations, file.content, imagePath, getCategoryColor)
}

/**
 * 解析 VOC XML 内容
 */
function parseVocContent(
  annotations: Map<string, ParsedAnnotation[]>,
  xmlContent: string,
  imagePath: string,
  getCategoryColor: (category: string) => string
): void {
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xmlContent, 'text/xml')
  const objects = xmlDoc.querySelectorAll('object')
  
  if (!objects.length) return
  
  const parsed: ParsedAnnotation[] = []
  
  objects.forEach(obj => {
    const name = obj.querySelector('name')?.textContent || 'unknown'
    getCategoryColor(name)
    
    const bndbox = obj.querySelector('bndbox')
    if (bndbox) {
      const xmin = +(bndbox.querySelector('xmin')?.textContent || 0)
      const ymin = +(bndbox.querySelector('ymin')?.textContent || 0)
      const xmax = +(bndbox.querySelector('xmax')?.textContent || 0)
      const ymax = +(bndbox.querySelector('ymax')?.textContent || 0)
      
      parsed.push({
        type: 'bbox',
        bbox: [xmin, ymin, xmax - xmin, ymax - ymin],
        category: name,
        color: getCategoryColor(name)
      })
    }
  })
  
  if (parsed.length) {
    if (!annotations.has(imagePath)) {
      annotations.set(imagePath, [])
    }
    annotations.get(imagePath)!.push(...parsed)
  }
}

/**
 * 获取文件名（不含扩展名）
 */
function stem(path: string): string {
  const name = path.split('/').pop() || path.split('\\').pop() || ''
  const dotIndex = name.lastIndexOf('.')
  return dotIndex >= 0 ? name.substring(0, dotIndex) : name
}

/**
 * 获取目录路径
 */
function dir(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.substring(0, i + 1) : ''
}

/**
 * 解析 DOTA 格式 (旋转框检测)
 * 格式：x1 y1 x2 y2 x3 y3 x4 y4 class_name difficult
 */
function parseDota(
  annotations: Map<string, ParsedAnnotation[]>,
  txtPath: string,
  files: Map<string, { file: File; name: string; path: string; content?: string }>,
  imagePaths: string[],
  getCategoryColor: (category: string) => string
): void {
  const file = files.get(txtPath)
  if (!file || !file.content || !file.content.trim()) return
  
  // DOTA 标注文件通常命名为 instance_default.txt 或在 labelTxt 目录下
  // 尝试找到对应的图片目录
  const txtDir = dir(txtPath)
  const baseName = txtPath.split('/').pop() || txtPath.split('\\').pop() || ''
  
  // 读取类别名称
  let classNames: string[] = []
  const classFile = [...files.keys()].find(k => /classes\.txt$/i.test(k))
  if (classFile) {
    classNames = (files.get(classFile)?.content || '').trim().split('\n').map(s => s.trim()).filter(Boolean)
  }
  
  const lines = file.content.trim().split('\n').filter(l => l.trim())
  
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 9) continue // DOTA 格式至少需要 9 个字段
    
    const [x1, y1, x2, y2, x3, y3, x4, y4, className, difficult] = parts
    
    const pts = [
      [parseFloat(x1), parseFloat(y1)],
      [parseFloat(x2), parseFloat(y2)],
      [parseFloat(x3), parseFloat(y3)],
      [parseFloat(x4), parseFloat(y4)]
    ]
    
    if (pts.some(p => isNaN(p[0]) || isNaN(p[1]))) continue
    
    const category = className || 'object'
    getCategoryColor(category)
    
    // 计算边界框 (axis-aligned bounding box)
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    const bbox: [number, number, number, number] = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys)
    ]
    
    // 尝试找到对应的图片 (DOTA 格式通常一个 txt 对应多张图片)
    // 这里简单处理：如果文件名匹配则使用
    const txtStem = baseName.replace(/\.(txt|csv)$/i, '')
    const imagePath = imagePaths.find(p => 
      stem(p) === txtStem || 
      p.includes(txtStem)
    ) || imagePaths[0] // 兜底使用第一张图片
    
    if (!imagePath) continue
    
    const ann: ParsedAnnotation = {
      type: 'polygon',
      bbox,
      points: pts as [number, number][],
      bboxType: 'obb', // 定向边界框
      category,
      color: getCategoryColor(category),
      description: `difficult: ${difficult || 0}`
    }
    
    if (!annotations.has(imagePath)) {
      annotations.set(imagePath, [])
    }
    annotations.get(imagePath)!.push(ann)
  }
}

/**
 * 解析 MOT 格式 (多目标跟踪)
 * gt.txt 格式：<frame>, <id>, <bb_left>, <bb_top>, <bb_width>, <bb_height>, <conf>, <class>, <visibility>
 */
function parseMot(
  annotations: Map<string, ParsedAnnotation[]>,
  txtPath: string,
  files: Map<string, { file: File; name: string; path: string; content?: string }>,
  imagePaths: string[],
  getCategoryColor: (category: string) => string
): void {
  const file = files.get(txtPath)
  if (!file || !file.content || !file.content.trim()) return
  
  const lines = file.content.trim().split('\n').filter(l => l.trim())
  
  // 按帧分组
  const frameMap = new Map<number, any[]>()
  
  for (const line of lines) {
    const parts = line.trim().split(/,/)
    if (parts.length < 6) continue
    
    const frame = parseInt(parts[0])
    if (isNaN(frame)) continue
    
    if (!frameMap.has(frame)) {
      frameMap.set(frame, [])
    }
    
    frameMap.get(frame)!.push({
      trackId: parseInt(parts[1]) || 0,
      bbLeft: parseFloat(parts[2]) || 0,
      bbTop: parseFloat(parts[3]) || 0,
      bbWidth: parseFloat(parts[4]) || 0,
      bbHeight: parseFloat(parts[5]) || 0,
      conf: parseFloat(parts[6]) || 1,
      classId: parseInt(parts[7]) || 1,
      visibility: parseFloat(parts[8]) || 1
    })
  }
  
  // 读取类别名称
  let classNames: string[] = []
  const classFile = [...files.keys()].find(k => /classes\.txt$/i.test(k))
  if (classFile) {
    classNames = (files.get(classFile)?.content || '').trim().split('\n').map(s => s.trim()).filter(Boolean)
  }
  
  // 为每一帧图片添加标注
  for (const [frameNum, objects] of frameMap) {
    // 查找对应的图片 (通常按帧号命名：000001.jpg, 000002.jpg)
    const imagePath = imagePaths.find(p => {
      const name = p.split('/').pop() || p.split('\\').pop() || ''
      const stemName = name.replace(/\.[^.]+$/, '')
      // 匹配帧号 (支持 000001, frame_000001 等格式)
      return stemName === String(frameNum).padStart(6, '0') ||
             stemName === String(frameNum).padStart(4, '0') ||
             stemName.endsWith('_' + String(frameNum).padStart(6, '0')) ||
             stemName.endsWith('_' + String(frameNum).padStart(4, '0'))
    }) || imagePaths[Math.min(frameNum - 1, imagePaths.length - 1)]
    
    if (!imagePath) continue
    
    const parsed: ParsedAnnotation[] = objects.map(obj => {
      const category = classNames[obj.classId] || `class_${obj.classId}`
      getCategoryColor(category)
      
      return {
        type: 'bbox' as const,
        bbox: [obj.bbLeft, obj.bbTop, obj.bbWidth, obj.bbHeight] as [number, number, number, number],
        category,
        color: getCategoryColor(category),
        trackId: obj.trackId,
        confidence: obj.conf,
        description: `visibility: ${obj.visibility}`
      }
    })
    
    if (parsed.length) {
      if (!annotations.has(imagePath)) {
        annotations.set(imagePath, [])
      }
      annotations.get(imagePath)!.push(...parsed)
    }
  }
}

/**
 * 解析 PPOCR 格式 (文本检测识别)
 * Label.txt 格式：每张图片一行，格式为 "image_path\t[{\"transcription\": \"...\", \"points\": [...], ...}]"
 */
function parsePpocr(
  annotations: Map<string, ParsedAnnotation[]>,
  txtPath: string,
  files: Map<string, { file: File; name: string; path: string; content?: string }>,
  imagePaths: string[],
  getCategoryColor: (category: string) => string
): void {
  const file = files.get(txtPath)
  if (!file || !file.content || !file.content.trim()) return
  
  const lines = file.content.trim().split('\n').filter(l => l.trim())
  const txtDir = dir(txtPath)
  
  for (const line of lines) {
    const tabIndex = line.indexOf('\t')
    if (tabIndex < 0) continue
    
    const imageName = line.substring(0, tabIndex)
    const annotationStr = line.substring(tabIndex + 1)
    
    // 查找对应的图片
    let imagePath = imagePaths.find(p => 
      p.endsWith('/' + imageName) || 
      p.endsWith('\\' + imageName)
    )
    
    if (!imagePath) {
      // 尝试按文件名匹配
      const imageNameStem = imageName.replace(/\.[^.]+$/, '')
      imagePath = imagePaths.find(p => stem(p) === imageNameStem)
    }
    
    if (!imagePath) continue
    
    // 解析标注 JSON
    try {
      const annotations_data = JSON.parse(annotationStr)
      if (!Array.isArray(annotations_data)) continue
      
      const parsed: ParsedAnnotation[] = annotations_data.map((ann: any) => {
        const text = ann.transcription || ann.text || ''
        getCategoryColor('text')
        
        let points: [number, number][] = []
        let bbox: [number, number, number, number] = [0, 0, 0, 0]
        
        if (ann.points && Array.isArray(ann.points)) {
          points = ann.points.map((pt: any) => 
            Array.isArray(pt) ? [pt[0], pt[1]] as [number, number] : [pt.x || 0, pt.y || 0] as [number, number]
          )
          
          // 计算边界框
          const xs = points.map(p => p[0])
          const ys = points.map(p => p[1])
          bbox = [
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs) - Math.min(...xs),
            Math.max(...ys) - Math.min(...ys)
          ]
        }
        
        return {
          type: points.length >= 3 ? 'polygon' as const : 'bbox' as const,
          bbox,
          points: points.length >= 3 ? points : undefined,
          category: 'text',
          color: getCategoryColor('text'),
          text,
          confidence: ann.confidence || ann.score,
          description: `difficulty: ${ann.difficulty || 0}`
        }
      }).filter(Boolean)
      
      if (parsed.length) {
        if (!annotations.has(imagePath)) {
          annotations.set(imagePath, [])
        }
        annotations.get(imagePath)!.push(...parsed)
      }
    } catch (e) {
      console.warn('PPOCR 解析失败:', line.substring(0, 50))
    }
  }
}

/**
 * 解析 YOLO-Pose 格式 (关键点检测)
 * 格式：<class> <x_center> <y_center> <width> <height> <kx1> <ky1> <kv1> ... <kxN> <kyN> <kvN>
 * 需要配合 yolo_pose.yaml 配置文件
 */
function parseYoloPose(
  annotations: Map<string, ParsedAnnotation[]>,
  txtPath: string,
  files: Map<string, { file: File; name: string; path: string; content?: string }>,
  imagePaths: string[],
  getCategoryColor: (category: string) => string,
  numKeypoints: number = 17 // 默认 COCO 17 关键点
): void {
  const file = files.get(txtPath)
  if (!file || !file.content || !file.content.trim()) return
  
  const txtStem = stem(txtPath)
  const txtDir = dir(txtPath)
  
  let imagePath = imagePaths.find(p => 
    stem(p) === txtStem && (
      dir(p) === txtDir || 
      dir(p).replace(/labels?\/?$/i, '') === txtDir.replace(/labels?\/?$/i, '')
    )
  ) || imagePaths.find(p => stem(p) === txtStem)
  
  if (!imagePath) return
  
  // 读取类别名称
  let classNames: string[] = []
  const classFile = [...files.keys()].find(k => /classes\.txt$/i.test(k))
  if (classFile) {
    classNames = (files.get(classFile)?.content || '').trim().split('\n').map(s => s.trim()).filter(Boolean)
  }
  
  const parsed = file.content.trim().split('\n').filter(l => l.trim()).map(line => {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) return null
    
    const classId = parseInt(parts[0])
    const cx = parseFloat(parts[1])
    const cy = parseFloat(parts[2])
    const w = parseFloat(parts[3])
    const h = parseFloat(parts[4])
    
    if (isNaN(cx) || isNaN(cy) || isNaN(w) || isNaN(h)) return null
    
    const category = classNames[classId] || `class_${classId}`
    getCategoryColor(category)
    
    const ann: ParsedAnnotation = {
      type: 'bbox',
      bbox: [cx - w / 2, cy - h / 2, w, h] as [number, number, number, number],
      category,
      normalized: true,
      color: getCategoryColor(category)
    }
    
    // 解析关键点 (如果有)
    const kpStart = 5
    const expectedLength = 5 + numKeypoints * 3
    if (parts.length >= expectedLength) {
      ann.type = 'keypoint'
      ann.keypoints = []
      for (let i = 0; i < numKeypoints; i++) {
        const idx = kpStart + i * 3
        ann.keypoints.push({
          x: parseFloat(parts[idx]) || 0,
          y: parseFloat(parts[idx + 1]) || 0,
          v: parseInt(parts[idx + 2]) || 0 // 0=不可见, 1=遮挡, 2=可见
        })
      }
    }
    
    return ann
  }).filter(Boolean) as ParsedAnnotation[]
  
  if (parsed.length) {
    if (!annotations.has(imagePath)) {
      annotations.set(imagePath, [])
    }
    annotations.get(imagePath)!.push(...parsed)
  }
}
