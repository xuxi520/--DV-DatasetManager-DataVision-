/**
 * 报告与清单生成（浏览器端导出，Tauri 端可下载备份）
 */
import type { DedupResult, HashIndex } from './types'
import { saveFile } from '../fileSave'

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

/** 保存/下载文本文件（桌面端弹保存对话框） */
export function downloadText(filename: string, text: string, mime = 'text/plain'): Promise<boolean> {
  const ext = mime.includes('json') ? 'json' : mime.includes('html') ? 'html' : mime.includes('csv') ? 'csv' : 'txt'
  return saveFile(filename, text, {
    title: '保存文件',
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  })
}

export function downloadJSON(filename: string, data: unknown): Promise<boolean> {
  return downloadText(filename, JSON.stringify(data, null, 2), 'application/json')
}

export function downloadHashIndex(index: HashIndex, name: string): Promise<boolean> {
  return downloadJSON(`dedup-index-${name}-${Date.now()}.json`, index)
}
