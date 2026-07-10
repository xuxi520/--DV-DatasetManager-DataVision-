/**
 * 数据集规范中间模型（Phase 1 地基）
 *
 * 所有物理格式（YOLO / COCO / VOC / 分类文件夹）导入时都归一化进本模型；
 * 清洗、去重、重划分、导出都围绕本模型进行，从而与原始目录结构解耦。
 *
 * 设计要点（参考 FiftyOne / Roboflow）：
 *  - bbox 统一以「归一化 YOLO 坐标 [cx, cy, w, h]（0~1）」存储，导出时按图片尺寸换算，
 *    避免导入/导出阶段反复读图取尺寸。
 *  - polygon / segmentation 以归一化点序列 [(x,y), ...]（0~1）存储。
 *  - 类别由 ClassRegistry 统一（见 classRegistry.ts），解析时即映射为稳定 classId。
 *  - split 在导入时即定下，去重删除时能精确定位「删的是哪个子集」。
 */

export type SplitKey = 'train' | 'val' | 'test' | 'unknown'

export type AnnotationType = 'bbox' | 'polygon' | 'segmentation'

/**
 * 规范类别定义
 * - name：规范名称（data.yaml 为权威，否则取首次出现的原始名）
 * - aliases：归并进来的各种原始写法（如 Cat / cat / CAT）
 * - source：该类的来源，决定权威性
 */
export interface ClassDef {
  id: number
  name: string
  aliases: string[]
  source: 'yaml' | 'folder' | 'annotation' | 'inferred'
}

export interface CanonicalAnnotation {
  type: AnnotationType
  /** bbox: [cx, cy, w, h] 归一化 0~1；polygon/seg: [(x,y), ...] 归一化 0~1 */
  coords: number[]
  classId: number
  /** 可选：LabelMe 等格式携带的文本描述 / 置信度，供 UI 悬停与框上文字展示 */
  description?: string
  confidence?: number
}

export interface CanonicalSample {
  /** 稳定 id（基于源路径生成，跨次运行一致，供去重用） */
  id: string
  /** 原始相对路径（使用 '/'，规范斜杠） */
  sourcePath: string
  split: SplitKey
  /** 原始类别文件夹名（若有），保留以便回溯与导出命名 */
  category: string
  /** 图片扩展名（含点），如 '.jpg' */
  imageExt: string
  /** 懒加载图片字节（去重哈希 / 导出时取用） */
  getBytes: () => Promise<Uint8Array>
  annotations: CanonicalAnnotation[]
  /** 图片尺寸（可选；未读图时为空，导出需像素坐标时按需计算） */
  width?: number
  height?: number
}

export interface CanonicalDataset {
  /** 规范类别表（顺序即 classId），来自 data.yaml/classes.txt 或推断 */
  classes: ClassDef[]
  samples: CanonicalSample[]
  /** 识别出的源格式 */
  sourceFormat: DatasetFormat
  /** 导入过程中的告警（缺标签、类越界、大小写冲突等） */
  warnings: string[]
}

export type DatasetFormat = 'yolo' | 'coco' | 'voc' | 'labelme' | 'folder' | 'unknown'
