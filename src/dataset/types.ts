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

export type AnnotationType = 'bbox' | 'polygon' | 'segmentation' | 'obb' | 'keypoints' | 'mask'

/**
 * COCO 紧凑 RLE 掩码（实例分割）。
 * - size: [height, width]
 * - counts: 紧凑字符串（pycocotools 编码）或展开后的非负整数数组（偶长度）。
 * 渲染时按 counts 形式解码为像素位图（见 src/codec/rle.ts）。
 */
export interface RleMask {
  size: [number, number]
  counts: string | number[]
}

/** 关键点骨架边：成对的点索引（指向 coords 中的第 i 个点） */
export type KeypointEdge = [number, number]

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
  /** bbox: [cx, cy, w, h] 归一化 0~1
   *  polygon/segmentation: [(x,y), ...] 归一化 0~1
   *  obb: [cx, cy, w, h] 归一化 0~1（角度见 rotation 字段）
   *  keypoints: [x1,y1,v1, x2,y2,v2, ...] 归一化 0~1，v∈{0,1,2}
   *  mask: 多边形点序列（同 polygon）；若来自 RLE 则 coords 为空、以 rle 字段承载 */
  coords: number[]
  classId: number
  /** 可选：LabelMe 等格式携带的文本描述 / 置信度，供 UI 悬停与框上文字展示 */
  description?: string
  confidence?: number
  /** obb：旋转角（弧度，数学正方向 CCW）。YOLO-OBB/DOTA 导入时由角度换算而来。 */
  rotation?: number
  /** keypoints：骨架边（成对点索引），如 [[0,1],[1,2],...]；COCO categories.skeleton 提供 */
  edges?: KeypointEdge[]
  /** mask：COCO RLE 实例掩码（size + counts）；coords 多边形点为空时以它为准 */
  rle?: RleMask
  /** mask：是否为 crowd 区域（COCO iscrowd=1），导出时写 RLE 而非多边形 */
  iscrowd?: boolean
  /** labelme/X-AnyLabeling：原始 shape 对象（无损回写 group_id/flags/attributes 等额外字段） */
  raw?: Record<string, unknown>
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
  /** labelme/X-AnyLabeling：原始顶层 JSON（已去除 shapes），用于无损回写 version/flags/imageData 等 */
  rawTop?: Record<string, unknown>
}

export interface CanonicalDataset {
  /** 规范类别表（顺序即 classId），来自 data.yaml/classes.txt 或推断 */
  classes: ClassDef[]
  samples: CanonicalSample[]
  /** 识别出的源格式 */
  sourceFormat: DatasetFormat
  /** 导入过程中的告警（缺标签、类越界、大小写冲突等） */
  warnings: string[]
  /** 格式识别详情（打分 + 证据），供 UI 展示与用户纠错覆盖 */
  detection?: FormatDetection
  /** 标注文件路径（相对数据集根）。当前仅 COCO 使用：单文件 JSON 记录全部标注，
   *  删除图片时需在 JSON 内条目级摘除对应 image + 其 annotations（见 fileOps.deleteFiles）。 */
  annotationFiles?: string[]
}

export type DatasetFormat = 'yolo' | 'coco' | 'voc' | 'labelme' | 'folder' | 'unknown' | 'dota'

/**
 * 格式识别结果（多信号打分）
 * - format：最终选定格式
 * - scores：各格式累计得分（供 UI 展示识别依据 / 用户纠错）
 * - evidence：命中证据文本
 */
export interface FormatDetection {
  format: DatasetFormat
  scores: Partial<Record<DatasetFormat, number>>
  evidence: string[]
}
