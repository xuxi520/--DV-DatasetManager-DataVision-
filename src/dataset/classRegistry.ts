/**
 * 类别注册表（ClassRegistry）
 *
 * 解决真实数据集中的「大小写混乱 / 命名不一致 / 缺 data.yaml」问题：
 *  - 以「规范化 key（小写 + 去首尾空格）」归并别名（Cat / cat / CAT → 同一类）
 *  - data.yaml.names 中的名称为权威（source='yaml'），其余来源作为别名并入
 *  - 提供 remapTable() 供 UI 展示「哪些原始拼写被归并」，让用户在清洗前确认
 *
 * 用法（导入期）：
 *  1. 若发现 data.yaml/classes.txt → fromYamlNames() 建立权威表
 *  2. 遇到文件夹类别名 / 标注类名 → add() 归并
 *  3. 遇到 YOLO 数字 class_id → resolveById()（信任 data.yaml 顺序）
 */
import type { ClassDef } from './types'

/** 规范化 key：小写、去首尾空格（用于别名匹配，不破坏展示名） */
function keyOf(name: string): string {
  return name.trim().toLowerCase()
}

/** 生成导出用规范名：小写、空格转下划线（Roboflow 风格，避免路径/大小写问题） */
export function toCanonicalName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_')
}

export interface RemapRow {
  /** 规范化 key */
  key: string
  /** 采用的规范名 */
  canonicalName: string
  /** 被归并进来的所有原始拼写 */
  variants: string[]
  /** 该类样本数（导入阶段填充） */
  count: number
  /** 是否存在大小写/拼写冲突（同一 key 多种原始写法） */
  conflict: boolean
}

export class ClassRegistry {
  classes: ClassDef[] = []
  private keyToId = new Map<string, number>()

  /** 当前是否由 data.yaml/classes.txt 权威建立（决定数字 id 是否可信） */
  hasAuthoritative = false

  private ensure(key: string, rawName: string, source: ClassDef['source']): number {
    const existing = this.keyToId.get(key)
    if (existing !== undefined) {
      const cls = this.classes[existing]
      if (!cls.aliases.includes(rawName)) cls.aliases.push(rawName)
      // 若权威来源后到，提升权威级别
      if (source === 'yaml' && cls.source !== 'yaml') {
        cls.source = 'yaml'
        cls.name = rawName
      }
      return existing
    }
    const id = this.classes.length
    this.classes.push({ id, name: rawName, aliases: [rawName], source })
    this.keyToId.set(key, id)
    return id
  }

  /** 添加一个类别（按名归并） */
  add(rawName: string, source: ClassDef['source'] = 'inferred'): number {
    return this.ensure(keyOf(rawName), rawName, source)
  }

  /** 按数字 class_id 解析（信任 data.yaml 顺序；越界则补占位） */
  resolveById(id: number, source: ClassDef['source'] = 'annotation'): number {
    if (id < 0) return -1
    if (id < this.classes.length) return id
    // 越界：创建占位类（名用 class_<id>，等待后续由 yaml/文件夹校正）
    if (this.hasAuthoritative) return -1 // 权威表下越界即非法
    const name = `class_${id}`
    this.classes.push({ id, name, aliases: [name], source })
    this.keyToId.set(keyOf(name), id)
    return id
  }

  /** 按名解析（找不到返回 -1） */
  resolveByName(rawName: string): number {
    const id = this.keyToId.get(keyOf(rawName))
    return id === undefined ? -1 : id
  }

  /** 由 data.yaml.names / classes.txt 建立权威表（顺序即 id）。
   *  会保留之前已扫描到的别名；yaml 中不存在的额外类折叠到末尾。 */
  fromNameList(names: string[]): void {
    this.hasAuthoritative = true
    const newClasses: ClassDef[] = []
    const newKeyToId = new Map<string, number>()
    names.forEach((n, i) => {
      const key = keyOf(n)
      const prevId = this.keyToId.get(key)
      const aliases = prevId !== undefined ? this.classes[prevId].aliases : [n]
      newClasses.push({ id: i, name: n, aliases, source: 'yaml' })
      newKeyToId.set(key, i)
    })
    // 保留 yaml 中不存在、但之前已扫描到的额外类（追加到末尾）
    for (const c of this.classes) {
      if (!newKeyToId.has(keyOf(c.name))) {
        const id = newClasses.length
        newClasses.push({
          ...c,
          id,
          source: c.source === 'yaml' ? 'inferred' : c.source,
        })
        newKeyToId.set(keyOf(c.name), id)
      }
    }
    this.classes = newClasses
    this.keyToId = newKeyToId
  }

  /** 导出用：names 数组（顺序即 id） */
  toNameList(): string[] {
    return this.classes
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((c) => c.name)
  }

  /** remap 表：展示每个规范类归并了哪些原始拼写，便于用户确认/修正 */
  remapTable(counts: Map<number, number> = new Map()): RemapRow[] {
    return this.classes
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((c) => ({
        key: keyOf(c.name),
        canonicalName: c.name,
        variants: c.aliases,
        count: counts.get(c.id) || 0,
        conflict: c.aliases.length > 1,
      }))
  }

  /** 是否存在需要用户留意的归并冲突（大小写/拼写混乱） */
  hasConflicts(): boolean {
    return this.classes.some((c) => c.aliases.length > 1)
  }
}
