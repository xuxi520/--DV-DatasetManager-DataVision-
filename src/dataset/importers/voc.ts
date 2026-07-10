/**
 * Pascal VOC 格式导入器
 *
 * 结构：JPEGImages/xxx.jpg + Annotations/xxx.xml + ImageSets/Main/{split}.txt
 * 用正则解析 XML（VOC schema 规律，避免依赖 DOMParser，浏览器/Tauri/Node 通用）。
 * bndbox 为像素 [xmin,ymin,xmax,ymax]，归一化为 [cx, cy, w, h]。
 */
import { ClassRegistry } from '../classRegistry'
import type { CanonicalSample, SplitKey } from '../types'
import {
  VirtualFile,
  normSlash,
  isImagePath,
  ext,
  baseName,
  dirName,
  detectSplit,
} from './shared'

function pick(tag: string, xml: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]*?)</${tag}>`, 'i')) ||
    xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'is'))
  if (!m) return undefined
  return m[1].trim()
}
function num(tag: string, xml: string): number {
  const v = pick(tag, xml)
  return v ? parseFloat(v) : 0
}

export async function importVoc(
  files: VirtualFile[]
): Promise<{ samples: CanonicalSample[]; registry: ClassRegistry; warnings: string[] }> {
  const norm = files.map((f) => ({ ...f, path: normSlash(f.path) }))
  const registry = new ClassRegistry()
  const warnings: string[] = []

  const imageFiles = norm.filter((f) => isImagePath(f.path))
  const xmlFiles = norm.filter((f) => ext(f.path).toLowerCase() === '.xml')
  const xmlByBase = new Map<string, VirtualFile>()
  for (const f of xmlFiles) xmlByBase.set(baseName(f.path).toLowerCase(), f)

  // ImageSets/Main/*_{train,val,test}.txt -> basename -> split
  const splitOf = new Map<string, SplitKey>()
  const setFiles = norm.filter((f) => /imagesets\/main\//i.test(f.path) && ext(f.path) === '.txt')
  for (const sf of setFiles) {
    const name = baseName(sf.path).toLowerCase()
    let split: SplitKey = 'unknown'
    if (name.endsWith('_train') || name === 'train') split = 'train'
    else if (name.endsWith('_val') || name.endsWith('_valid') || name === 'val' || name === 'valid') split = 'val'
    else if (name.endsWith('_test') || name === 'test') split = 'test'
    if (split === 'unknown') continue
    const text = await sf.getText()
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^(\S+)\s+(\S+)/)
      if (!m) continue
      if (m[2] === '1' || m[2] === 'positive') splitOf.set(m[1].toLowerCase(), split)
    }
  }

  const samples: CanonicalSample[] = []
  for (const img of imageFiles) {
    const b = baseName(img.path).toLowerCase()
    const split: SplitKey = splitOf.get(b) || detectSplit(img.path)
    const xml = xmlByBase.get(b)

    const anns = []
    let width: number | undefined
    let height: number | undefined
    if (xml) {
      const xmlText = await xml.getText()
      width = num('width', xmlText) || undefined
      height = num('height', xmlText) || undefined
      const objBlocks = xmlText.split(/<object>/i).slice(1)
      for (const ob of objBlocks) {
        const name = pick('name', ob)
        if (!name) continue
        const classId = registry.add(name)
        const xmin = num('xmin', ob)
        const ymin = num('ymin', ob)
        const xmax = num('xmax', ob)
        const ymax = num('ymax', ob)
        const W = width || 1
        const H = height || 1
        anns.push({
          type: 'bbox' as const,
          classId,
          coords: [
            (xmin + xmax) / 2 / W,
            (ymin + ymax) / 2 / H,
            (xmax - xmin) / W,
            (ymax - ymin) / H,
          ],
        })
      }
    } else {
      warnings.push(`VOC 图片 ${img.path} 无对应 xml 标注`)
    }

    samples.push({
      id: img.path,
      sourcePath: img.path,
      split,
      category: dirName(img.path).split('/').pop() || '',
      imageExt: ext(img.path).toLowerCase(),
      getBytes: img.getBytes,
      annotations: anns,
      width,
      height,
    })
  }

  if (samples.length === 0) warnings.push('未找到任何 VOC 图片')
  return { samples, registry, warnings }
}

void isImagePath
