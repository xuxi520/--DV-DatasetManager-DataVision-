import { computed, type Ref, type ComputedRef } from 'vue'
import { detectSplitAndCategory } from '../dedup/splitDetect'
import type { DataSet, ImageFile, ParsedAnnotation } from '../types'

/** 单个类别统计项 */
export interface ClassStat {
  name: string
  annCount: number
  imgCount: number
  color: string
}

/** 通用条形/饼图数据项 */
export interface StatsBarItem {
  label: string
  count: number
  pct: number
  color: string
}

/** 数据集统计聚合结果 */
export interface DatasetStats {
  totalImages: number
  totalAnnotations: number
  annotatedImages: number
  unannotatedImages: number
  classCount: number
  avgAnnPerImage: number
  duplicateImages: number
  invalidImages: number
  maxClassAnn: number
  classes: ClassStat[]
  types: StatsBarItem[]
  splits: StatsBarItem[]
  resolutions: StatsBarItem[]
  sizes: StatsBarItem[]
  aspect: StatsBarItem[]
  boxSizes: StatsBarItem[]
  perDataset: Array<{ name: string; images: number; annotations: number }>
}

const TYPE_COLORS: Record<string, string> = {
  bbox: '#409eff', polygon: '#67c23a', circle: '#e6a23c',
  rotation: '#f56c6c', keypoint: '#909399', polyline: '#9254de',
}
const SPLIT_COLORS: Record<string, string> = {
  train: '#67c23a', val: '#409eff', test: '#e6a23c', unknown: '#909399',
}
const PALETTE = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#9254de', '#13c2c2', '#eb2f96', '#52c41a', '#fa8c16', '#2f54eb']

/** 计算单个标注占图面积比例（归一化坐标按图尺寸还原） */
function annAreaFraction(a: ParsedAnnotation, w: number, h: number): number | null {
  if (w <= 0 || h <= 0) return null
  let bw = 0, bh = 0
  if (a.bbox) {
    if (a.normalized) { bw = a.bbox[2] * w; bh = a.bbox[3] * h }
    else { bw = a.bbox[2]; bh = a.bbox[3] }
  } else if (a.points && a.points.length) {
    const xs = a.points.map(p => p[0])
    const ys = a.points.map(p => p[1])
    const minx = Math.min(...xs), maxx = Math.max(...xs)
    const miny = Math.min(...ys), maxy = Math.max(...ys)
    if (a.normalized) { bw = (maxx - minx) * w; bh = (maxy - miny) * h }
    else { bw = maxx - minx; bh = maxy - miny }
  } else return null
  return (bw * bh) / (w * h)
}

function buildBars(entries: Array<[string, number]>, colors: Record<string, string>, palette: string[]): StatsBarItem[] {
  const max = Math.max(1, ...entries.map(e => e[1]))
  return entries.map(([label, count], i) => ({
    label,
    count,
    pct: Math.round((count / max) * 100),
    color: colors[label] || palette[i % palette.length],
  }))
}

/**
 * 数据集统计计算 composable。
 * @param datasets 数据集列表
 * @param datasetAnnotations 每个数据集独立的标注映射（datasetId -> (fileId -> annotations)）
 * @param categoryColorMap 类别颜色映射
 */
