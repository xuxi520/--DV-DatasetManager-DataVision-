import type { ParsedAnnotation, RawFileMap, GetCategoryColor } from './types'
import { stem, dir } from './pathUtils'

export function parseYoloPose(
  annotations: Map<string, ParsedAnnotation[]>,
  txtPath: string,
  files: RawFileMap,
  imagePaths: string[],
  getCategoryColor: GetCategoryColor,
  numKeypoints: number = 17, // 默认 COCO 17 关键点
): void {
  const file = files.get(txtPath)
  if (!file || !file.content || !file.content.trim()) return

  const txtStem = stem(txtPath)
  const txtDir = dir(txtPath)

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

      const ann: ParsedAnnotation = {
        type: 'bbox',
        bbox: [cx - w / 2, cy - h / 2, w, h] as [number, number, number, number],
        category,
        normalized: true,
        color: getCategoryColor(category),
        confidence: 1,
      }

      // 解析关键点（如果有）
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
            v: parseInt(parts[idx + 2]) || 0, // 0=不可见 1=遮挡, 2=可见
          })
        }
      }

      return ann
    })
    .filter(Boolean) as ParsedAnnotation[]

  if (parsed.length) {
    if (!annotations.has(imagePath)) annotations.set(imagePath, [])
    annotations.get(imagePath)!.push(...parsed)
  }
}
