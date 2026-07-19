/**
 * 标注解析器共享类型
 * 解析逻辑已按格式拆分到 ./ 下的各文件（与 importers/ 导入层对称），
 * 这里集中定义跨格式复用的类型。
 */

/** 待解析的原始文件条目（浏览器 File + 文本/内容） */
export interface RawFileEntry {
  file: File
  name: string
  path: string
  content?: string
}
export type RawFileMap = Map<string, RawFileEntry>

/** 类别 → 颜色 的取色回调（解析时顺带预分配颜色） */
export type GetCategoryColor = (category: string) => string

/**
 * 解析后的标注类型（与 CanonicalAnnotation 解耦的中间表示）
 */
export interface ParsedAnnotation {
  type: 'bbox' | 'polygon' | 'circle' | 'rotation' | 'keypoint' | 'polyline' | 'obb' | 'mask'
  bbox?: [number, number, number, number] // [x, y, width, height]
  points?: [number, number][] // 多边形点 / 关键点 / obb 四角
  rotation?: number // 旋转角度（弧度，obb）
  keypoints?: { x: number; y: number; v: number }[] // 关键点 (YOLO-Pose/COCO)
  edges?: [number, number][] // 关键点骨架边（成对点索引）
  groupId?: number // 分组ID (YOLO-Pose 中关联框和关键点)
  bboxType?: 'hbb' | 'obb' | 'qbb' // 边界框类型：水平/定向/四边形
  trackId?: number // 跟踪ID (MOT 格式)
  text?: string // 文本内容 (PPOCR 格式)
  category: string
  classId?: number // 规范类别 id（canonical 来源，供清洗台改类别/新增框）
  normalized?: boolean // YOLO 格式是否归一化
  color?: string // 类别颜色
  confidence?: number // 置信度
  description?: string // 文本描述
  /** mask：COCO RLE 实例掩码（size + counts），coords 多边形点为空时以它为准 */
  rle?: { size: [number, number]; counts: string | number[] }
  /** mask：是否为 crowd 区域 */
  iscrowd?: boolean
}
