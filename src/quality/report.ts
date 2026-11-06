/**
 * 质量检查报告生成与导出
 *
 * 现在统一走 src/report/reportHtml.ts 通用报表模块（自包含 HTML + 浏览器打印转 PDF），
 * 与统计 / 相似 / 去重共用同一套排版，避免各功能各写一套 HTML。
 */
import type { QualityResult, QualityStats, QualityOptions } from './types'
import type { ImageFile } from '../types'
import {
  generateReportHtml,
  downloadReportHtml,
  printReportHtml,
  escapeHtml,
  type ReportCard,
} from '../report/reportHtml'

type TFn = (key: string, opts?: Record<string, unknown>) => string

function issuesOf(r: QualityResult, opts: Required<QualityOptions>, t: TFn): string[] {
  const out: string[] = []
  if (r.blurScore < opts.blurThreshold) out.push(t('stats.qBlur'))
  if (r.isDark) out.push(t('stats.qDark'))
  if (r.isBright) out.push(t('stats.qBright'))
  if (r.isLowRes) out.push(t('stats.qLowRes'))
  if (r.isMonochrome) out.push(t('stats.qMono'))
  return out
}

function scoreColor(score: number): string {
  if (score < 40) return '#f56c6c'
  if (score < 60) return '#e6a23c'
  if (score < 80) return '#409eff'
  return '#67c23a'
}

/** 生成质量检查 HTML 报告（自包含、内联样式） */
export function generateQualityReportHtml(
  files: ImageFile[],
  results: Map<string, QualityResult>,
  stats: QualityStats,
  options: Required<QualityOptions>,
  t: TFn,
): string {
  const fileById = new Map(files.map((f) => [f.id, f]))
  const rows = [...results.entries()]
    .map(([id, r]) => ({ file: fileById.get(id), r }))
    .filter((x): x is { file: ImageFile; r: QualityResult } => !!x.file)
    .sort((a, b) => a.r.overallScore - b.r.overallScore)

  const tableRows = rows
    .map(({ file, r }) => {
      const issues = issuesOf(r, options, t)
      const issueStr = issues.length ? issues.join('、') : t('qualityReport.none')
      return `<tr>
        <td title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</td>
        <td class="num">${file.width}×${file.height}</td>
        <td class="num">${r.brightness.toFixed(0)}</td>
        <td class="num">${r.blurScore.toFixed(0)}</td>
        <td class="num" style="color:${scoreColor(r.overallScore)};font-weight:600">${r.overallScore}</td>
        <td>${issueStr}</td>
      </tr>`
    })

  const cards: ReportCard[] = [
    { n: stats.checked, l: t('stats.qChecked') },
    { n: stats.avgScore, l: t('stats.qAvgScore') },
    { n: stats.blur, l: t('stats.qBlur'), warn: true },
    { n: stats.dark, l: t('stats.qDark'), warn: true },
    { n: stats.bright, l: t('stats.qBright'), warn: true },
    { n: stats.lowRes, l: t('stats.qLowRes'), warn: true },
    { n: stats.monochrome, l: t('stats.qMono'), warn: true },
  ]

  return generateReportHtml({
    title: t('qualityReport.title'),
    subtitle: t('qualityReport.subtitle', { count: stats.checked, score: stats.avgScore }),
    summaryCards: cards,
    sections: [
      {
        caption: t('qualityReport.detailCaption'),
        headers: [
          t('qualityReport.colFile'),
          t('qualityReport.colSize'),
          t('qualityReport.colBrightness'),
          t('qualityReport.colBlur'),
          t('qualityReport.colScore'),
          t('qualityReport.colIssues'),
        ],
        rows: tableRows,
        emptyHint: t('qualityReport.emptyHint'),
      },
    ],
  })
}

/** 触发浏览器下载报告 HTML */
export function downloadQualityReport(
  files: ImageFile[],
  results: Map<string, QualityResult>,
  stats: QualityStats,
  options: Required<QualityOptions>,
  t: TFn,
): void {
  const html = generateQualityReportHtml(files, results, stats, options, t)
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  void downloadReportHtml(`quality-report-${ts}.html`, html)
}

/**
 * 通过浏览器打印生成 PDF 报告（用户在选择器中「另存为 PDF」）。
 * 打印路径能正确渲染中文字体与内联样式；若打印不可用回退为下载 HTML。
 */
export function printQualityReport(
  files: ImageFile[],
  results: Map<string, QualityResult>,
  stats: QualityStats,
  options: Required<QualityOptions>,
  t: TFn,
): void {
  const html = generateQualityReportHtml(files, results, stats, options, t)
  printReportHtml(html)
}
