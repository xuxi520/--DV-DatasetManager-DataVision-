import type { ParsedAnnotation, RawFileMap, GetCategoryColor } from './types'
import { stem, dir } from './pathUtils'

export function parseYolo(
  annotations: Map<string, ParsedAnnotation[]>,
  txtPath: string,
  files: RawFileMap,
  imagePaths: string[],
  getCategoryColor: GetCategoryColor,
): void {
  const file = files.get(txtPath)
  if (!file || !file.content || !file.content.trim()) return

  const txtStem = stem(txtPath)
  const txtDir = dir(txtPath)

  // 查找匹配图片（同名 + 同目录，或 labels 目录与 images 目录对应）
  let imagePath =
    imagePaths.find(
      (p) =>
        stem(p) === txtStem &&
        (dir(p) === txtDir ||
          dir(p).replace(/labels?\/?$/i, '') === txtDir.replace(/labels?\/?$/i, '')),
    ) || imagePaths.find((p) => stem(p) === txtStem)

  if (!imagePath) return

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

  // 解析标注
  const parsed = file.content
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
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
        color: getCategoryColor(category),
        confidence: 1,
      }
    })
    .filter(Boolean) as ParsedAnnotation[]

  if (parsed.length) {
    if (!annotations.has(imagePath)) annotations.set(imagePath, [])
    annotations.get(imagePath)!.push(...parsed)
  }
}
