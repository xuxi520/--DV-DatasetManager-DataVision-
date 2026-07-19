import type { ParsedAnnotation, RawFileMap, GetCategoryColor } from './types'

export function parseMot(
  annotations: Map<string, ParsedAnnotation[]>,
  txtPath: string,
  files: RawFileMap,
  imagePaths: string[],
  getCategoryColor: GetCategoryColor,
): void {
  const file = files.get(txtPath)
  if (!file || !file.content || !file.content.trim()) return

  const lines = file.content.trim().split('\n').filter((l) => l.trim())

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
      visibility: parseFloat(parts[8]) || 1,
    })
  }

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

  // 为每一帧图片添加标注
  for (const [frameNum, objects] of frameMap) {
    // 查找对应的图片（通常按帧号命名：000001.jpg, 000002.jpg）
    const imagePath =
      imagePaths.find((p) => {
        const name = p.split('/').pop() || p.split('\\').pop() || ''
        const stemName = name.replace(/\.[^.]+$/, '')
        // 匹配帧号 (支持 000001, frame_000001 等格式)
        return (
          stemName === String(frameNum).padStart(6, '0') ||
          stemName === String(frameNum).padStart(4, '0') ||
          stemName.endsWith('_' + String(frameNum).padStart(6, '0')) ||
          stemName.endsWith('_' + String(frameNum).padStart(4, '0'))
        )
      }) || imagePaths[Math.min(frameNum - 1, imagePaths.length - 1)]

    if (!imagePath) continue

    const parsed: ParsedAnnotation[] = objects.map((obj) => {
      const category = classNames[obj.classId] || `class_${obj.classId}`
      getCategoryColor(category)

      return {
        type: 'bbox' as const,
        bbox: [obj.bbLeft, obj.bbTop, obj.bbWidth, obj.bbHeight] as [
          number,
          number,
          number,
          number,
        ],
        category,
        color: getCategoryColor(category),
        trackId: obj.trackId,
        confidence: obj.conf,
        description: `visibility: ${obj.visibility}`,
      }
    })

    if (parsed.length) {
      if (!annotations.has(imagePath)) annotations.set(imagePath, [])
      annotations.get(imagePath)!.push(...parsed)
    }
  }
}
