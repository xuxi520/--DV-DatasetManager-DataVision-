/**
 * LabelMe 格式导入器（每图一个 .json）
 *
 * 结构：xxx.jpg + xxx.json（同目录同名，或任意目录同名）
 *   {
 *     "imagePath": "xxx.jpg",
 *     "imageHeight": H, "imageWidth": W,
 *     "shapes": [
 *       { "label": "apple", "shape_type": "rectangle", "points": [[x1,y1],[x2,y2]] },
 *       { "label": "dog",   "shape_type": "polygon",    "points": [[x,y], ...] },
 *       { "label": "ball",  "shape_type": "circle",     "points": [[cx,cy],[rx,ry]] }
 *     ]
 *   }
 * bbox 归一化为 [cx, cy, w, h]（0~1）；polygon/segmentation 归一化为点序列。
 * 归一化以 json 自带的 imageWidth/imageHeight 为基准。
 */
import { ClassRegistry } from '../classRegistry'
import type { CanonicalSample, CanonicalAnnotation, SplitKey } from '../types'
import {
  VirtualFile,
  normSlash,
  isImagePath,
  ext,
  baseName,
  dirName,
  detectSplit,
  detectCategory,
} from './shared'

export async function importLabelme(
  files: VirtualFile[]
): Promise<{ samples: CanonicalSample[]; registry: ClassRegistry; warnings: string[] }> {
  const norm = files.map((f) => ({ ...f, path: normSlash(f.path) }))
  const registry = new ClassRegistry()
  const warnings: string[] = []

  const images = norm.filter((f) => isImagePath(f.path))
  const jsonFiles = norm.filter((f) => ext(f.path).toLowerCase() === '.json')

  // 按 stem（去扩展名文件名）索引 json，同目录优先
  const jsonByStemDir = new Map<string, VirtualFile>()
  const jsonByStem = new Map<string, VirtualFile>()
  for (const jf of jsonFiles) {
    const stem = baseName(jf.path).toLowerCase()
    const d = dirName(jf.path).toLowerCase()
    jsonByStemDir.set(`${d}::${stem}`, jf)
    if (!jsonByStem.has(stem)) jsonByStem.set(stem, jf)
  }

  const samples: CanonicalSample[] = []

  for (const img of images) {
    const split: SplitKey = detectSplit(img.path)
    const category = detectCategory(img.path)
    const stem = baseName(img.path).toLowerCase()
    const d = dirName(img.path).toLowerCase()
    const jf = jsonByStemDir.get(`${d}::${stem}`) || jsonByStem.get(stem)

    const anns: CanonicalAnnotation[] = []
    let width: number | undefined
    let height: number | undefined

    if (jf) {
      let data: any
      try {
        data = JSON.parse(await jf.getText())
      } catch {
        warnings.push(`无法解析 LabelMe json: ${jf.path}`)
        // 仍保留图片占位，标注为空
        samples.push({
          id: img.path,
          sourcePath: img.path,
          split,
          category,
          imageExt: ext(img.path).toLowerCase(),
          getBytes: img.getBytes,
          annotations: anns,
          width,
          height,
        })
        continue
      }

      width = data.imageWidth || undefined
      height = data.imageHeight || undefined
      const W = width || 1
      const H = height || 1
      const shapes: any[] = Array.isArray(data.shapes) ? data.shapes : []

      for (const shape of shapes) {
        const label = shape.label || 'unknown'
        const classId = registry.add(label)
        const description = typeof shape.description === 'string' ? shape.description : undefined
        const confidence = typeof shape.score === 'number' ? shape.score : undefined
        const points: number[][] = Array.isArray(shape.points) ? shape.points : []
        const shapeType = String(shape.shape_type || '').toLowerCase()

        // 归一化辅助
        const nx = (x: number) => x / W
        const ny = (y: number) => y / H

        if (points.length < 2) continue

        if (shapeType === 'rectangle' || shapeType === 'rect' || shapeType === 'line') {
          const [a, b] = points
          const x1 = Math.min(a[0], b[0])
          const y1 = Math.min(a[1], b[1])
          const w = Math.abs(b[0] - a[0])
          const h = Math.abs(b[1] - a[1])
          anns.push({
            type: 'bbox' as const,
            classId,
            coords: [(x1 + w / 2) / W, (y1 + h / 2) / H, w / W, h / H],
            description,
            confidence,
          })
        } else if (shapeType === 'circle' && points.length >= 2) {
          const [center, edge] = points
          const r = Math.hypot(edge[0] - center[0], edge[1] - center[1])
          anns.push({
            type: 'bbox' as const,
            classId,
            coords: [center[0] / W, center[1] / H, (2 * r) / W, (2 * r) / H],
            description,
            confidence,
          })
        } else if (points.length >= 3) {
          // polygon / segmentation：输出归一化点序列 [(x,y), ...]
          const flat: number[] = []
          for (const p of points) {
            flat.push(nx(p[0]), ny(p[1]))
          }
          anns.push({ type: 'polygon' as const, classId, coords: flat, description, confidence })
        }
      }
    } else {
      warnings.push(`LabelMe 图片 ${img.path} 无对应 json 标注`)
    }

    samples.push({
      id: img.path,
      sourcePath: img.path,
      split,
      category,
      imageExt: ext(img.path).toLowerCase(),
      getBytes: img.getBytes,
      annotations: anns,
      width,
      height,
    })
  }

  if (samples.length === 0) warnings.push('未找到任何 LabelMe 图片')
  return { samples, registry, warnings }
}