export function useDatasetStats(
  datasets: Ref<DataSet[]>,
  datasetAnnotations: Ref<Map<string, Map<string, ParsedAnnotation[]>>>,
  categoryColorMap: Ref<Map<string, string>>,
): { datasetStats: ComputedRef<DatasetStats> } {
  function getFileAnnotations(file: ImageFile): ParsedAnnotation[] {
    for (const [datasetId, annMap] of datasetAnnotations.value) {
      const anns = annMap.get(file.id)
      if (anns && datasets.value.find(d => d.id === datasetId)?.fileList.includes(file)) {
        return anns
      }
    }
    return []
  }

  function getDatasetAnnotationCount(datasetId: string): number {
    const annMap = datasetAnnotations.value.get(datasetId)
    if (!annMap) return 0
    let count = 0
    for (const anns of annMap.values()) count += anns.length
    return count
  }

  const datasetStats = computed<DatasetStats>(() => {
    const allFiles: ImageFile[] = []
    for (const ds of datasets.value) allFiles.push(...ds.fileList)
    const n = allFiles.length

    // 规范 split 查表（来自 canonical，优先于路径推断；修正 COCO 等子集识别）
    const splitByFile = new Map<string, string>()
    for (const ds of datasets.value) {
      if (ds.canonical) for (const s of ds.canonical.samples) splitByFile.set(s.id, s.split)
    }

    const classMap = new Map<string, { ann: number; img: Set<string> }>()
    const typeMap = new Map<string, number>()
    const splitMap = new Map<string, number>()
    const resBuckets = new Map<string, number>([
      ['<320', 0], ['320–640', 0], ['640–1024', 0], ['1024–1920', 0], ['≥1920', 0],
    ])
    const sizeBuckets = new Map<string, number>([
      ['<100KB', 0], ['100KB–1MB', 0], ['1MB–5MB', 0], ['>5MB', 0],
    ])
    let landscape = 0, portrait = 0, square = 0
    let smallBox = 0, medBox = 0, largeBox = 0
    let invalid = 0
    const hashSeen = new Map<string, number>()
    const annotatedImg = new Set<string>()
    let totalAnn = 0

    const RES_RANGES = [
      { label: '<320', test: (m: number) => m < 320 },
      { label: '320–640', test: (m: number) => m >= 320 && m < 640 },
      { label: '640–1024', test: (m: number) => m >= 640 && m < 1024 },
      { label: '1024–1920', test: (m: number) => m >= 1024 && m < 1920 },
      { label: '≥1920', test: (m: number) => m >= 1920 },
    ]
    const SIZE_RANGES = [
      { label: '<100KB', test: (s: number) => s < 100 * 1024 },
      { label: '100KB–1MB', test: (s: number) => s >= 100 * 1024 && s < 1024 * 1024 },
      { label: '1MB–5MB', test: (s: number) => s >= 1024 * 1024 && s < 5 * 1024 * 1024 },
      { label: '>5MB', test: (s: number) => s >= 5 * 1024 * 1024 },
    ]

    for (const f of allFiles) {
      const anns = getFileAnnotations(f)
      if (anns.length > 0) annotatedImg.add(f.id)
      totalAnn += anns.length
      const w = f.width || 0, h = f.height || 0
      if (w === 0 || h === 0) invalid++
      const m = Math.max(w, h)
      for (const r of RES_RANGES) if (r.test(m)) { resBuckets.set(r.label, (resBuckets.get(r.label) || 0) + 1); break }
      if (w > h) landscape++; else if (h > w) portrait++; else square++
      const sz = f.size || 0
      for (const s of SIZE_RANGES) if (s.test(sz)) { sizeBuckets.set(s.label, (sizeBuckets.get(s.label) || 0) + 1); break }
      if (f.hash) hashSeen.set(f.hash, (hashSeen.get(f.hash) || 0) + 1)

      const split = splitByFile.get(f.id) || detectSplitAndCategory(f.path).split
      splitMap.set(split, (splitMap.get(split) || 0) + 1)

      for (const a of anns) {
        typeMap.set(a.type, (typeMap.get(a.type) || 0) + 1)
        let entry = classMap.get(a.category)
        if (!entry) { entry = { ann: 0, img: new Set() }; classMap.set(a.category, entry) }
        entry.ann++
        entry.img.add(f.id)
        const area = annAreaFraction(a, w, h)
        if (area !== null) {
          if (area < 0.01) smallBox++
          else if (area < 0.1) medBox++
          else largeBox++
        }
      }
    }

    const duplicateImages = Array.from(hashSeen.values()).filter(c => c > 1).reduce((a, b) => a + b - 1, 0)

    const classes: ClassStat[] = Array.from(classMap.entries())
      .map(([name, e], i) => ({
        name,
        annCount: e.ann,
        imgCount: e.img.size,
        color: categoryColorMap.value.get(name) || PALETTE[i % PALETTE.length],
      }))
      .sort((a, b) => b.annCount - a.annCount)

    const maxClassAnn = Math.max(1, ...classes.map(c => c.annCount))

    const types = buildBars(Array.from(typeMap.entries()), TYPE_COLORS, PALETTE)
    const splits = buildBars(Array.from(splitMap.entries()), SPLIT_COLORS, PALETTE)
    const resolutions = buildBars(Array.from(resBuckets.entries()), {}, PALETTE)
    const sizes = buildBars(Array.from(sizeBuckets.entries()), {}, PALETTE)
    const aspect = buildBars(
      [['横图', landscape], ['竖图', portrait], ['正方形', square]],
      { '横图': '#409eff', '竖图': '#67c23a', '正方形': '#e6a23c' },
      PALETTE
    )
    const boxSizes = buildBars(
      [['小目标占比(<1%)', smallBox], ['中目标占比(1-10%)', medBox], ['大目标占比(>10%)', largeBox]],
      { '小目标占比(<1%)': '#f56c6c', '中目标占比(1-10%)': '#e6a23c', '大目标占比(>10%)': '#67c23a' },
      PALETTE
    )

    const perDataset = datasets.value.map(ds => ({
      name: ds.name,
      images: ds.fileList.length,
      annotations: getDatasetAnnotationCount(ds.id),
    }))

    return {
      totalImages: n,
      totalAnnotations: totalAnn,
      annotatedImages: annotatedImg.size,
      unannotatedImages: n - annotatedImg.size,
      classCount: classMap.size,
      avgAnnPerImage: n ? +(totalAnn / n).toFixed(2) : 0,
      duplicateImages,
      invalidImages: invalid,
      maxClassAnn,
      classes,
      types,
      splits,
      resolutions,
      sizes,
      aspect,
      boxSizes,
      perDataset,
    }
  })

  return { datasetStats }
}
