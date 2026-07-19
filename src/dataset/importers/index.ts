/**
 * 导入入口：自动识别格式并分发到对应导入器，产出规范数据集
 */
import { ClassRegistry } from '../classRegistry'
import type { CanonicalDataset, DatasetFormat, FormatDetection } from '../types'
import {
  VirtualFile,
  normSlash,
  isImagePath,
  ext,
  baseName,
  detectSplit,
  looksLikeCocoByFilename,
  SAFE_PEEK_BYTES,
} from './shared'
import { importYolo } from './yolo'
import { importFolder } from './folder'
import { importCoco } from './coco'
import { importVoc } from './voc'
import { importLabelme } from './labelme'
import { importDota } from './dota'

const FORMAT_PRIORITY: DatasetFormat[] = ['coco', 'voc', 'labelme', 'dota', 'yolo', 'folder', 'unknown']

/**
 * 格式识别（多信号打分，而非首匹配即返回）。
 *
 * 不同格式由不同扩展名主导（COCO/LabelMe=json，VOC=xml，YOLO=txt），
 * 故对每种格式独立采样若干文件计算「像该格式」的程度并累加得分，最后取最高分；
 * 同分时按 FORMAT_PRIORITY 保序，尽量贴近旧行为。
 */
export async function detectDatasetFormat(files: VirtualFile[]): Promise<FormatDetection> {
  const norm = files.map((f) => ({ ...f, path: normSlash(f.path) }))
  const scores: Partial<Record<DatasetFormat, number>> = {}
  const evidence: string[] = []
  const add = (k: DatasetFormat, v: number, why: string) => {
    if (v <= 0) return
    scores[k] = (scores[k] ?? 0) + v
    evidence.push(`${k} +${v}：${why}`)
  }

  const jsonFiles = norm.filter((f) => ext(f.path).toLowerCase() === '.json')
  const xmlFiles = norm.filter((f) => ext(f.path).toLowerCase() === '.xml')
  const images = norm.filter((f) => isImagePath(f.path))
  const txts = norm.filter(
    (f) => ext(f.path).toLowerCase() === '.txt' && baseName(f.path).toLowerCase() !== 'classes'
  )

  // COCO：json 含 images + categories（+annotations 更强）
  // 注意：禁止对巨型标注文件做全文读取（COCO val2017 单 json 可达 200MB+，
  // JSON.parse 会卡死主线程）。优先按文件名约定判定，仅对小文件做内容窥探。
  let cocoLike = 0
  let cocoInspected = 0
  for (const jf of jsonFiles.slice(0, 8)) {
    const name = baseName(jf.path)
    if (looksLikeCocoByFilename(name)) {
      cocoLike++
      add('coco', 12, `json 文件名匹配 COCO 标注约定：${jf.path}`)
      continue
    }
    // 仅对小于安全上限的文件做内容窥探，巨型文件直接跳过（依赖文件名推断）
    if (jf.size !== undefined && jf.size > SAFE_PEEK_BYTES) continue
    cocoInspected++
    try {
      const data = JSON.parse(await jf.getText())
      if (data && Array.isArray(data.images) && Array.isArray(data.categories)) {
        cocoLike++
        add('coco', Array.isArray(data.annotations) ? 12 : 8, `json 含 images/categories${Array.isArray(data.annotations) ? '/annotations' : ''}：${jf.path}`)
      }
    } catch {
      /* 非对象 json，忽略 */
    }
  }
  if (jsonFiles.length && cocoLike === 0 && cocoInspected > 0) {
    // 仅当我们确实检查过内容且都不是 COCO 结构时才负向，避免误伤大文件非标准命名
    add('coco', -4, '存在 .json 但无 COCO 结构')
  }

  // VOC：xml 含 <object> + <bndbox>（或旋转框 <robndbox>）
  let vocLike = 0
  for (const xf of xmlFiles.slice(0, 8)) {
    const t = await xf.getText()
    if (/<object>/i.test(t) && /<bndbox>/i.test(t)) {
      vocLike++
      add('voc', 10, `xml 含 <object>/<bndbox>：${xf.path}`)
    } else if (/<object>/i.test(t) && /<robndbox>/i.test(t)) {
      vocLike++
      add('voc', 10, `xml 含 <object>/<robndbox>（旋转框）：${xf.path}`)
    }
  }

  // LabelMe：json 含 shapes 数组，且不是 COCO（无 images 顶层）
  // 同样仅对小于安全上限的小文件窥探，巨型文件跳过（避免卡死主线程）
  for (const jf of jsonFiles.slice(0, 8)) {
    const name = baseName(jf.path)
    if (looksLikeCocoByFilename(name)) continue // COCO 优先，跳过
    if (jf.size !== undefined && jf.size > SAFE_PEEK_BYTES) continue
    try {
      const data = JSON.parse(await jf.getText())
      if (Array.isArray(data.shapes) && !Array.isArray(data.images)) {
        add('labelme', 10, `json 含 shapes 数组（非 COCO）：${jf.path}`)
      }
    } catch {
      /* 非对象 json，忽略 */
    }
  }

  // YOLO：data.yaml / classes.txt 强信号 + 标注 txt 多为 5 列数字行
  const hasYaml = norm.some((f) => /(^|\/)data\.yaml$/i.test(f.path))
  const hasClasses = norm.some(
    (f) => baseName(f.path).toLowerCase() === 'classes' && ext(f.path).toLowerCase() === '.txt'
  )
  if (hasYaml) add('yolo', 14, '存在 data.yaml')
  if (hasClasses) add('yolo', 12, '存在 classes.txt')

  // DOTA：txt 行形如「8 个数字角点 + 类别名（+ 可选 difficult/score）」，
  // 与 YOLO（5/6/5+3k 列数字）可区分；识别到即优先于 yolo。
  let dotaLike = 0
  for (const tf of txts.slice(0, 8)) {
    const lines = (await tf.getText()).split(/\r?\n/).filter(Boolean)
    if (lines.length === 0) continue
    const ok = lines.slice(0, 12).every((l) => {
      const p = l.trim().split(/\s+/)
      if (p.length < 9) return false
      const nums = p.slice(0, 8).map(Number)
      return nums.every((n) => isFinite(n)) && !/^\d+$/.test(p[8])
    })
    if (ok) dotaLike++
  }
  if (txts.length && dotaLike > 0) {
    add('dota', 16, `${dotaLike} 个 .txt 标注符合 DOTA 旋转框行格式`)
  }

  let yoloTxt = 0
  let yoloTxtTotal = 0
  for (const tf of txts.slice(0, 8)) {
    yoloTxtTotal++
    const lines = (await tf.getText()).split(/\r?\n/).filter(Boolean)
    if (
      lines.length > 0 &&
      lines.every((l) => {
        const p = l.trim().split(/\s+/)
        return p.length >= 5 && p.slice(0, 5).every((n) => isFinite(Number(n)))
      })
    ) {
      yoloTxt++
    }
  }
  if (yoloTxtTotal > 0 && yoloTxt / yoloTxtTotal >= 0.8) {
    add('yolo', 10, `${yoloTxt}/${yoloTxtTotal} 个 .txt 标注为 YOLO 格式行`)
  }

  // 分类文件夹：图片落在「非 split / 非 images|labels」的类别目录
  if (images.length) {
    const hasCategoryDir = images.some((f) => {
      const segs = normSlash(f.path).split('/').filter(Boolean)
      return segs.some(
        (s, i) =>
          i < segs.length - 1 &&
          !/(^|\/)(train|val|valid|test|images|labels)($|\/)/i.test('/' + s + '/')
      )
    })
    if (hasCategoryDir) add('folder', 8, '图片存在类别子目录')
  }

  // 兜底：有图片则倾向 YOLO（至少能按图导入）
  if (images.length) add('yolo', 1, '兜底：存在图片')

  // 取最高分；同分按优先级保序
  let best: DatasetFormat = 'unknown'
  let bestScore = -Infinity
  for (const k of FORMAT_PRIORITY) {
    const s = scores[k] ?? -1
    if (s > bestScore) {
      bestScore = s
      best = k
    }
  }
  if (bestScore < 0) best = 'unknown'

  return { format: best, scores, evidence }
}

