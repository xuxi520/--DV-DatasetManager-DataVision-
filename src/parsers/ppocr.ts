import type { ParsedAnnotation, RawFileMap, GetCategoryColor } from './types'
import { stem, dir } from './pathUtils'

export function parsePpocr(
  annotations: Map<string, ParsedAnnotation[]>,
  txtPath: string,
  files: RawFileMap,
  imagePaths: string[],
  getCategoryColor: GetCategoryColor,
): void {
  const file = files.get(txtPath)
  if (!file || !file.content || !file.content.trim()) return

  const lines = file.content.trim().split('\n').filter((l) => l.trim())
  const txtDir = dir(txtPath)

  for (const line of lines) {
    const tabIndex = line.indexOf('\t')
    if (tabIndex < 0) continue

    const imageName = line.substring(0, tabIndex)
    const annotationStr = line.substring(tabIndex + 1)

    // 查找对应的图片
    let imagePath = imagePaths.find(
      (p) => p.endsWith('/' + imageName) || p.endsWith('\\' + imageName),
    )

    if (!imagePath) {
      // 尝试按文件名匹配
      const imageNameStem = imageName.replace(/\.[^.]+$/, '')
      imagePath = imagePaths.find((p) => stem(p) === imageNameStem)
    }

    if (!imagePath) continue

    // 解析标注 JSON
    try {
      const annotations_data = JSON.parse(annotationStr)
      if (!Array.isArray(annotations_data)) continue

      const parsed: ParsedAnnotation[] = annotations_data
        .map((ann: any) => {
          const text = ann.transcription || ann.text || ''
          getCategoryColor('text')

          let points: [number, number][] = []
          let bbox: [number, number, number, number] = [0, 0, 0, 0]

          if (ann.points && Array.isArray(ann.points)) {
            points = ann.points.map((pt: any) =>
              Array.isArray(pt) ? ([pt[0], pt[1]] as [number, number]) : ([pt.x || 0, pt.y || 0] as [number, number]),
            )

            // 计算边界框
            const xs = points.map((p) => p[0])
            const ys = points.map((p) => p[1])
            bbox = [
              Math.min(...xs),
              Math.min(...ys),
              Math.max(...xs) - Math.min(...xs),
              Math.max(...ys) - Math.min(...ys),
            ]
          }

          return {
            type: points.length >= 3 ? ('polygon' as const) : ('bbox' as const),
            bbox,
            points: points.length >= 3 ? points : undefined,
            category: 'text',
            color: getCategoryColor('text'),
            text,
            confidence: ann.confidence || ann.score,
            description: `difficulty: ${ann.difficulty || 0}`,
          }
        })
        .filter(Boolean)

      if (parsed.length) {
        if (!annotations.has(imagePath)) annotations.set(imagePath, [])
        annotations.get(imagePath)!.push(...parsed)
      }
    } catch (e) {
      console.warn('PPOCR 解析失败:', line.substring(0, 50))
    }
  }
}
