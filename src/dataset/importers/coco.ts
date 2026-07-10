/**
 * COCO 格式导入器
 *
 * 结构：annotations/instances_train.json + train/*.jpg
 * 标注 bbox 为像素 [x, y, w, h]（左上角），归一化为 [cx, cy, w, h]。
 * categories 的 id 可能非连续，映射到本地连续 classId。
 */
import { ClassRegistry } from '../classRegistry'
import type { CanonicalSample, SplitKey } from '../types'
import {
  VirtualFile,
  normSlash,
  isImagePath,
  ext,
  baseName,
  detectSplit,
} from './shared'

interface CocoImage {
  id: number
  file_name: string
  width?: number
  height?: number
}
interface CocoAnn {
  image_id: number
  category_id: number
  bbox: number[]
}
interface CocoCat {
  id: number
  name: string
}

function cocoSplit(fileName: string): SplitKey {
  return detectSplit(fileName)
}

export async function importCoco(
  files: VirtualFile[]
): Promise<{ samples: CanonicalSample[]; registry: ClassRegistry; warnings: string[] }> {
  const norm = files.map((f) => ({ ...f, path: normSlash(f.path) }))
  const registry = new ClassRegistry()
  const warnings: string[] = []

  // 收集 COCO json
  const jsonFiles = norm.filter((f) => ext(f.path).toLowerCase() === '.json')
  const imageFiles = norm.filter((f) => isImagePath(f.path))
  const imageByBase = new Map<string, VirtualFile>()
  for (const f of imageFiles) {
    imageByBase.set(baseName(f.path).toLowerCase(), f)
    // 也以支持子目录形式匹配
    const sub = f.path.toLowerCase()
    if (!imageByBase.has('__' + sub)) imageByBase.set('__' + sub, f)
  }

  const samples: CanonicalSample[] = []
  const seenImgIds = new Set<number>()

  for (const jf of jsonFiles) {
    let data: any
    try {
      data = JSON.parse(await jf.getText())
    } catch (e) {
      warnings.push(`无法解析 COCO json: ${jf.path}`)
      continue
    }
    const imgs: CocoImage[] = data.images || []
    const anns: CocoAnn[] = data.annotations || []
    const cats: CocoCat[] = data.categories || []

    // category_id -> 本地 classId
    const catMap = new Map<number, number>()
    for (const c of cats) {
      if (!catMap.has(c.id)) {
        const id = registry.add(c.name)
        catMap.set(c.id, id)
      }
    }

    // image_id -> sample 草稿
    const imgMap = new Map<number, CanonicalSample>()
    for (const im of imgs) {
      if (seenImgIds.has(im.id)) continue
      seenImgIds.add(im.id)
      const split = cocoSplit(im.file_name)
      const vf =
        imageByBase.get(baseName(im.file_name).toLowerCase()) ||
        imageByBase.get('__' + normSlash(im.file_name).toLowerCase())
      if (!vf) {
        warnings.push(`COCO 图片缺失（未在文件中找到）: ${im.file_name}`)
      }
      const sample: CanonicalSample = {
        id: `coco:${im.id}`,
        sourcePath: im.file_name,
        split,
        category: '',
        imageExt: ext(im.file_name).toLowerCase() || '.jpg',
        getBytes: vf ? vf.getBytes : async () => new Uint8Array(),
        annotations: [],
        width: im.width,
        height: im.height,
      }
      imgMap.set(im.id, sample)
      samples.push(sample)
    }

    for (const a of anns) {
      const s = imgMap.get(a.image_id)
      if (!s) continue
      const clsId = catMap.get(a.category_id)
      if (clsId === undefined) {
        warnings.push(`标注含未知 category_id=${a.category_id}`)
        continue
      }
      const [x, y, w, h] = a.bbox
      const W = s.width || 1
      const H = s.height || 1
      s.annotations.push({
        type: 'bbox',
        classId: clsId,
        coords: [(x + w / 2) / W, (y + h / 2) / H, w / W, h / H],
      })
    }
  }

  if (samples.length === 0) warnings.push('未从 COCO json 解析出任何图片')
  return { samples, registry, warnings }
}
