/**
 * 标注解析调度器：按文件扩展名/结构分派到各格式解析器。
 * 各格式解析逻辑已拆分到同级文件（与 importers/ 导入层对称）。
 *
 * 契约（与原版 parseAllAnnotations 一致）：除 COCO/LabelMe/Generic 收已解析
 * 的 JSON data 外，其余解析器均收「文件名 path」参数，内部通过 files.get(path)
 * 取内容，并用 stem(path) 匹配图片——切勿再传文件内容(content)，否则会把
 * 标注挂到乱码图片名下导致不显示。
 */
import type { ParsedAnnotation, RawFileMap, GetCategoryColor } from './types'
import { parseCoco } from './coco'
import { parseLabelMe } from './labelme'
import { parseGeneric } from './generic'
import { parseYolo } from './yolo'
import { parseVoc } from './voc'
import { parseDota } from './dota'
import { parseMot } from './mot'
import { parsePpocr } from './ppocr'

export type { ParsedAnnotation } from './types'

export function parseAllAnnotations(
  files: RawFileMap,
  imagePaths: string[],
  getCategoryColor: GetCategoryColor,
): Map<string, ParsedAnnotation[]> {
  const annotations = new Map<string, ParsedAnnotation[]>()
  const fileList = Array.from(files.values())
  const jsons = fileList.filter((f) => f.name.toLowerCase().endsWith('.json'))
  const txts = fileList.filter((f) => f.name.toLowerCase().endsWith('.txt'))
  const xmls = fileList.filter((f) => f.name.toLowerCase().endsWith('.xml'))
  const images = fileList.filter((f) => {
    const n = f.name.toLowerCase()
    return (
      n.endsWith('.png') ||
      n.endsWith('.jpg') ||
      n.endsWith('.jpeg') ||
      n.endsWith('.bmp') ||
      n.endsWith('.webp') ||
      n.endsWith('.tif') ||
      n.endsWith('.tiff')
    )
  })
  imagePaths = imagePaths || images.map((img) => img.name)
  const isCoco = jsons.some((j) => {
    try {
      const d = JSON.parse(j.content || '{}')
      return Array.isArray(d.images) && Array.isArray(d.annotations)
    } catch {
      return false
    }
  })
  for (const j of jsons) {
    try {
      const data = JSON.parse(j.content || '{}')
      if (isCoco) parseCoco(annotations, data, files, imagePaths, getCategoryColor)
      else if (data.shapes) parseLabelMe(annotations, data, j.path, files, imagePaths, getCategoryColor)
      else parseGeneric(annotations, data, j.path, files, imagePaths, getCategoryColor)
    } catch (e) {
      // 跳过无法解析的 JSON
    }
  }
  for (const t of txts) {
    if (/classes\.txt$/i.test(t.path)) continue // 跳过类别文件
    if (/yolov8_pose\.yaml$/i.test(t.path)) continue // 跳过配置文件
    try {
      parseYolo(annotations, t.path, files, imagePaths, getCategoryColor)
    } catch (e) {}
    try {
      parseDota(annotations, t.path, files, imagePaths, getCategoryColor)
    } catch (e) {}
  }
  for (const x of xmls) {
    try {
      parseVoc(annotations, x.path, files, imagePaths, getCategoryColor)
    } catch (e) {}
  }
  // MOT 格式（多目标跟踪）：gt.txt / det.txt
  const motFiles = [...files.keys()].filter((k) => /gt\.txt$|det\.txt$/i.test(k))
  for (const path of motFiles) {
    try {
      parseMot(annotations, path, files, imagePaths, getCategoryColor)
    } catch (e) {}
  }
  // PPOCR 格式（文本检测识别）：Label.txt
  const ppocrFiles = [...files.keys()].filter((k) => /Label\.txt$/i.test(k))
  for (const path of ppocrFiles) {
    try {
      parsePpocr(annotations, path, files, imagePaths, getCategoryColor)
    } catch (e) {}
  }
  return annotations
}
