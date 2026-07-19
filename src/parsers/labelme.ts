import type { ParsedAnnotation, RawFileMap, GetCategoryColor } from './types'
import { stem, dir } from './pathUtils'

export function parseLabelMe(
  annotations: Map<string, ParsedAnnotation[]>,
  data: any,
  jsonPath: string,
  files: RawFileMap,
  imagePaths: string[],
  getCategoryColor: GetCategoryColor,
): void {
  const jsonStem = stem(jsonPath)
  const jsonDir = dir(jsonPath)

  // 查找匹配图片
  let imagePath =
    imagePaths.find((p) => stem(p) === jsonStem && dir(p) === jsonDir) ||
    imagePaths.find((p) => stem(p) === jsonStem)

  if (!imagePath) return

  const parsed = (data.shapes || [])
    .map((shape: any) => {
      const category = shape.label || 'unknown'
      getCategoryColor(category)

      const ann: ParsedAnnotation = {
        type: 'bbox',
        category,
        color: getCategoryColor(category),
        confidence: shape.score, // 解析置信度
        description: shape.description, // 解析描述信息
      }

      if (
        (shape.shape_type === 'rectangle' || shape.shape_type === 'rect') &&
        shape.points.length >= 2
      ) {
        const [a, b] = shape.points
        ann.bbox = [
          Math.min(a[0], b[0]),
          Math.min(a[1], b[1]),
          Math.abs(b[0] - a[0]),
          Math.abs(b[1] - a[1]),
        ]
      } else if (shape.shape_type === 'circle' && shape.points.length >= 2) {
        const [center, radius] = shape.points
        const r = Math.hypot(radius[0] - center[0], radius[1] - center[1])
        ann.bbox = [center[0] - r, center[1] - r, r * 2, r * 2]
      } else if (shape.points && shape.points.length >= 3) {
        ann.type = 'polygon'
        ann.points = shape.points.map((pt: number[]) => [pt[0], pt[1]])
        // 计算边界框
        const xs = ann.points!.map((p) => p[0])
        const ys = ann.points!.map((p) => p[1])
        ann.bbox = [
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs) - Math.min(...xs),
          Math.max(...ys) - Math.min(...ys),
        ]
      }

      return ann
    })
    .filter(Boolean)

  if (parsed.length) {
    if (!annotations.has(imagePath)) annotations.set(imagePath, [])
    annotations.get(imagePath)!.push(...parsed)
  }
}
