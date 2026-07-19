/**
 * YOLO 格式导入器
 *
 * 支持布局（均归一化为 CanonicalDataset）：
 *   train/images/*.jpg + train/labels/*.txt (+ data.yaml)
 *   images/train/*.jpg + labels/train/*.txt
 *   train/images/<cat>/*.jpg + train/labels/<cat>/*.txt   （类别子目录）
 *   <dir>/*.jpg + <dir>/*.txt  （flat，配合 data.yaml 或 _darknet.labels）
 *
 * 类别真相优先级：data.yaml.names > classes.txt > 标注数字 id（回退为 class_N）
 */
import { ClassRegistry } from '../classRegistry'
import { parseDataYaml, parseClassesTxt } from '../dataYaml'
import type { CanonicalSample, SplitKey } from '../types'
import {
  VirtualFile,
  normSlash,
  isImagePath,
  ext,
  baseName,
  detectSplit,
  detectCategory,
  findLabelPath,
  parseYoloLine,
} from './shared'

const META_NAMES = new Set(['data', 'classes', '_darknet'])

/**
 * 由 data.yaml 的 train/val/test 路径推断图片所属子集。
 * 图片路径若命中某前缀（或其片段含 train/val/test 关键字）则相应归类，
 * 否则回退到路径关键字 detectSplit。
 */
function splitFromYaml(imagePath: string, yaml: { train?: string; val?: string; test?: string }): SplitKey {
  const checks: Array<[string | undefined, SplitKey]> = [
    [yaml.train, 'train'],
    [yaml.val ?? yaml.test, 'val'],
    [yaml.test, 'test'],
  ]
  const ip = normSlash(imagePath).toLowerCase()
  for (const [p, key] of checks) {
    if (!p) continue
    const np = normSlash(p).toLowerCase().replace(/^\.\//, '').replace(/\/+$/, '')
    if (!np) continue
    if (ip === np || ip.startsWith(np + '/') || ip.includes('/' + np + '/') || ip.includes(np)) {
      return key
    }
  }
  return 'unknown'
}

export async function importYolo(
  files: VirtualFile[]
): Promise<{ samples: CanonicalSample[]; registry: ClassRegistry; warnings: string[] }> {
  const norm = files.map((f) => ({ ...f, path: normSlash(f.path) }))
  const registry = new ClassRegistry()
  const warnings: string[] = []

  // 1) 元数据：data.yaml / classes.txt
  const yamlFile = norm.find((f) => /(^|\/)data\.yaml$/i.test(f.path))
  const classesFile = norm.find(
    (f) => baseName(f.path).toLowerCase() === 'classes' && ext(f.path).toLowerCase() === '.txt'
  )
  let yaml: { train?: string; val?: string; test?: string } = {}
  if (yamlFile) {
    const y = parseDataYaml(await yamlFile.getText())
    yaml = y
    if (y.names.length) registry.fromNameList(y.names)
    else warnings.push('data.yaml 未包含 names 字段，类别将按标注 id 推断')
  } else if (classesFile) {
    registry.fromNameList(parseClassesTxt(await classesFile.getText()))
  }

  // 2) 收集图片与标注
  const images = norm.filter((f) => isImagePath(f.path))
  const labelFiles = norm.filter(
    (f) =>
      ext(f.path).toLowerCase() === '.txt' &&
      !META_NAMES.has(baseName(f.path).toLowerCase())
  )
  const labelSet = new Set(labelFiles.map((f) => f.path))
  // 同名（stem）兜底映射：任意目录下，只要图片与标注文件名（去扩展名）相同即匹配，
  // 兼容扁平 / 任意子目录布局（与旧 annotationParser 行为一致）
  const labelByStem = new Map<string, string>()
  for (const p of labelSet) {
    const s = baseName(p).toLowerCase()
    if (!labelByStem.has(s)) labelByStem.set(s, p)
  }
  const labelText = new Map<string, Promise<string>>()
  const getLabelText = (p: string) => {
    let t = labelText.get(p)
    if (!t) {
      const f = labelFiles.find((x) => x.path === p)!
      t = f.getText()
      labelText.set(p, t)
    }
    return t
  }

  const samples: CanonicalSample[] = []
  let hasAnyLabel = labelSet.size > 0

  for (const img of images) {
    const split: SplitKey =
      yamlFile ? splitFromYaml(img.path, yaml) : detectSplit(img.path)
    const category = detectCategory(img.path)
    let labelPath = findLabelPath(img.path, labelSet)
    if (!labelPath) {
      // 兜底：整个数据集中同名（去扩展名）的标注文件
      const stem = baseName(img.path).toLowerCase()
      if (labelByStem.has(stem)) labelPath = labelByStem.get(stem)
    }

    const anns: any[] = []
    if (labelPath) {
      const text = await getLabelText(labelPath)
      for (const raw of text.split(/\r?\n/)) {
        const parsed = parseYoloLine(raw)
        if (!parsed) continue
        let classId = parsed.classId
        if (registry.hasAuthoritative) {
          if (classId >= registry.classes.length) {
            warnings.push(`标注 ${labelPath} 含越界 classId=${classId}（共 ${registry.classes.length} 类），已跳过该行`)
            continue
          }
        } else {
          // 无权威表：以数字 id 回退为 class_N，并扩展注册表
          while (registry.classes.length <= classId) {
            registry.add(`class_${registry.classes.length}`)
          }
          classId = parsed.classId
        }
        if (parsed.kind === 'obb') {
          anns.push({ type: 'obb' as const, coords: parsed.coords, rotation: parsed.rotation, classId })
        } else if (parsed.kind === 'pose') {
          anns.push({ type: 'keypoints' as const, coords: parsed.keypoints, classId })
        } else {
          anns.push({ type: 'bbox' as const, coords: parsed.coords, classId })
        }
      }
    } else if (hasAnyLabel) {
      warnings.push(`图片 ${img.path} 无对应标注文件`)
    }

    samples.push({
      id: img.path,
      sourcePath: img.path,
      split,
      category,
      imageExt: ext(img.path).toLowerCase(),
      getBytes: img.getBytes,
      annotations: anns,
    })
  }

  if (!hasAnyLabel && !registry.hasAuthoritative) {
    warnings.push('未找到标注文件与 data.yaml，已按图片导入（无类别信息）')
  }

  return { samples, registry, warnings }
}
