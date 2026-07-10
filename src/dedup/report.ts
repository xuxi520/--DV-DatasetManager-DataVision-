/**
 * 报告与清单生成（浏览器端导出，Tauri 端可下载备份）
 */
import type { DedupResult, HashIndex } from './types'

export function buildManifest(result: DedupResult, datasetName: string, envLabel: string) {
  return {
    tool: 'dataset-manager dedup',
    generatedAt: new Date().toISOString(),
    dataset: datasetName,
    env: envLabel,
    summary: result.stats,
    removableCount: result.removablePaths.length,
    removable: result.removablePaths,
    keepCount: result.keepPaths.length,
    keep: result.keepPaths,
  }
}

/** 生成删除脚本（windows / unix） */
export function buildDeleteScript(paths: string[], platform: 'win' | 'unix'): string {
  if (platform === 'win') {
    let s = '@echo off\r\n'
    s += 'REM 由 dataset-manager 生成的删除脚本（请人工确认后运行）\r\n'
    for (const p of paths) s += `del /F /Q "${p}"\r\n`
    return s
  }
  let s = '#!/bin/bash\n'
  s += '# 由 dataset-manager 生成的删除脚本（请人工确认后运行）\n'
  for (const p of paths) s += `rm -f "${p}"\n`
  return s
}

export function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadJSON(filename: string, data: unknown) {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json')
}

export function downloadHashIndex(index: HashIndex, name: string) {
  downloadJSON(`dedup-index-${name}-${Date.now()}.json`, index)
}
