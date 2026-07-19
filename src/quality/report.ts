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

function issuesOf(r: QualityResult, opts: Required<QualityOptions>): string[] {
  const out: string[] = []
  if (r.blurScore < opts.blurThreshold) out.push('模糊')
  if (r.isDark) out.push('过暗')
  if (r.isBright) out.push('过亮')
  if (r.isLowRes) out.push('低分辨率')
  if (r.isMonochrome) out.push('单色')
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
): string {
  const fileById = new Map(files.map((f) => [f.id, f]))
  const rows = [...results.entries()]
    .map(([id, r]) => ({ file: fileById.get(id), r }))
    .filter((x): x is { file: ImageFile; r: QualityResult } => !!x.file)
    .sort((a, b) => a.r.overallScore - b.r.overallScore)

  const tableRows = rows
    .map(({ file, r }) => {
      const issues = issuesOf(r, options)
      const issueStr = issues.length ? issues.join('、') : '—'
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
    { n: stats.checked, l: '已检查' },
    { n: stats.avgScore, l: '平均分' },
    { n: stats.blur, l: '模糊', warn: true },
    { n: stats.dark, l: '过暗', warn: true },
    { n: stats.bright, l: '过亮', warn: true },
    { n: stats.lowRes, l: '低分辨率', warn: true },
    { n: stats.monochrome, l: '单色', warn: true },
  ]

  return generateReportHtml({
    title: '数据集质量检查报告',
    subtitle: `共检查 ${stats.checked} 张，平均分 ${stats.avgScore}`,
    summaryCards: cards,
    sections: [
      {
        caption: '质量明细',
        headers: ['文件名', '尺寸', '亮度', '清晰度', '综合分', '质量问题'],
        rows: tableRows,
        emptyHint: '暂无检查数据',
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
): void {
  const html = generateQualityReportHtml(files, results, stats, options)
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
): void {
  const html = generateQualityReportHtml(files, results, stats, options)
  printReportHtml(html)
}
