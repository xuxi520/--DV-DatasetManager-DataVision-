/**
 * 分类式文件夹导入器（image-classification 风格）
 *
 * 结构示例：
 *   train/cat/1.jpg   val/dog/2.jpg        （split/类别/图片）
 *   cat/1.jpg  dog/2.jpg                    （无 split，仅类别）
 *   train/images/cat/1.jpg                  （含 images 中间层）
 *
 * 类别 = 图片所在、且非 split / 非 images|labels 的父目录名。
 * 无逐图标注文件，类别信息由文件夹名承载；annotations 为空。
 */
import { ClassRegistry } from '../classRegistry'
import type { CanonicalSample, SplitKey } from '../types'
import { VirtualFile, normSlash, isImagePath, ext, baseName, dirName, detectSplit } from './shared'

const IGNORE_DIRS = new Set(['images', 'labels', 'image', 'label', 'jpegimages', 'annotations'])

function deriveCategory(imagePath: string): string {
  const segs = normSlash(imagePath).split('/').filter(Boolean)
  // 从末向前找第一个非 split、非忽略目录的段落
  for (let i = segs.length - 2; i >= 0; i--) {
    const s = segs[i]
    if (IGNORE_DIRS.has(s.toLowerCase())) continue
    if (/(^|\/)(train|training|val|valid|test|testing)($|\/)/i.test('/' + s + '/')) continue
    return s
  }
  return ''
}

export async function importFolder(
  files: VirtualFile[]
): Promise<{ samples: CanonicalSample[]; registry: ClassRegistry; warnings: string[] }> {
  const norm = files.map((f) => ({ ...f, path: normSlash(f.path) }))
  const registry = new ClassRegistry()
  const warnings: string[] = []

  const images = norm.filter((f) => isImagePath(f.path))
  const samples: CanonicalSample[] = []

  for (const img of images) {
    const split: SplitKey = detectSplit(img.path)
    let category = deriveCategory(img.path)
    if (!category) {
      // 无类别目录：用文件名（去扩展名）作为占位类别，保证可导出
      category = baseName(img.path)
      warnings.push(`图片 ${img.path} 无类别目录，使用文件名作为类别占位：'${category}'`)
    }
    const classId = registry.add(category)
    void classId

    samples.push({
      id: img.path,
      sourcePath: img.path,
      split,
      category,
      imageExt: ext(img.path).toLowerCase(),
      getBytes: img.getBytes,
      annotations: [],
    })
  }

  if (samples.length === 0) warnings.push('未找到任何图片文件')
  return { samples, registry, warnings }
}

// 避免未使用告警（dirName 在更复杂布局预留）
void dirName
