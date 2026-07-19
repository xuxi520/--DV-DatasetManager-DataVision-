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
    let rawTop: Record<string, unknown> | undefined

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
      // 保留原始顶层 JSON（去掉 shapes）以便无损回写 version/flags/imageData 等
      rawTop = { ...data }
      delete (rawTop as Record<string, unknown>).shapes

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
          // X-AnyLabeling 的 rectangle 为 4 个角点（TL,TR,BR,BL）；LabelMe 为 2 个对角点。
          // 统一取「全部点」的 min/max 包围盒，避免 4 点被截断成「左上+右上」导致高度=0、渲染成一条线。
          let xs: number[], ys: number[]
          if (points.length >= 4) {
            xs = points.map((p) => p[0])
            ys = points.map((p) => p[1])
          } else {
            xs = [points[0][0], points[1][0]]
            ys = [points[0][1], points[1][1]]
          }
          const x1 = Math.min(...xs)
          const y1 = Math.min(...ys)
          const w = Math.max(...xs) - x1
          const h = Math.max(...ys) - y1
          anns.push({
            type: 'bbox' as const,
            classId,
            coords: [(x1 + w / 2) / W, (y1 + h / 2) / H, w / W, h / H],
            description,
            confidence,
            raw: shape,
          })
        } else if (shapeType === 'rotated_rectangle' && points.length >= 4) {
          // 旋转框：4 角点（TL,TR,BR,BL）→ obb（cx,cy,w,h,rotation）
          const p0 = points[0]
          const p1 = points[1]
          const p2 = points[2]
          const cx = points.reduce((s, p) => s + p[0], 0) / points.length
          const cy = points.reduce((s, p) => s + p[1], 0) / points.length
          const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
          const h = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
          const angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0])
          anns.push({
            type: 'obb' as const,
            classId,
            coords: [cx / W, cy / H, w / W, h / H],
            rotation: angle,
            description,
            confidence,
            raw: shape,
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
            raw: shape,
          })
        } else if (points.length >= 3) {
          // polygon / segmentation：输出归一化点序列 [(x,y), ...]
          const flat: number[] = []
          for (const p of points) {
            flat.push(nx(p[0]), ny(p[1]))
          }
          anns.push({ type: 'polygon' as const, classId, coords: flat, description, confidence, raw: shape })
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
      ...(rawTop ? { rawTop } : {}),
    })
  }

  if (samples.length === 0) warnings.push('未找到任何 LabelMe 图片')
  return { samples, registry, warnings }
}
