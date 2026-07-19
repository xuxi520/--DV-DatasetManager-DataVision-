# API_CONTRACT - 接口契约

> 最后更新：2026-07-18 | 定义关键 Interface，解耦核心

## 设计原则

1. **契约优先**：先定义 Interface，再写实现
2. **依赖倒置**：模块间通过 Interface 解耦，不写死依赖
3. **物理隔离**：按功能拆分文件夹，修改 A 不波及 B
4. **Canonical 中间模型**：所有格式导入归一化、导出反归一化，与原始目录解耦

---

## 核心接口定义

### 1. IFileSystem — 环境适配接口

```typescript
// env.ts 已实现，未来可扩展为正式 Interface

/** 环境类型 */
type EnvType = 'browser' | 'tauri';

/** 零解码尺寸解析：从图片字节头部解析宽高（JPEG/PNG/GIF/BMP/WebP） */
declare function parseImageSize(
  buf: Uint8Array
): { width: number; height: number } | null;

/** 整图解码取尺寸（仅低频场景，如单张导出） */
declare function getImageDimensions(
  file: Blob
): Promise<{ width: number; height: number }>;
```

**实现类**：
- `BrowserFileSystem` — 浏览器版（`showDirectoryPicker` + `FileReader`）
- `TauriFileSystem` — 客户端版（`@tauri-apps/api`）

> 缩略图功能已整体移除，原 `generateThumbnail` 契约作废。

---

### 2. ILabelParser — 标注解析接口

```typescript
// annotationParser.ts

interface ParsedAnnotation {
  type: 'bbox' | 'polygon' | 'circle' | 'rotation' | 'keypoint' | 'polyline';
  bbox?: [number, number, number, number]; // [x, y, w, h]
  points?: [number, number][];             // 多边形顶点
  category: string;                         // 类别名称
  normalized?: boolean;                     // 是否归一化（YOLO）
  color?: string;                           // 类别颜色
  confidence?: number;                       // 置信度 (0-1)
  description?: string;                      // 文本描述
}

declare function parseAllAnnotations(
  files: Map<string, { file: File; name: string; path: string; content?: string }>,
  imagePaths: string[],
  getCategoryColor: (category: string) => string
): Map<string, ParsedAnnotation[]>;
```

**支持格式**：`CocoParser` / `LabelMeParser` / `YoloParser` / `VocParser`

**注意**：运行时渲染与统计优先读 `DataSet.canonical.samples[].annotations`（由 `sampleToAnnotations` 还原），`parseAllAnnotations` 的结果仅作兜底。坐标约定：bbox 统一归一化 YOLO `[cx,cy,w,h]`(0~1)。

---

### 3. ICanonicalImporter — 规范导入接口（统一管线）

```typescript
// dataset/importers/* + dataset/loadCanonical.ts

type DatasetFormat = 'yolo' | 'coco' | 'voc' | 'labelme' | 'folder' | 'unknown';

interface ImportContext {
  files: Map<string, { path: string; getText: () => Promise<string>; getBytes: () => Promise<Uint8Array> }>;
  registry: ClassRegistry;          // 类别注册表（别名归并）
}

interface ICanonicalImporter {
  /** 是否识别为该格式 */
  detect(ctx: ImportContext): Promise<boolean>;
  /** 归一化为规范中间模型 */
  import(ctx: ImportContext): Promise<CanonicalDataset>;
}

declare function loadDatasetCanonical(
  onProgress?: (current: number, total: number, status: string) => void
): Promise<{
  dataset: DataSet;
  annotations: Map<string, ParsedAnnotation[]>;
  categoryColors: Map<string, string>;
  canonical: CanonicalDataset;
  warnings: string[];
}>;
```

**实现类**：`YoloImporter` / `CocoImporter` / `VocImporter` / `LabelMeImporter` / `FolderImporter`
**调度**：`detectFormat()` 采样识别后由 `index.ts` 分发；`loadDatasetCanonical` 统一驱动，循环内用 `parseImageSize` 零解码取尺寸。

---

### 4. ICanonicalExporter — 规范导出接口

```typescript
// dataset/exporters/* + dataset/exportBrowser.ts

interface ExportOptions {
  format: 'yolo' | 'coco' | 'voc';
  policy: NamingPolicy;              // 统一命名策略（class_seq 等）
  datasetName: string;
  rebalance?: {
    targets: { train: number; val: number; test: number };
    options: { stratifyByClass: boolean; lockTest: boolean; seed: number };
  };
}

interface ICanonicalExporter {
  exportZip(canonical: CanonicalDataset, opts: ExportOptions): Promise<number>; // 返回文件数
}
```

