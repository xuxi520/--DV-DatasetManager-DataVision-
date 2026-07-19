import type { ParsedAnnotation, RawFileMap, GetCategoryColor } from './types'
import { stem } from './pathUtils'

export function parseCoco(
  annotations: Map<string, ParsedAnnotation[]>,
  data: any,
  _files: RawFileMap,
  imagePaths: string[],
  getCategoryColor: GetCategoryColor,
): void {
  const images: any[] = data.images || []
  const anns: any[] = data.annotations || []
  const cats: any[] = data.categories || []
  const catName = new Map<number, string>()
  for (const c of cats) catName.set(c.id, c.name)
  const imgFile = new Map<number, string>()
  for (const im of images) {
    const fileName = im.file_name || ''
    // 与 HEAD 原版一致：优先把 image_id 解析为「数据集中真实存在的图片路径」，
    // 否则标注会以 file_name 为 key，与 imagePaths 不匹配导致不显示。
    const imagePath =
      imagePaths.find(
        (p) => p.split('/').pop() === fileName || p.split('\\').pop() === fileName,
      ) ||
      imagePaths.find((p) => stem(p) === String(fileName).replace(/\.[^.]+$/, ''))
    if (imagePath) {
      imgFile.set(im.id, imagePath)
      if (!annotations.has(imagePath)) annotations.set(imagePath, [])
    } else {
      const f = im.file_name || `img${im.id}`
      imgFile.set(im.id, f)
      if (!annotations.has(f)) annotations.set(f, [])
    }
  }
  for (const a of anns) {
    const f = imgFile.get(a.image_id)
    if (!f) continue
    const name = catName.get(a.category_id)
    if (!name) continue
    const arr = annotations.get(f)!
    if (a.keypoints) {
      const kp = a.keypoints
      const pts: any[] = []
      for (let i = 0; i < kp.length; i += 3) pts.push({ x: kp[i], y: kp[i + 1], v: kp[i + 2] })
      arr.push({
        type: 'keypoint',
        keypoints: pts,
        edges: data.keypoint_edges || data.edges,
        category: name,
        color: getCategoryColor(name),
        confidence: 1,
      })
      continue
    }
    if (a.segmentation) {
      const segs = a.segmentation
      for (const seg of segs) {
        if (Array.isArray(seg) && seg.length >= 6) {
          const pts: [number, number][] = []
          for (let i = 0; i < seg.length; i += 2) pts.push([seg[i], seg[i + 1]])
          arr.push({
            type: 'polygon',
            points: pts,
            category: name,
            color: getCategoryColor(name),
            confidence: 1,
          })
        }
      }
      if (a.bbox) {
        arr.push({
          type: 'bbox',
          bbox: [a.bbox[0], a.bbox[1], a.bbox[2], a.bbox[3]],
          category: name,
          color: getCategoryColor(name),
          confidence: 1,
          rle: a.keypoints ? undefined : (a.segmentation && typeof a.segmentation === 'object' && !Array.isArray(a.segmentation) && a.segmentation.counts ? { size: a.segmentation.size, counts: a.segmentation.counts } : undefined),
          iscrowd: a.iscrowd,
        })
      }
      continue
    }
    if (a.bbox) {
      arr.push({
        type: 'bbox',
        bbox: [a.bbox[0], a.bbox[1], a.bbox[2], a.bbox[3]],
        category: name,
        color: getCategoryColor(name),
        confidence: 1,
      })
    }
  }
}
