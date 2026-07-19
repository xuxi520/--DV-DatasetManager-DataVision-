import type { ParsedAnnotation, RawFileMap, GetCategoryColor } from './types'
import { stem, dir } from './pathUtils'

export function parseGeneric(
  annotations: Map<string, ParsedAnnotation[]>,
  data: any,
  jsonPath: string,
  files: RawFileMap,
  imagePaths: string[],
  getCategoryColor: GetCategoryColor,
): void {
  const jsonStem = stem(jsonPath)
  const jsonDir = dir(jsonPath)

  let imagePath =
    imagePaths.find((p) => stem(p) === jsonStem && dir(p) === jsonDir) ||
    imagePaths.find((p) => stem(p) === jsonStem)

  if (!imagePath) return

  const items = Array.isArray(data)
    ? data
    : data.objects || data.detections || data.annotations || data.labels || []
  if (!Array.isArray(items) || !items.length) return

  const parsed = items
    .map((obj: any) => {
      const category = obj.label || obj.name || obj.category || obj.class || 'object'
      getCategoryColor(category)

      const ann: ParsedAnnotation = {
        type: 'bbox',
        category,
        color: getCategoryColor(category),
        confidence: obj.confidence || obj.score || undefined,
        description: obj.description || obj.text || undefined,
      }

      if (obj.bbox && Array.isArray(obj.bbox) && obj.bbox.length >= 4) {
        const [x, y, w, h] = obj.bbox
        ann.bbox = [x, y, Math.abs(w), Math.abs(h)]
      } else if (obj.x != null && obj.width != null) {
        ann.bbox = [obj.x || 0, obj.y || 0, obj.width || 0, obj.height || 0]
      } else if (obj.points && Array.isArray(obj.points) && obj.points.length >= 3) {
        ann.type = 'polygon'
        ann.points = obj.points.map((pt: any) =>
          Array.isArray(pt) ? [pt[0], pt[1]] : [pt.x || 0, pt.y || 0],
        )
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
