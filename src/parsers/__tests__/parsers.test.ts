import { describe, it, expect } from 'vitest'
import { parseYolo } from '../yolo'
import { parseVoc } from '../voc'
import { parseDota } from '../dota'
import { parseMot } from '../mot'
import { parsePpocr } from '../ppocr'
import { parseCoco } from '../coco'
import { parseLabelMe } from '../labelme'
import { parseGeneric } from '../generic'
import type { GetCategoryColor, ParsedAnnotation, RawFileEntry, RawFileMap } from '../types'

// ---- 测试夹具 ----
function mkFile(path: string, content: string): RawFileEntry {
  const name = path.split(/[\\/]/).pop() || path
  return { name, path, content, file: new File([content], name) }
}
function mkFiles(entries: Record<string, string>): RawFileMap {
  const m = new Map<string, RawFileEntry>()
  for (const [p, c] of Object.entries(entries)) m.set(p, mkFile(p, c))
  return m
}
function makeColor(): GetCategoryColor {
  const map = new Map<string, string>()
  const palette = ['#F59E0B', '#3B82F6', '#10B981', '#EF4444']
  let i = 0
  return (c: string) => {
    if (!map.has(c)) map.set(c, palette[i++ % palette.length])
    return map.get(c)!
  }
}
function newAnn(): Map<string, ParsedAnnotation[]> {
  return new Map<string, ParsedAnnotation[]>()
}

const isBbox = (a: ParsedAnnotation): a is ParsedAnnotation & { bbox: number[] } => a.type === 'bbox'