/** 自动识别并导入为规范数据集；可传入 format 覆盖自动识别（用户纠错回路） */
export async function importDataset(
  files: VirtualFile[],
  opts?: { format?: DatasetFormat; annotationFilter?: Set<string> }
): Promise<CanonicalDataset> {
  const detection = opts?.format
    ? { format: opts.format, scores: { [opts.format]: 999 }, evidence: ['用户指定格式（覆盖自动识别）'] }
    : await detectDatasetFormat(files)
  const fmt = detection.format
  let samples: CanonicalDataset['samples'] = []
  let registry = new ClassRegistry()
  let warnings: string[] = []
  let annotationFiles: string[] = []

  switch (fmt) {
    case 'coco': {
      const r = await importCoco(files, opts?.annotationFilter ? { annotationFilter: opts.annotationFilter } : undefined)
      samples = r.samples
      registry = r.registry
      warnings = r.warnings
      annotationFiles = r.annotationFiles
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
    case 'dota': {
      const r = await importDota(files)
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
    detection,
    annotationFiles,
  }
}

// 便于外部复用
export { detectSplit }
export type { DatasetFormat, FormatDetection }
export { importYolo } from './yolo'
export { importFolder } from './folder'
export { importCoco } from './coco'
export { importVoc } from './voc'
export { importLabelme } from './labelme'
export { importDota } from './dota'
