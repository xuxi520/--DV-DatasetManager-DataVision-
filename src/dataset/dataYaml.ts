/**
 * 最小 data.yaml / classes.txt 解析与序列化
 *
 * 只覆盖去重/清洗所需的子集，避免引入 js-yaml 依赖：
 *   data.yaml:  { nc, names:[...] 或 names:{0:a,1:b}, path?, train?, val?, test? }
 *   classes.txt: 每行一个类名
 * 同时处理常见变体：valid 等同 val、names 内联/块级/字典三种写法。
 */

export interface DataYaml {
  nc?: number
  names: string[]
  path?: string
  train?: string
  val?: string
  test?: string
}

/** 解析 data.yaml 文本 */
export function parseDataYaml(text: string): DataYaml {
  const lines = text.split(/\r?\n/)
  let names: string[] = []
  let nc: number | undefined
  let path: string | undefined
  let train: string | undefined
  let val: string | undefined
  let test: string | undefined

  // 状态机：当前是否处于 names 块（块级列表）
  let inNamesBlock = false
  let namesIsDict = false
  const dictNames: Record<number, string> = {}

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trimEnd() // 去注释
    if (!line.trim()) {
      // 块级列表中间的空行：已有条目则不结束块
      if (inNamesBlock && names.length === 0 && !namesIsDict) {
        inNamesBlock = false
      }
      continue
    }

    // names 块内部（优先于顶层解析）
    if (inNamesBlock) {
      if (line.trim() === ']') {
        inNamesBlock = false
        continue
      }
      const dictMatch = line.match(/^\s*(\d+)\s*:\s*['"]?([^'"]+)['"]?\s*$/)
      if (dictMatch) {
        namesIsDict = true
        dictNames[parseInt(dictMatch[1], 10)] = dictMatch[2].trim()
        continue
      }
      const listMatch = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/)
      if (listMatch) {
        names.push(listMatch[1].trim())
        continue
      }
      // 非列表/字典项 → 块结束，本行作为顶层 key 继续解析
      inNamesBlock = false
    }

    // 顶层 key
    const topMatch = line.match(/^([a-zA-Z_]+)\s*:\s*(.*)$/)
    if (topMatch) {
      const key = topMatch[1].toLowerCase()
      const rest = topMatch[2].trim()

      if (key === 'nc') {
        nc = parseInt(rest, 10)
        continue
      }
      if (key === 'path') {
        path = rest
        continue
      }
      if (key === 'train') {
        train = rest
        continue
      }
      if (key === 'val' || key === 'valid') {
        val = rest
        continue
      }
      if (key === 'test') {
        test = rest
        continue
      }
      if (key === 'names') {
        const stripped = rest.replace(/^\[|\]$/g, '').trim()
        if (stripped === '') {
          inNamesBlock = true
          namesIsDict = false
          continue
        }
        if (rest.trim() === '[') {
          inNamesBlock = true
          namesIsDict = false
          continue
        }
        const inline = rest.replace(/^\[|\]$/g, '')
        names = inline
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter((s) => s.length > 0)
        continue
      }
      continue
    }
  }

  if (namesIsDict) {
    names = Object.keys(dictNames)
      .map(Number)
      .sort((a, b) => a - b)
      .map((k) => dictNames[k])
  }

  // nc 推断
  if (nc === undefined && names.length > 0) nc = names.length

  return { nc, names, path, train, val, test }
}

/** 解析 classes.txt 文本（每行一类） */
export function parseClassesTxt(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/** 序列化为 data.yaml（导出用） */
export function serializeDataYaml(opts: {
  names: string[]
  train?: string
  val?: string
  test?: string
  path?: string
}): string {
  const lines: string[] = []
  lines.push(`# 由 dataset-manager 生成`)
  if (opts.path) lines.push(`path: ${opts.path}`)
  lines.push(`nc: ${opts.names.length}`)
  lines.push(`names: [${opts.names.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(', ')}]`)
  if (opts.train) lines.push(`train: ${opts.train}`)
  if (opts.val) lines.push(`val: ${opts.val}`)
  if (opts.test) lines.push(`test: ${opts.test}`)
  return lines.join('\n') + '\n'
}
