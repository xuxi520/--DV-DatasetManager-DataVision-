import type { Ref } from 'vue'
import {
  escapeHtml,
  generateReportHtml,
  type ReportSection,
} from '../report/reportHtml'
import type { DatasetStats } from './useDatasetStats'
import { useI18n } from 'vue-i18n'

/** 对比模式总体指标行定义 */
export interface CompareMetric {
  key: string
  label: string
  /** 取某数据集统计后的展示值（字符串或数字均可，组合式内部统一转字符串） */
  fmt: (s: DatasetStats) => unknown
}

/** 对比模式类别对齐行 */
export interface CompareClassRow {
  name: string
  color: string
  counts: Record<string, number>
}

/** useStatsReports 依赖注入项 */
export interface StatsReportsDeps {
  /** 概览模式当前数据集统计（单选或叠加总和） */
  datasetStats: Ref<DatasetStats>
  /** 对比模式各数据集统计列表 */
  compareStats: Ref<DatasetStats[]>
  /** 总体指标对比行定义 */
  compareMetrics: ReadonlyArray<CompareMetric>
  /** 类别标注数对比（按类别对齐） */
  compareClassRows: Ref<CompareClassRow[]>
}

/**
 * 统计视图（概览 / 对比）HTML 报告构造器。
 *
 * 把原先堆在 StatsView.vue 里的 buildOverviewReportHtml / buildCompareReportHtml
 * 抽成独立组合式，使主组件的 <script> 只保留视图状态与导出装配（props/emit 契约不变）。
 * 这里只负责把统计数据转成 <tr> HTML 并交给通用 reportHtml 模块拼外壳。
 */
