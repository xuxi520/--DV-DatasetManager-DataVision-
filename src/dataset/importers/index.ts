/**
 * 导入入口：自动识别格式并分发到对应导入器，产出规范数据集
 */
import { ClassRegistry } from '../classRegistry'
import type { CanonicalDataset, DatasetFormat } from '../types'
import {
  VirtualFile,
  normSlash,
  isImagePath,
  ext,
  baseName,
  detectSplit,
} from './shared'
import { importYolo } from './yolo'
import { importFolder } from './folder'
import { importCoco } from './coco'
import { importVoc } from './voc'
import { importLabelme } from './labelme'

async function detectFormat(files: VirtualFile[]): Promise<DatasetFormat> {
  const norm = files.map((f) => ({ ...f, path: normSlash(f.path) }))

  // 1) COCO：含 instances_*.json 且结构带 images/categories
  const jsonFiles = norm.filter((f) => ext(f.path).toLowerCase() === '.json')
  for (const jf of jsonFiles) {
    try {
      const head = (await jf.getText()).slice(0, 2000)
      if (/["']?images["']?\s*:\s*\[/.test(head) && /["']?categories["']?\s*:\s*\[/.test(head)) {
        return 'coco'
      }
    } catch {
      /* ignore */
    }
  }

  // 2) VOC：含 <object> + <bndbox> 的 xml
  const xmlFiles = norm.filter((f) => ext(f.path).toLowerCase() === '.xml')
  for (const xf of xmlFiles.slice(0, 5)) {
    const t = await xf.getText()
    if (/<object>/i.test(t) && /<bndbox>/i.test(t)) return 'voc'
  }

  // 2.5) LabelMe：每图一个 .json，含 shapes 数组（如 validation_apple_Image_1.json）
  for (const jf of jsonFiles.slice(0, 5)) {
    try {
      const data = JSON.parse(await jf.getText())
      if (Array.isArray(data.shapes)) return 'labelme'
    } catch {
      /* 不是合法 JSON，忽略 */
    }
  }

  // 3) YOLO：有 data.yaml / classes.txt，或存在 images+labels 同构
  const hasYaml = norm.some((f) => /(^|\/)data\.yaml$/i.test(f.path))
  const hasClasses = norm.some(
    (f) => baseName(f.path).toLowerCase() === 'classes' && ext(f.path).toLowerCase() === '.txt'
  )
  if (hasYaml || hasClasses) return 'yolo'

  const images = norm.filter((f) => isImagePath(f.path))
  const txts = norm.filter(
    (f) => ext(f.path).toLowerCase() === '.txt' && baseName(f.path).toLowerCase() !== 'classes'
  )
  if (images.length && txts.length) {
    // 是否存在「同目录同名 .txt」暗示 YOLO 标注
    const imgBase = new Set(images.map((f) => baseName(f.path).toLowerCase()))
    const labeled = txts.some((t) => imgBase.has(baseName(t.path).toLowerCase()))
    if (labeled) return 'yolo'
  }
  // 路径含 train/val/test + labels
  if (norm.some((f) => /(^|\/)(train|val|valid|test)($|\/)/i.test(f.path) && /(\/|^)labels(\/|$)/i.test(f.path)))
    return 'yolo'

  // 4) 分类文件夹：有图片且存在「非 split」类别目录
  if (images.length) {
    const hasCategoryDir = images.some((f) => {
      const segs = normSlash(f.path).split('/').filter(Boolean)
      return segs.some(
        (s, i) =>
          i < segs.length - 1 &&
          !/(^|\/)(train|val|valid|test|images|labels)($|\/)/i.test('/' + s + '/')
      )
    })
    if (hasCategoryDir) return 'folder'
  }

  // 兜底：按 YOLO 尝试（有标注则生效，否则仅图片）
  return images.length ? 'yolo' : 'unknown'
}

/** 自动识别并导入为规范数据集 */
export async function importDataset(files: VirtualFile[]): Promise<CanonicalDataset> {
  const fmt = await detectFormat(files)
  let samples: CanonicalDataset['samples'] = []
  let registry = new ClassRegistry()
  let warnings: string[] = []

  switch (fmt) {
    case 'coco': {
      const r = await importCoco(files)
      samples = r.samples
      registry = r.registry
      warnings = r.warnings
      break
    }
    case 'voc': {
      const r = await importVoc(files)
      samples = r.samples
      registry = r.registry
      warnings = r.warnings
      break
    }
    case 'folder': {
      const r = await importFolder(files)
      samples = r.samples
      registry = r.registry
      warnings = r.warnings
      break
    }
    case 'labelme': {
      const r = await importLabelme(files)
      samples = r.samples
      registry = r.registry
      warnings = r.warnings
      break
    }
    case 'yolo':
    default: {
      const r = await importYolo(files)
      samples = r.samples
      registry = r.registry
      warnings = r.warnings
      break
    }
  }

  // 若完全无类别信息，给一个占位类避免导出崩溃
  if (registry.classes.length === 0) {
    registry.add('object')
    warnings.push('未识别到任何类别，已添加占位类别 "object"')
  }

  return {
    classes: registry.classes,
    samples,
    sourceFormat: fmt,
    warnings,
  }
}

// 便于外部复用
export { detectSplit }
export type { DatasetFormat }
export { importYolo } from './yolo'
export { importFolder } from './folder'
export { importCoco } from './coco'
export { importVoc } from './voc'
export { importLabelme } from './labelme'
