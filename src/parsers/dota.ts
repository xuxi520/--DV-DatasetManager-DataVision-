import type { ParsedAnnotation, RawFileMap, GetCategoryColor } from './types'
import { stem } from './pathUtils'

export function parseDota(
  annotations: Map<string, ParsedAnnotation[]>,
  txtPath: string,
  files: RawFileMap,
  imagePaths: string[],
  getCategoryColor: GetCategoryColor,
): void {
  const file = files.get(txtPath)
  if (!file || !file.content || !file.content.trim()) return

  const baseName = txtPath.split('/').pop() || txtPath.split('\\').pop() || ''

  // 读取类别名称
  let classNames: string[] = []
  const classFile = [...files.keys()].find((k) => /classes\.txt$/i.test(k))
  if (classFile) {
    classNames = (files.get(classFile)?.content || '')
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  const lines = file.content.trim().split('\n').filter((l) => l.trim())

  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 9) continue // DOTA 格式至少需要 9 个字段
    const [x1, y1, x2, y2, x3, y3, x4, y4, className, difficult] = parts

    const pts: [number, number][] = [
      [parseFloat(x1), parseFloat(y1)],
      [parseFloat(x2), parseFloat(y2)],
      [parseFloat(x3), parseFloat(y3)],
      [parseFloat(x4), parseFloat(y4)],
    ]

    if (pts.some((p) => isNaN(p[0]) || isNaN(p[1]))) continue

    const category = className || 'object'
    getCategoryColor(category)

    // 计算边界框 (axis-aligned bounding box)
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const bbox: [number, number, number, number] = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ]

    // 尝试找到对应的图片（DOTA 格式通常一个 txt 对应多张图片）
    const txtStem = baseName.replace(/\.(txt|csv)$/i, '')
    const imagePath =
      imagePaths.find((p) => stem(p) === txtStem || p.includes(txtStem)) || imagePaths[0]
    if (!imagePath) continue

    const ann: ParsedAnnotation = {
      type: 'polygon',
      bbox,
      points: pts,
      bboxType: 'obb', // 定向边界框
      category,
      color: getCategoryColor(category),
      description: `difficult: ${difficult || 0}`,
    }

    if (!annotations.has(imagePath)) {
      annotations.set(imagePath, [])
    }
    annotations.get(imagePath)!.push(ann)
  }
}
