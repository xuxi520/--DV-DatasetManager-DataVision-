/**
 * 通用自包含 HTML 报告模块。
 *
 * 所有视图（质量 / 统计 / 相似 / 去重）的导出都统一走这里，避免各功能各写一套 HTML。
 * 报告为单文件、内联样式，可直接发给干系人或打印成 PDF（浏览器「另存为 PDF」）。
 *
 * 设计：数据驱动但不强制表结构——调用方自行拼好每个 <tr> 的 HTML 字符串
 * （需要着色时用 escapeHtml + 内联 style），本模块只负责外壳与卡片/表格排版。
 */

import { saveFile } from '../fileSave'
import { env } from '../env'

export interface ReportCard {
  /** 主数字（已算好的字符串/数字，模块只做转义） */
  n: string | number
  /** 卡片标签 */
  l: string
  /** 是否警示色（橙） */
  warn?: boolean
}

export interface ReportSection {
  /** 区块标题 */
  caption?: string
  /** 区块级摘要卡片（可选） */
  cards?: ReportCard[]
  /** 表头 */
  headers: string[]
  /** 每个元素是一整行 <tr>…</tr> 的 HTML 字符串（调用方负责 escapeHtml） */
  rows: string[]
  /** 行数为 0 时显示的占位文案 */
  emptyHint?: string
}

export interface ReportOptions {
  title: string
  subtitle?: string
  /** 顶部全局摘要卡片 */
  summaryCards?: ReportCard[]
  sections: ReportSection[]
}

/** HTML 转义（调用方拼行内容时必须用它包裹动态文本） */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function cardHtml(c: ReportCard): string {
  return `<div class="card${c.warn ? ' warn' : ''}"><div class="n">${escapeHtml(
    String(c.n),
  )}</div><div class="l">${escapeHtml(c.l)}</div></div>`
}

function sectionHtml(sec: ReportSection): string {
  const caption = sec.caption
    ? `<h3 class="sec-title">${escapeHtml(sec.caption)}</h3>`
    : ''
  const cards = sec.cards?.length
    ? `<div class="cards">${sec.cards.map(cardHtml).join('')}</div>`
    : ''
  const rows = sec.rows.length
    ? sec.rows.join('')
    : `<tr><td colspan="${sec.headers.length}" class="empty">${escapeHtml(
        sec.emptyHint ?? '暂无数据',
      )}</td></tr>`
  const table = `<table><thead><tr>${sec.headers
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows}</tbody></table>`
  return caption + cards + table
}

/** 生成完整 HTML 报告字符串 */
export function generateReportHtml(opts: ReportOptions): string {
  const generated = new Date().toLocaleString('zh-CN')
  const subtitle = opts.subtitle
    ? `<div class="sub">${escapeHtml(opts.subtitle)}　·　生成时间：${escapeHtml(generated)}</div>`
    : `<div class="sub">生成时间：${escapeHtml(generated)}</div>`
  const topCards = opts.summaryCards?.length
    ? `<div class="cards">${opts.summaryCards.map(cardHtml).join('')}</div>`
    : ''
  const sections = opts.sections.map(sectionHtml).join('')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(opts.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; padding: 28px 32px; color: #303133; background: #f5f7fa; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h3.sec-title { font-size: 16px; margin: 26px 0 10px; padding-left: 8px; border-left: 3px solid #409eff; }
  .sub { color: #909399; font-size: 13px; margin-bottom: 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 8px; }
  .card { background: #fff; border: 1px solid #ebeef5; border-radius: 10px; padding: 14px 16px; text-align: center; }
  .card .n { font-size: 24px; font-weight: 700; color: #409eff; }
  .card.warn .n { color: #e6a23c; }
  .card .l { font-size: 12px; color: #909399; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #ebeef5; border-radius: 10px; overflow: hidden; margin-bottom: 8px; }
  th, td { border-bottom: 1px solid #f0f0f0; padding: 9px 12px; text-align: left; font-size: 13px; }
  th { background: #fafafa; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:hover td { background: #f5f7fa; }
  .empty { text-align:center; color:#909399; padding: 24px; }
</style>
</head>
<body>
  <h1>${escapeHtml(opts.title)}</h1>
  ${subtitle}
  ${topCards}
  ${sections}
</body>
</html>`
}

/** 保存/下载报告 HTML（桌面端弹保存对话框，浏览器走 blob 下载） */
export async function downloadReportHtml(filename: string, html: string): Promise<boolean> {
  return saveFile(filename, html, {
    title: '保存报告',
    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
  })
}

/**
 * 通过浏览器打印生成 PDF（用户在选择器中「另存为 PDF」）。
 * 相比直接下载 HTML，打印路径能正确渲染中文字体与内联样式，且无需引入额外依赖。
 * 若打印不可用（如 contentWindow 受限），回退为下载 HTML 报告。
 */
export function printReportHtml(html: string): void {
  // 桌面端 WebView 不支持 window.print()（点了「导出 PDF」没反应），
  // 改为直接保存 HTML，用户可在浏览器中打开后再「另存为 PDF」。
  if (env === 'tauri') {
    void downloadReportHtml(`report-${Date.now()}.html`, html)
    return
  }

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  iframe.srcdoc = html
  iframe.onload = () => {
    const w = iframe.contentWindow
    try {
      w?.focus()
      w?.print()
    } catch {
      void downloadReportHtml(`report-${Date.now()}.html`, html)
    }
    window.setTimeout(() => iframe.remove(), 1500)
  }
  iframe.onerror = () => {
    void downloadReportHtml(`report-${Date.now()}.html`, html)
    iframe.remove()
  }
  document.body.appendChild(iframe)
}
