/**
 * 历史兼容薄壳：标注解析逻辑已按格式拆分到 ./parsers/（与 importers/ 导入层对称）。
 * 保留此文件以维持既有导入（types.ts、datasetServiceV2.ts 等）不变。
 */
export { parseAllAnnotations } from './parsers'
export type { ParsedAnnotation } from './parsers'
