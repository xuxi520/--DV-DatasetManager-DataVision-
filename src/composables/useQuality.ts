/**
 * useQuality —— 质量检查结果单例（模块级单例，参考 useViewerState / useTheme）
 * 收敛质量检查的响应式状态与动作，供 ViewerHeader（触发）、FileList（徽标+筛选）、
 * StatsView（质量 tab）共享，不层层透传 prop。
 */
import { ref, computed } from 'vue'
import type { ImageFile } from '../types'
import type {
  QualityOptions,
  QualityResult,
  QualityStats,
  QualityIssue,
} from '../quality/types'
import { DEFAULT_QUALITY_OPTIONS } from '../quality/types'
import { runQualityCheck, destroyQualityWorker } from '../quality/qualityEngine'

/**
 * 纯函数：把 QualityResult 集合聚合为 QualityStats。
 * 抽出以便单例（全量）与统计页（按所选数据集作用域）共用同一套聚合逻辑。
 */
export function computeQualityStats(
  results: Map<string, QualityResult>,
  options: Required<QualityOptions>,
): QualityStats {
  const checked = results.size
  let blur = 0
  let dark = 0
  let bright = 0
  let lowRes = 0
  let mono = 0
  let sum = 0
  const buckets: Record<string, number> = {
    '0-20': 0,
    '20-40': 0,
    '40-60': 0,
    '60-80': 0,
    '80-100': 0,
  }
  const blurThreshold = options.blurThreshold ?? DEFAULT_QUALITY_OPTIONS.blurThreshold
  for (const r of results.values()) {
    if (r.isDark) dark++
    if (r.isBright) bright++
    if (r.isLowRes) lowRes++
    if (r.isMonochrome) mono++
    if (r.blurScore < blurThreshold) blur++
    sum += r.overallScore
    const s = r.overallScore
    if (s < 20) buckets['0-20']++
    else if (s < 40) buckets['20-40']++
    else if (s < 60) buckets['40-60']++
    else if (s < 80) buckets['60-80']++
    else buckets['80-100']++
  }
  const scoreBuckets = Object.entries(buckets).map(([range, count]) => ({
    range,
    count,
  }))
  return {
    total: checked,
    checked,
    blur,
    dark,
    bright,
    lowRes,
    monochrome: mono,
    avgScore: checked ? Math.round(sum / checked) : 0,
    scoreBuckets,
  }
}

function createQualityState() {
  /** fileId -> QualityResult */
  const results = ref<Map<string, QualityResult>>(new Map())
  const running = ref(false)
  const progress = ref({ processed: 0, total: 0 })
  /** 本次运行中命中缓存（跳过解码计算）的文件数，用于进度 UI 展示 */
  const cacheHits = ref(0)
  const options = ref<Required<QualityOptions>>({ ...DEFAULT_QUALITY_OPTIONS })
  let cancelFlag = false

  /** 取某图片的问题标签列表（供 FileList 徽标 / 筛选） */
  function issueList(r: QualityResult): QualityIssue[] {
    const out: QualityIssue[] = []
    if (r.isDark) out.push('dark')
    if (r.isBright) out.push('bright')
    if (r.isLowRes) out.push('lowRes')
    if (r.isMonochrome) out.push('monochrome')
    if (r.blurScore < (options.value.blurThreshold ?? DEFAULT_QUALITY_OPTIONS.blurThreshold)) {
      out.push('blur')
    }
    return out
  }

  /** 聚合统计（用于 StatsView 质量 tab）。全量 = 所有已检查结果。 */
  const stats = computed<QualityStats>(() => computeQualityStats(results.value, options.value))

  async function run(files: ImageFile[]): Promise<void> {
    if (files.length === 0) return
    cancelFlag = false
    running.value = true
    results.value = new Map()
    progress.value = { processed: 0, total: files.length }
    cacheHits.value = 0
    try {
      await runQualityCheck(files, options.value, {
        onResult: (r) => {
          const next = new Map(results.value)
          next.set(r.fileId, r)
          results.value = next
        },
        onProgress: (p, t, c) => {
          progress.value = { processed: p, total: t }
          cacheHits.value = c
        },
        shouldCancel: () => cancelFlag,
      })
    } finally {
      // 无论成功/失败/取消都必须复位，否则进度对话框会因 running 卡在 true 而无法关闭
      running.value = false
    }
  }

  function cancel(): void {
    cancelFlag = true
  }

  function reset(): void {
    results.value = new Map()
    progress.value = { processed: 0, total: 0 }
    cacheHits.value = 0
    cancelFlag = false
  }

  return { results, running, progress, cacheHits, options, stats, issueList, run, cancel, reset }
}

let _state: ReturnType<typeof createQualityState> | null = null

export function useQuality() {
  if (!_state) _state = createQualityState()
  return _state
}

export { destroyQualityWorker }