**实现类**：`YoloExporter` / `CocoExporter` / `VocExporter`
**重划分**：`rebalanceSplits(canonical, targets, options)` 按比例分层抽样 + 分层 + 锁定 test。

---

### 5. IHashCalculator — 哈希计算接口

```typescript
// hashService.ts + worker.ts

interface HashTask { file: ImageFile; algorithm: 'md5' | 'phash' | 'dhash' | 'ahash'; }

interface HashResult { fileId: string; hash?: string; phash?: string; dhash?: string; ahash?: string; }

interface IHashCalculator {
  computeHashes(
    files: ImageFile[],
    onResult: (fileId: string, hash?: string, phash?: string, dhash?: string, ahash?: string) => void,
    onProgress?: (processed: number, total: number) => void
  ): Promise<void>;
  cancel(): void;
}
```

**实现类**：`SingleThreadCalculator`（备用）/ `WorkerPoolCalculator`（推荐，已落地 `src/workers/workerPool.ts` 4-8 并行池 + IndexedDB 双层内容寻址缓存 `src/cache/idbCache.ts`，批量写 + 缓存命中透出）

---

### 6. IDuplicateDetector — 去重检测接口

```typescript
// dedup/analyze.ts + dedup/types.ts

interface DedupOptions {
  strength: 'strict' | 'standard' | 'loose';
  separateSplits: boolean;                 // train/val/test 不交叉
  splitOf?: (file: ImageFile) => SplitKey; // 注入 canonical 权威 split
  compareMode?: 'within' | 'mixed';
  detectLeakage?: boolean;                 // 跨子集泄漏
  detectDirty: boolean;                    // 脏数据（无效/离群）
  incremental: boolean;                    // 复用已有哈希索引
  outlierThreshold: number;
  keepOnePerGroup: boolean;
}

interface IDuplicateDetector {
  run(files: ImageFile[], options: DedupOptions): Promise<DedupResult>;
}
```

**输出 DTO** `DedupResult`：
```typescript
interface DedupResult {
  groups: DuplicateGroup[];   // 重复组（含 keepId / removeIds / exact / leakage）
  dirty: DirtyImage[];        // 无效 / 离群
  leakage: LeakagePair[];     // 跨子集泄漏对
  removablePaths: string[];   // 计划删除（真实相对路径）
  removedBySplit: Record<SplitKey, number>; // 各子集删除数
  stats: { exactDuplicates; nearDuplicates; dirtyInvalid; dirtyOutlier; removable; reducedRatio };
}
```

**实现类**：`DedupAnalyzer`（统一核心 + `fileOps.ts` 走真实 sourcePath 删除）

---

### 7. IDataSetStats — 统计计算接口

```typescript
// composables/useDatasetStats.ts

interface IDataSetStats {
  /** 可复用：对任意数据集子集计算完整统计 */
  computeStatsFor(
    scopedDatasets: DataSet[],
    selectedName?: string | null
  ): DatasetStats;
  /** 默认：叠加所有数据集（或单选）的响应式统计 */
  datasetStats: ComputedRef<DatasetStats>;
}
```

**关键指标**（`DatasetStats`）：`totalImages/totalAnnotations/annotatedImages/classCount/avgAnnPerImage/duplicateImages/invalidImages/overlapImages/overlapPairs/avgOverlapIou` + 分布条 `classes/types/splits/resolutions/sizes/aspect/boxSizes/iouBuckets` + `imageRows`（明细）+ `perDataset`。

---

### 8. IAnnotationRenderer — 标注渲染接口

```typescript
// ImageViewer.vue + canvas/canvasDraw.ts（纯函数模块，不持响应式状态）

interface RenderOptions {
  color: string; lineWidth: number; fillAlpha: number;
  showLabel: boolean; showConfidence: boolean; showDescription: boolean;
}

interface IAnnotationRenderer {
  drawAnnotation(ctx, annotation: ParsedAnnotation, imgW: number, imgH: number, zoom: number): void;
  drawLabel(ctx, text: string, x: number, y: number, color: string): void;
}
```