export function useStatsReports(deps: StatsReportsDeps) {
  const { datasetStats, compareStats, compareMetrics, compareClassRows } = deps
  const { t } = useI18n()

  /** 内联色块（不依赖外部 class，保证导出 HTML 自带样式） */
  function swatch(color: string): string {
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px;vertical-align:middle;background:${escapeHtml(
      color,
    )}"></span>`
  }

  /** 概览模式：类分布 / 拆分等数据集级概览 */
  function buildOverviewReportHtml(): string {
    const s = datasetStats.value
    const scopeName = s.selectedName || t('stats.allLoadedSum')
    const cards = [
      { n: s.totalImages, l: t('stats.cardImages') },
      { n: s.totalAnnotations, l: t('stats.cardAnns') },
      { n: s.annotatedImages, l: t('stats.cardAnnotated') },
      { n: s.unannotatedImages, l: t('stats.cardUnannotated') },
      { n: s.classCount, l: t('stats.cardClasses') },
      { n: s.avgAnnPerImage, l: t('stats.cardAvgAnn') },
      { n: s.duplicateImages, l: t('stats.cardDup'), warn: true },
      { n: s.invalidImages, l: t('stats.cardInvalid'), warn: true },
      { n: s.overlapImages, l: t('stats.cardOverlapImgs'), warn: true },
      { n: `${(s.overlapImageRate * 100).toFixed(1)}%`, l: t('stats.cardOverlapRate'), warn: true },
      { n: s.overlapPairs, l: t('stats.cardOverlapPairs'), warn: true },
      { n: s.avgOverlapIou.toFixed(2), l: t('stats.cardAvgIou'), warn: true },
    ]
    const sections: ReportSection[] = []

    // 数据集概览（仅叠加总和且有多个数据集时）
    if (!s.selectedName && s.perDataset.length > 1) {
      sections.push({
        caption: t('stats.sectionDsOverview'),
        headers: [t('stats.thDataset'), t('stats.thImages'), t('stats.thAnns')],
        rows: s.perDataset.map(
          (d) =>
            `<tr><td>${escapeHtml(d.name)}</td><td class="num">${d.images}</td><td class="num">${d.annotations}</td></tr>`,
        ),
      })
    }

    // 类别分布
    sections.push({
      caption: t('stats.chartCatDist'),
      headers: [t('stats.thLabel'), t('stats.thAnnCount'), t('stats.thImgCount'), t('stats.thAvgPerImg'), t('stats.thRatio')],
      rows: s.classes.map((c) => {
        const avg = (c.annCount / Math.max(1, c.imgCount)).toFixed(1)
        const pct = ((c.annCount / Math.max(1, s.totalAnnotations)) * 100).toFixed(1)
        return `<tr><td>${swatch(c.color)}${escapeHtml(c.name)}</td><td class="num">${c.annCount}</td><td class="num">${c.imgCount}</td><td class="num">${avg}</td><td class="num">${pct}%</td></tr>`
      }),
      emptyHint: t('stats.emptyNoAnn'),
    })

    // 子集分布
    sections.push({
      caption: t('stats.chartSplit'),
      headers: [t('stats.thSplit'), t('stats.thImgCount')],
      rows: s.splits.map(
        (x) => `<tr><td>${escapeHtml(x.label)}</td><td class="num">${x.count}</td></tr>`,
      ),
      emptyHint: t('stats.emptyData'),
    })

    // 标注类型
    sections.push({
      caption: t('stats.chartType'),
      headers: [t('stats.thType'), t('stats.thCount')],
      rows: s.types.map(
        (x) => `<tr><td>${escapeHtml(x.label)}</td><td class="num">${x.count}</td></tr>`,
      ),
      emptyHint: t('stats.emptyNoAnn'),
    })

    // 分辨率分布
    sections.push({
      caption: t('stats.chartRes'),
      headers: [t('stats.thRange'), t('stats.thImgCount')],
      rows: s.resolutions.map(
        (x) => `<tr><td>${escapeHtml(x.label)}</td><td class="num">${x.count}</td></tr>`,
      ),
      emptyHint: t('stats.emptyData'),
    })

    // 宽高比
    sections.push({
      caption: t('stats.chartAspect'),
      headers: [t('stats.thOrientation'), t('stats.thImgCount')],
      rows: s.aspect.map(
        (x) => `<tr><td>${escapeHtml(x.label)}</td><td class="num">${x.count}</td></tr>`,
      ),
      emptyHint: t('stats.emptyData'),
    })

    // 文件大小
    sections.push({
      caption: t('stats.chartFileSize'),
      headers: [t('stats.thRange'), t('stats.thCount')],
      rows: s.sizes.map(
        (x) => `<tr><td>${escapeHtml(x.label)}</td><td class="num">${x.count}</td></tr>`,
      ),
      emptyHint: t('stats.emptyData'),
    })

    // 目标尺寸占比
    sections.push({
      caption: t('stats.chartBoxSize'),
      headers: [t('stats.thRange'), t('stats.thCount')],
      rows: s.boxSizes.map(
        (x) => `<tr><td>${escapeHtml(x.label)}</td><td class="num">${x.count}</td></tr>`,
      ),
      emptyHint: t('stats.emptyBox'),
    })

    // IoU 分布
    sections.push({
      caption: t('stats.chartIouHist'),
      headers: [t('stats.thRange'), t('stats.thImgCount')],
      rows: s.iouBuckets.map(
        (x) => `<tr><td>${escapeHtml(x.label)}</td><td class="num">${x.count}</td></tr>`,
      ),
      emptyHint: t('stats.emptyNoAnn'),
    })

    return generateReportHtml({
      title: t('stats.reportOverviewTitle'),
      subtitle: t('stats.reportScope', { name: scopeName }),
      summaryCards: cards,
      sections,
    })
  }

  /** 对比模式：各数据集指标并排 */
  function buildCompareReportHtml(): string {
    const stats = compareStats.value
    const cards = stats.map((s) => ({ n: s.totalImages, l: s.selectedName || t('stats.defaultName') }))
    const sections: ReportSection[] = []

    // 总体指标对比
    sections.push({
      caption: t('stats.compareOverall'),
      headers: [t('stats.thMetric'), ...stats.map((s) => s.selectedName || '')],
      rows: compareMetrics.map(
        (m) =>
          `<tr><td>${escapeHtml(m.label)}</td>${stats
            .map((s) => `<td class="num">${escapeHtml(String(m.fmt(s)))}</td>`)
            .join('')}</tr>`,
      ),
    })

    // 类别标注数对比
    const dsNames = stats.map((s) => s.selectedName || '')
    sections.push({
      caption: t('stats.compareCatCount'),
      headers: [t('stats.thCategory'), ...dsNames],
      rows: compareClassRows.value.map(
        (c) =>
          `<tr><td>${swatch(c.color)}${escapeHtml(c.name)}</td>${dsNames
            .map((n) => `<td class="num">${c.counts[n] ?? 0}</td>`)
            .join('')}</tr>`,
      ),
      emptyHint: t('stats.emptyNoAnn'),
    })

    return generateReportHtml({
      title: t('stats.reportCompareTitle'),
      subtitle: t('stats.reportCompareSub', { names: dsNames.join(' / ') }),
      summaryCards: cards,
      sections,
    })
  }

  return { buildOverviewReportHtml, buildCompareReportHtml }
}