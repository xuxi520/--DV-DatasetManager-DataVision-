import type { ParsedAnnotation, RawFileMap, GetCategoryColor } from './types'
import { stem, dir } from './pathUtils'

export function parseVocContent(
  content: string,
  name: string,
  getCategoryColor: GetCategoryColor,
): ParsedAnnotation[] {
  const arr: ParsedAnnotation[] = []
  const objs = content.match(/<object>[\s\S]*?<\/object>/g) || []
  for (const obj of objs) {
    const nameMatch = obj.match(/<name>(.*?)<\/name>/)
    if (!nameMatch) continue
    const label = nameMatch[1]
    const bndbox = obj.match(/<bndbox>([\s\S]*?)<\/bndbox>/)
    if (bndbox) {
      const xmin = parseFloat((bndbox[1].match(/<xmin>(.*?)<\/xmin>/) || [])[1] || '0')
      const ymin = parseFloat((bndbox[1].match(/<ymin>(.*?)<\/ymin>/) || [])[1] || '0')
      const xmax = parseFloat((bndbox[1].match(/<xmax>(.*?)<\/xmax>/) || [])[1] || '0')
      const ymax = parseFloat((bndbox[1].match(/<ymax>(.*?)<\/ymax>/) || [])[1] || '0')
      arr.push({
        type: 'bbox',
        bbox: [xmin, ymin, xmax - xmin, ymax - ymin],
        category: label,
        color: getCategoryColor(label),
        confidence: 1,
      })
    }
  }
  return arr
}

export function parseVoc(
  annotations: Map<string, ParsedAnnotation[]>,
  xmlPath: string,
  files: RawFileMap,
  imagePaths: string[],
  getCategoryColor: GetCategoryColor,
): void {
  const file = files.get(xmlPath)
  if (!file || !file.content) return

  const xmlStem = stem(xmlPath)
  const xmlDir = dir(xmlPath)

  let imagePath =
    imagePaths.find((p) => stem(p) === xmlStem && dir(p) === xmlDir) ||
    imagePaths.find((p) => stem(p) === xmlStem)

  if (!imagePath) return

  const arr = annotations.get(imagePath) || []
  if (!annotations.has(imagePath)) annotations.set(imagePath, arr)
  arr.push(...parseVocContent(file.content, imagePath, getCategoryColor))
}