**实现**：`canvasDraw.ts` 导出 `drawCheckerboard/drawAnnotation/drawLabel/rRect/hexA` 等纯绘制原语，由 `ImageViewer.vue` 在 canvas 上调用。

---

## 模块间依赖关系（解耦设计）

```
App.vue
  ├── DatasetViewer.vue (browse)  ── useViewerState (单例)
  │     ├── PaneView (left/right) ── useViewerState.leftPane/rightPane
  │     ├── StatsView ── useDatasetStats + ChartPanel(useChartOptions)
  │     └── ExportDialog ── exportBrowser (canonical exporters)
  └── DedupView.vue (dedup) ── useViewerState + dedup/*

env.ts          —— 双端统一文件/字节/尺寸（零解码 parseImageSize）
dataset/*       —— canonical 管线：importers → loadCanonical → exporters
dedup/*         —— 哈希引擎 + 分析 + 文件操作（真实 sourcePath）
hashService.ts  —— 哈希计算（worker）
annotationParser.ts —— 兜底标注解析
```

**关键解耦点**：
1. `IFileSystem` — 浏览器/Tauri 实现可切换
2. `ICanonicalImporter/Exporter` — 新增格式只需扩展导入/导出器
3. `ILabelParser` — 新增标注格式只需扩展解析器
4. `IHashCalculator` — 单线程/Worker 池可切换
5. `IDuplicateDetector` — 去重算法可替换
6. 状态单例 `useViewerState` 收敛共享状态，避免 prop 层层透传

---

## 未来扩展接口（预留）

### IQualityChecker — 质量检查接口

```typescript
// 待实现：src/composables/useQuality.ts

interface QualityResult {
  fileId: string;
  blurScore: number;      // 模糊得分（拉普拉斯方差）
  brightness: number;     // 平均亮度
  isDark: boolean; isBright: boolean; isLowRes: boolean; isMonochrome: boolean;
  overallScore: number;   // 综合质量评分 (0-100)
}

interface IQualityChecker { check(dataset: DataSet): Promise<QualityResult[]>; }
```

### IExportService — 通用导出接口

```typescript
// 已落地（2026-07-17）：CSV/JSON 标注导出覆盖全部规范类型；PDF/HTML 报告走统一模块 reportHtml

interface ExportOptions {
  format: 'csv' | 'json' | 'zip' | 'pdf';
  includeAnnotations: boolean;
  includeQualityReport: boolean;
}
interface IExportService { export(dataset: DataSet, options: ExportOptions): Promise<void>; }
```

**实现状态**：
- 标注 CSV / JSON：`src/dataset/exportAnnotations.ts` 的 `exportAnnotations(canonical, { format, datasetName?, rebalance? })`（不打包图片、直接下载单文件；覆盖 bbox/OBB/多边形/分割/mask RLE/关键点；归一化坐标 + RLE 原样保留）。导出对话框「标注 CSV/JSON」模式接入。
- PDF / HTML 报告：统一报表模块 `src/report/reportHtml.ts`（`generateReportHtml` / `downloadReportHtml` / `printReportHtml`），质量/统计/相似/去重复用。
- ZIP（数据集格式）：`exportDatasetZip`（`src/dataset/exportBrowser.ts`）。
- 训练框架工程配置 ZIP：`exportTrainingConfig`。

---

## 补充接口（2026-07-17 ~ 07-18 落地）

### 9. IEmbedder / 相似检索 — 数据策展（`src/embed/`）

```typescript
// embedModel.ts + reduce.ts + outlier.ts
interface IEmbedder {
  embed(files: ImageFile[], onProgress?: (done: number, total: number, hits: number) => void): Promise<Map<string, Float32Array>>; // 1280 维
}
declare function findSimilar(query: Float32Array, all: Map<string, Float32Array>, topK: number): { id: string; score: number }[]; // 余弦
declare function reduce(vectors: Float32Array[], method: 'pca' | 'umap'): [number, number][]; // 降维到 2D
declare function detectOutliers(vectors: Map<string, Float32Array>, k: number): { id: string; score: number }[]; // kNN 余弦离群
```
**实现**：`embedModel.ts`（onnxruntime-web WASM EfficientNet-B0）+ `WorkerPool` 并行 + `idbCache` `embeddings` store 内容寻址缓存。

### 10. IActiveLearning — 主动学习钩子（`src/activeLearning/`）