describe('parsers: 标注必须按「匹配到的数据集图片路径」为 key 挂载（防回归核心）', () => {
  it('YOLO: 归一化 bbox 按匹配图片 key 挂载，类名由解析器内部读 classes.txt', () => {
    const files = mkFiles({
      'classes.txt': 'cat\ndog',
      'labels/0001.txt': '0 0.5 0.5 0.2 0.3',
    })
    const imagePaths = ['images/0001.jpg']
    const annotations = newAnn()
    parseYolo(annotations, 'labels/0001.txt', files, imagePaths, makeColor())

    expect(annotations.has('images/0001.jpg')).toBe(true) // 关键：不是 labels/0001.txt 之类的乱码 key
    const arr = annotations.get('images/0001.jpg')!
    expect(arr).toHaveLength(1)
    expect(arr[0].type).toBe('bbox')
    expect(arr[0].category).toBe('cat')
    expect(isBbox(arr[0]) ? arr[0].bbox : []).toEqual([0.4, 0.35, 0.2, 0.3])
  })

  it('VOC: 正则解析 <object>/<bndbox>', () => {
    const xml = `<annotation><object><name>cat</name><bndbox><xmin>10</xmin><ymin>20</ymin><xmax>110</xmax><ymax>120</ymax></bndbox></object></annotation>`
    const files = mkFiles({ 'annotations/0001.xml': xml })
    const imagePaths = ['images/0001.jpg']
    const annotations = newAnn()
    parseVoc(annotations, 'annotations/0001.xml', files, imagePaths, makeColor())

    expect(annotations.has('images/0001.jpg')).toBe(true)
    const a = annotations.get('images/0001.jpg')![0]
    expect(a.category).toBe('cat')
    expect(isBbox(a) ? a.bbox : []).toEqual([10, 20, 100, 100])
  })

  it('DOTA: 8 角点 → polygon(bboxType=obb) 按匹配图片挂载', () => {
    const txt = '100 20 200 20 200 100 100 100 cat 0'
    const files = mkFiles({ 'labelTxt/0001.txt': txt })
    const imagePaths = ['images/0001.png']
    const annotations = newAnn()
    parseDota(annotations, 'labelTxt/0001.txt', files, imagePaths, makeColor())

    expect(annotations.has('images/0001.png')).toBe(true)
    const a = annotations.get('images/0001.png')![0]
    expect(a.type).toBe('polygon')
    expect((a as ParsedAnnotation & { bboxType?: string }).bboxType).toBe('obb')
    expect(a.category).toBe('cat')
    expect((a as ParsedAnnotation & { points?: number[][] }).points).toEqual([
      [100, 20],
      [200, 20],
      [200, 100],
      [100, 100],
    ])
  })

  it('MOT: 逗号分隔、按帧号挂载到对应图片', () => {
    const txt = '1,1,100,200,50,60,0.9,1,1'
    const files = mkFiles({ 'gt.txt': txt, 'classes.txt': 'car\ndog' })
    const imagePaths = ['000001.jpg', '000002.jpg']
    const annotations = newAnn()
    parseMot(annotations, 'gt.txt', files, imagePaths, makeColor())

    expect(annotations.has('000001.jpg')).toBe(true)
    const a = annotations.get('000001.jpg')![0]
    expect(a.category).toBe('dog')
    expect(isBbox(a) ? a.bbox : []).toEqual([100, 200, 50, 60])
    expect(a.confidence).toBe(0.9)
  })

  it('PPOCR: Label.txt 按图片名挂载文本多边形（category 固定 text，文本在 text 字段）', () => {
    const json = '[{"transcription":"hello","points":[[10,20],[30,20],[30,40],[10,40]]}]'
    const txt = `0001.jpg\t${json}`
    const files = mkFiles({ 'Label.txt': txt })
    const imagePaths = ['images/0001.jpg']
    const annotations = newAnn()
    parsePpocr(annotations, 'Label.txt', files, imagePaths, makeColor())

    expect(annotations.has('images/0001.jpg')).toBe(true)
    const a = annotations.get('images/0001.jpg')![0]
    expect(a.type).toBe('polygon')
    expect(a.category).toBe('text')
    expect((a as ParsedAnnotation & { text?: string }).text).toBe('hello')
  })

  it('COCO: image_id 解析为匹配的数据集图片路径（而非裸 file_name）', () => {
    const data = {
      images: [{ id: 1, file_name: '0001.jpg' }],
      categories: [{ id: 1, name: 'cat' }],
      annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [10, 20, 30, 40] }],
    }
    const imagePaths = ['images/0001.jpg']
    const annotations = newAnn()
    parseCoco(annotations, data as any, mkFiles({}), imagePaths, makeColor())

    expect(annotations.has('images/0001.jpg')).toBe(true) // 关键：不能是 '0001.jpg'
    const a = annotations.get('images/0001.jpg')![0]
    expect(a.category).toBe('cat')
    expect(isBbox(a) ? a.bbox : []).toEqual([10, 20, 30, 40])
  })

  it('LabelMe: shape → bbox/polygon 按图片挂载（data 为第 2 参）', () => {
    const json = JSON.stringify({
      imagePath: '0001.jpg',
      shapes: [{ label: 'cat', points: [[10, 20], [30, 40]], shape_type: 'rectangle' }],
    })
    const files = mkFiles({ '0001.json': json })
    const imagePaths = ['images/0001.jpg']
    const annotations = newAnn()
    parseLabelMe(annotations, JSON.parse(json), '0001.json', files, imagePaths, makeColor())

    expect(annotations.has('images/0001.jpg')).toBe(true)
    const a = annotations.get('images/0001.jpg')![0]
    expect(a.category).toBe('cat')
    expect(isBbox(a) ? a.bbox : []).toEqual([10, 20, 20, 20])
  })

  it('Generic: 按 json stem 匹配图片路径挂载（data 为第 2 参）', () => {
    const json = JSON.stringify({
      annotations: [{ label: 'cat', bbox: [10, 20, 30, 40] }],
      imagePath: 'scene001.jpg',
    })
    const files = mkFiles({ 'scene001.json': json })
    const imagePaths = ['images/scene001.jpg']
    const annotations = newAnn()
    parseGeneric(annotations, JSON.parse(json), 'scene001.json', files, imagePaths, makeColor())

    expect(annotations.has('images/scene001.jpg')).toBe(true)
    const a = annotations.get('images/scene001.jpg')![0]
    expect(a.category).toBe('cat')
    expect(isBbox(a) ? a.bbox : []).toEqual([10, 20, 30, 40])
  })
})
