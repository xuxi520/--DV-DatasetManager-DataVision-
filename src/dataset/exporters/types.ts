/** 导出文件单元：路径（规范 '/'）+ 字节 */
export interface ExportFile {
  path: string
  bytes: Uint8Array
}

/** 可选：图像尺寸读取器（COCO/VOC 需绝对像素坐标时使用） */
export interface ExportOptions {
  /** 当 sample 未携带 width/height 时，用于从字节解码尺寸（浏览器可传 createImageBitmap 封装） */
  dimsReader?: (bytes: Uint8Array) => Promise<{ width: number; height: number }>
}