```typescript
// types.ts + importPredictions.ts + useActiveLearning.ts
interface PredictionSample { sourcePath: string; boxes: { bbox: number[]; category: string; score: number }[]; }
interface ActiveLearningScore { sampleId: string; confMean: number; hardScore: number; } // 0.6*(1-confMean)+0.4*离群
declare function importPredictionsJson(text: string, ds: CanonicalDataset, sourceName: string): PredictionSet; // COCO/信封/映射三形态
declare function scorePredictions(set: PredictionSet, useOutlier: boolean): ActiveLearningScore[];
```
**约定**：预测作为覆盖层独立存储，**绝不回写 canonical 真值**；仅会话内有效、不写盘。`render.ts` 转 `ParsedAnnotation` 叠加渲染（品红虚线区分真值）。

### 11. IFolderDrop — 双端拖拽上传（`src/composables/useFolderDrop.ts`）

```typescript
type LoadOptions = { imageRoot: string } | { imageHandle: FileSystemDirectoryHandle }; // Tauri | 浏览器
declare function useFolderDrop(onFolder: (opts: LoadOptions) => void): { dragOver: Ref<boolean> };
```
**约定**：落点统一成 `LoadOptions`，复用 `handleLoadDataset(opts)` 免弹框加载。

### 12. i18n — 多语言（`src/i18n/`）

```typescript
type LocaleKey = 'zh-CN' | 'en-US';
declare const i18n: I18n;                       // vue-i18n@11, legacy:false
declare function setLocale(l: LocaleKey): void; // 持久化 localStorage
declare const elLocale: ComputedRef<Language>;  // 同步 ElementPlus zh-cn/en 包（el-config-provider）
```

---

## 总结

- **3 个核心文档** 已创建：`PROJECT_ARCHITECTURE.md`、`CURRENT_STATUS.md`、`API_CONTRACT.md`
- **接口契约** 已定义：8 个核心接口（FileSystem / LabelParser / CanonicalImporter / CanonicalExporter / HashCalculator / DuplicateDetector / DataSetStats / AnnotationRenderer）+ 补充接口（Embedder/相似检索、ActiveLearning、FolderDrop、i18n）+ 已落地的 QualityChecker / ExportService。
- **解耦设计** 已实现：环境适配层、canonical 管线、标注解析器、哈希计算器、去重器均可独立替换。
- **接口达成状态**：`IQualityChecker`（质量检查）、`IExportService`（CSV/JSON 标注 + PDF/HTML 报告 + ZIP）已落地（2026-07-17）；数据策展（Embedder/相似/降维/离群）、主动学习、拖拽上传、i18n 已落地（2026-07-17 ~ 07-18）。

---

## 开发规范守则（Dev Conventions）

> 2026-07-10 增补 | 围绕本仓库实际踩坑经验沉淀，供后续开发与 AI 协作遵循

### 1. 组件拆分与状态管理
- **禁止上帝组件（God Component）**：单文件超过 ~600 行即应拆分。`DatasetViewer.vue` 已拆为 `useViewerState`（共享状态/动作 composable，模块级单例）+ `ViewerHeader` / `ExportDialog` / `SettingsPanel` / `PaneView` / `StatsView` 等展示型子组件。
- **跨组件共享状态用 composable 单例**：需要多个兄弟组件共享同一份响应式状态时（如 viewer 的 `datasets`/`selectedFile`/`viewMode`/`dualPane`），收敛到一个 `useXxx()` composable（模块级单例，参考 `useTheme`、`useViewerState`），各组件 `const s = useXxx()` 后解构使用。**不要**层层透传 prop。
- **窗格独立状态用工厂**：需要左右两侧各自独立的子状态（如双窗格对照）用 `createPane()` 工厂产出独立 `ref`，而非全局单例。
- **展示型组件走 props**：对外只消费、不持有跨组件状态的部分（如 `StatsView` 接收 `datasets`/`datasetAnnotations`/`categoryColorMap`），用 `defineProps` 接收，纯逻辑 composable（`useDatasetStats`/`useChartOptions`）在内部计算。
- **纯逻辑优先抽 composable**：统计、图表配置等无 UI 的逻辑务必进 `src/composables/`，组件只负责渲染。
- **纯绘制原语抽模块**：Canvas 绘制函数（`drawAnnotation` 等）抽为不持状态的 `src/canvas/canvasDraw.ts`，以 `imgW/imgH/zoom` 参数替代闭包，便于复用与测试。

