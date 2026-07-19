/**
 * 标注文件候选收集。
 *
 * 当一个数据集目录下存在多个「标注入口文件」时（最典型是 COCO 的多任务 json：
 * instances_val2017.json 用于检测+分割、person_keypoints_val2017.json 用于关键点、
 * captions_val2017.json 用于图文描述，它们可能同处一个子目录），加载流程需要让用户
 * 明确指定用哪一份（或叠加哪几份）标注文件来预览，否则应用会盲目合并全部 json，
 * 导致「到底该预览哪份标注」变得无法预期。
 *
 * 这里只针对 COCO 类 json 做推断（VOC/YOLO 通常只有一个标注根，无需选择）。
 *
 * ⚠️ 关键性能约束：COCO val2017 单份标注 json 可达 200MB+，若对每个候选文件做全文
 * 读取 + JSON.parse 会直接卡死主线程（弹窗永远弹不出来）。因此优先按【文件名约定】
 * 判定任务类型（瞬时、零 IO）；仅对小于安全上限、且文件名无法归类的小文件做内容窥探。
 */
import type { VirtualFile } from './importers/shared'
import {
  normSlash,
  ext,
  baseName,
  looksLikeCocoByFilename,
  SAFE_PEEK_BYTES,
} from './importers/shared'

export type AnnotationKind = 'coco-seg' | 'coco-det' | 'coco-kpt' | 'coco-caption'

export interface AnnotationCandidate {
  /** 标注文件相对路径（与 VirtualFile.path 一致，已 normSlash） */
  path: string
  /** 文件名（用于展示） */
  fileName: string
  /** 推断的任务类型 */
  kind: AnnotationKind
  /** 优先级：数值越小越优先作为默认选中项 */
  priority: number
}

// 优先级：检测+分割信息最丰富，其次检测、关键点、图文描述
const PRIORITY: Record<AnnotationKind, number> = {
  'coco-seg': 1,
  'coco-det': 2,
  'coco-kpt': 3,
  'coco-caption': 4,
}

/** 最多窥探的 json 数量，避免大目录下成本失控 */
const PEEK_JSON_LIMIT = 40

/** 按文件名里的 COCO 任务关键字推断任务类型（不读内容） */
function kindByFilename(name: string): AnnotationKind | null {
  if (/(^|[._-])person_keypoints([._-]|$)/i.test(name)) return 'coco-kpt'
  if (/(^|[._-])keypoints([._-]|$)/i.test(name)) return 'coco-kpt'
  if (/(^|[._-])captions([._-]|$)/i.test(name)) return 'coco-caption'
  if (/(^|[._-])panoptic([._-]|$)/i.test(name)) return 'coco-seg'
  if (/(^|[._-])instances([._-]|$)/i.test(name)) return 'coco-seg'
  if (/(^|[._-])det(ection)?s?([._-]|$)/i.test(name)) return 'coco-det'
  return null
}

/**
 * 扫描候选标注文件，返回按优先级排序的列表。
 * 返回长度 <= 1 时，调用方无需弹窗（直接走默认/合并行为）。
 */
export async function collectAnnotationCandidates(
  files: VirtualFile[],
): Promise<AnnotationCandidate[]> {
  const jsonFiles = files.filter(
    (f) => ext(normSlash(f.path)).toLowerCase() === '.json',
  )
  const seen = new Set<string>()
  const out: AnnotationCandidate[] = []

  const push = (path: string, kind: AnnotationKind) => {
    const p = normSlash(path)
    if (seen.has(p)) return
    seen.add(p)
    out.push({
      path: p,
      fileName: baseName(p),
      kind,
      priority: PRIORITY[kind],
    })
  }

  for (const f of jsonFiles.slice(0, PEEK_JSON_LIMIT)) {
    const name = baseName(normSlash(f.path))
    // 1) 文件名约定优先（瞬时、零 IO）
    if (looksLikeCocoByFilename(name)) {
      const kind = kindByFilename(name) ?? 'coco-det'
      push(f.path, kind)
      continue
    }
    // 2) 小文件才做内容窥探，巨型文件（如非标准命名的 COCO 巨 json）跳过，避免卡死
    if (f.size !== undefined && f.size > SAFE_PEEK_BYTES) continue
    let data: any
    try {
      data = JSON.parse(await f.getText())
    } catch {
      continue
    }
    if (!data || typeof data !== 'object') continue

    const hasImages = Array.isArray(data.images)
    const hasCats = Array.isArray(data.categories)
    const anns: any[] = Array.isArray(data.annotations) ? data.annotations : []

    if (hasImages && hasCats) {
      let kpt = false
      let seg = false
      for (const a of anns.slice(0, 30)) {
        if (Array.isArray(a.keypoints) && a.keypoints.length >= 3) kpt = true
        else if (a.segmentation) seg = true
        if (kpt && seg) break
      }
      push(f.path, kpt ? 'coco-kpt' : seg ? 'coco-seg' : 'coco-det')
    } else if (
      hasImages &&
      anns.length > 0 &&
      anns.some((a) => typeof a.caption === 'string')
    ) {
      push(f.path, 'coco-caption')
    }
    // 其余 json（LabelMe 单图、元数据等）暂不作为目录级候选
  }

  out.sort(
    (a, b) => a.priority - b.priority || a.fileName.localeCompare(b.fileName),
  )
  return out
}