### 2. 类型与 TypeScript
- **类型集中出口**：共享类型定义在 `src/types.ts`，并在该文件统一 `export`/`re-export`（含从 `annotationParser`/`datasetStructureAnalyzer`/`dataset/types` 等再导出的类型）。组件统一从 `../types` 导入，避免“未导出成员”错误。
- **零隐式 any**：函数参数、回调参数显式标注类型；确实无法推断处用 `any` 必须加行内注释说明原因。
- **未用参数约定**：不使用的回调参数用下划线前缀（如 `(_total, status)`），避免 TS 报未用变量。
- **验证门槛**：提交前 `pnpm exec vue-tsc --noEmit` 须为 0 error（历史遗留错误修复后不得引入新的）；`vite build` 只做 transform/import 校验。

### 3. 工具链与验证
- **只用 pnpm**，禁止混用 npm（会争用 `strictPort: 1420`，旧 dev 进程残留导致改了不生效）。
- **验证手段**：`pnpm dev`/`vite` 用 esbuild 不做类型检查（主验证）；`pnpm build` = `vue-tsc --noEmit && vite build`（门禁）。
- **终端不可靠时上 Python**：涉及编码/乱码/按代码点精确替换/按行截断的修复，用 Python 脚本（`open(..., encoding='utf-8')`）比 PowerShell 稳定。
- **禁止把工具调用参数写进源文件**：写入文件时确保只落地真正的代码/注释，绝不能把 `</parameter>`、`<parameter name="...">` 之类的工具调用片段带入 `.ts`/`.vue`。

### 4. 编码与乱码
- **杜绝 mojibake**：中文混入西里尔/亚美尼亚/阿拉伯/希腊等脚本字符是常见的错误解码产物，**不是** U+FFFD。修复时用 Python 按代码点定位并替换。
- **文件统一 UTF-8**：所有源文件以 UTF-8 读写。

### 5. 双端（浏览器 / Tauri）适配
- **统一走环境适配层**：所有文件读写走 `src/env.ts` 的抽象（`pickDirectory` / `readDir` / 字节读取 / 尺寸解析），组件不写平台分支。
- **Tauri 调用**：用 `@tauri-apps/api/core` 的 `invoke`（v2，不是 v1 的 `/tauri`）。
- **偏好纯 Web 标准**：能用 `IndexedDB` / `Worker` / `createImageBitmap` / `OffscreenCanvas` 的，双端通用，不写平台专属实现。

### 6. 数据管线（canonical 中间模型）
- **标注以 canonical 为权威**：`getFileAnnotations` 优先读 `dataset.canonical.samples[].annotations`（经 `sampleToAnnotations` 还原为 `ParsedAnnotation`），旧 `datasetAnnotations` 表仅作 id/path 兜底。
- **坐标约定**：bbox 统一存归一化 YOLO `[cx, cy, w, h]`（0~1），导出时按图片尺寸换算为像素（VOC/COCO）；polygon/seg 存归一化点。导入/导出阶段无需反复读图取尺寸。
- **尺寸解析零解码**：`env.parseImageSize(bytes)` 从字节头部解析宽高，主线程零开销；禁止在加载循环里 `new Image()` 整图解码（主线程卡顿根因）。
- **`ImageFile.path` = 真实相对路径**：Tauri 下删除/字节读取依赖真实路径；`detectSplitAndCategory` 也靠真实路径推断 split。

### 7. 死代码与废弃功能
- **直接删，不留壳**：确认废弃的功能（如缩略图）连同其渲染、生成、占位框、未用 import 一起删除；不要保留空函数、空 `watch`、`.file-thumb-placeholder` 之类死代码。
- **大功能下线要连带清理**：移除 feature 时同步清理旧管线里对应的旧实现（若确认无其它调用方）。

### 8. 命名与结构
- composable：`use` 前缀（`useTheme`/`useViewerState`/`useDatasetStats`）；
- 展示型组件：`PascalCase` 单文件组件，放在 `src/components/`；
- 类型/接口：大驼峰，集中在 `types.ts`（及 `dataset/types.ts`、`dedup/types.ts` 等领域内类型文件）；
- 全局样式放 `src/styles/*.less`，组件级唯一前缀类名（如 `.viewer-*`、`.compare-*`、`.dedup-view`）可安全全局生效，不与 scoped 样式冲突。
