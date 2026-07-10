# API_CONTRACT - 接口契约

> 最后更新：2026-07-05 | 定义关键 Interface，解耦核心

## 设计原则

1. **契约优先**：先定义 Interface，再写实现
2. **依赖倒置**：模块间通过 Interface 解耦，不写死依赖
3. **物理隔离**：按功能拆分文件夹，修改 A 不波及 B

---

## 核心接口定义

### 1. IFileSystem — 文件系统适配接口

```typescript
// env.ts 已实现，未来可扩展为正式 Interface

/** 环境类型 */
type EnvType = 'browser' | 'tauri';

/** 选择文件夹 */
declare function pickDirectory(): Promise<DirectoryHandle | null>;

/** 递归读取文件夹 */
declare function readDir(handle: DirectoryHandle): Promise<FileEntry[]>;

interface FileEntry {
  path: string;  // 相对路径
  file: File;    // Blob 对象
}

/** 生成缩略图 */
declare function generateThumbnail(
  file: File, 
  maxWidth?: number, 
  maxHeight?: number
): Promise<string>;  // 返回 DataURL

/** 获取图片尺寸 */
declare function getImageDimensions(
  file: File
): Promise<{ width: number; height: number }>;
```

**实现类**：
- `BrowserFileSystem` — 浏览器版（`showDirectoryPicker` + `FileReader`）
- `TauriFileSystem` — 客户端版（`@tauri-apps/api`）

---

### 2. ILabelParser — 标注解析接口

```typescript
// annotationParser.ts

/** 解析后的标注数据 */
interface ParsedAnnotation {
  type: 'bbox' | 'polygon' | 'circle';
  bbox?: [number, number, number, number]; // [x, y, w, h]
  points?: [number, number][];             // 多边形顶点
  category: string;                         // 类别名称
  normalized?: boolean;                     // 是否归一化（YOLO）
  color?: string;                           // 类别颜色
  confidence?: number;                       // 置信度 (0-1)
  description?: string;                      // 文本描述
}

/** 解析所有标注文件 */
declare function parseAllAnnotations(
  files: Map<string, { file: File; name: string; path: string; content?: string }>,
  imagePaths: string[],
  getCategoryColor: (category: string) => string
): Map<string, ParsedAnnotation[]>;
```

**支持格式**：
- `CocoParser` — COCO JSON 格式
- `LabelMeParser` — LabelMe JSON 格式
- `YoloParser` — YOLO TXT 格式
- `VocParser` — VOC XML 格式

**扩展方式**：新增 `IFormatParser` 实现类，注册到 `parseAllAnnotations`。

---

### 3. IHashCalculator — 哈希计算接口

```typescript
// hashService.ts + worker.ts

/** 哈希计算任务 */
interface HashTask {
  file: File;
  algorithm: 'md5' | 'phash';
}

/** 哈希计算结果 */
interface HashResult {
  fileId: string;
  hash: string;
  phash?: string;
}

/** 哈希计算服务 */
interface IHashCalculator {
  /** 计算单个文件哈希 */
  calculate(file: File, algorithm: 'md5' | 'phash'): Promise<HashResult>;
  
  /** 批量计算（WebWorker池） */
  calculateBatch(
    files: File[],
    onProgress?: (current: number, total: number) => void
  ): Promise<HashResult[]>;
  
  /** 取消计算 */
  cancel(): void;
}
```

**实现类**：
- `SingleThreadCalculator` — 单线程计算（备用）
- `WorkerPoolCalculator` — WebWorker 池计算（推荐）

---

### 4. IDataSetLoader — 数据集加载接口

```typescript
// datasetService.ts

/** 数据集加载选项 */
interface DatasetLoadOptions {
  onProgress?: (current: number, total: number, status: string) => void;
  maxFiles?: number;  // 最大文件数（防止内存溢出）
}

/** 数据集加载服务 */
interface IDataSetLoader {
  /** 加载数据集 */
  load(options?: DatasetLoadOptions): Promise<DataSet>;
  
  /** 识别数据集结构 */
  analyzeStructure(files: FileEntry[]): Promise<StructureAnalysisResult>;
}
```

**输出 DTO**：
```typescript
interface DataSet {
  id: string;
  name: string;
  files: Map<string, ImageFile>;
  fileList: ImageFile[];
  totalCount: number;
  dupCount: number;
  uniqueCount: number;
  structureAnalysis?: StructureAnalysisResult;
  annotationFiles?: Map<string, AnnotationFile>;
}
```

---

### 5. IDuplicateDetector — 去重检测接口

```typescript
// datasetService.ts

/** 去重检测服务 */
interface IDuplicateDetector {
  /** 计算重复文件（基于 MD5） */
  findDuplicates(dataset: DataSet): Map<string, ImageFile[]>;
  
  /** 计算相似文件（基于 pHash） */
  findSimilar(
    dataset: DataSet, 
    threshold: number
  ): CompareResult[];
  
  /** 双数据集交叉比对 */
  compareDatasets(setA: DataSet, setB: DataSet): CompareResult[];
}
```

**输出 DTO**：
```typescript
interface CompareResult {
  type: 'duplicate' | 'similar' | 'unique' | 'onlyA' | 'onlyB';
  fileA?: ImageFile;
  fileB?: ImageFile;
  similarity: number;  // 0-1
  groupId: string;
}
```

---

### 6. IAnnotationRenderer — 标注渲染接口

```typescript
// ImageViewer.vue 内部方法

/** 标注渲染选项 */
interface RenderOptions {
  color: string;
  lineWidth: number;
  fillAlpha: number;
  showLabel: boolean;
  showConfidence: boolean;
  showDescription: boolean;
}

/** 标注渲染器 */
interface IAnnotationRenderer {
  /** 渲染单个标注 */
  render(
    ctx: CanvasRenderingContext2D,
    annotation: ParsedAnnotation,
    transform: Transform
  ): void;
  
  /** 渲染标签（类别 + 置信度 + 描述） */
  renderLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string
  ): void;
}
```

---

## 模块间依赖关系（解耦设计）

```
App.vue
  ├── IDataSetLoader (datasetService.ts)
  ├── IDuplicateDetector (datasetService.ts)
  ├── ILabelParser (annotationParser.ts)
  └── IFileSystem (env.ts)

FileList.vue
  └── IFileSystem.generateThumbnail (懒加载缩略图)

ImageViewer.vue
  └── IAnnotationRenderer (内部渲染)

HashService
  └── IHashCalculator (worker.ts)
```

**关键解耦点**：
1. `IFileSystem` — 浏览器/Tauri 实现可切换
2. `ILabelParser` — 新增标注格式只需扩展解析器
3. `IHashCalculator` — 单线程/WebWorker池可切换
4. `IDuplicateDetector` — 去重算法可替换（未来支持 dHash/wHash）

---

## 未来扩展接口（预留）

### IQualityChecker — 质量检查接口

```typescript
// 待实现：src/composables/useQuality.ts

interface QualityResult {
  fileId: string;
  blurScore: number;      // 模糊得分（拉普拉斯方差）
  brightness: number;     // 平均亮度
  isDark: boolean;        // 是否过暗
  isBright: boolean;      // 是否过亮
  isLowRes: boolean;      // 是否低分辨率
  isMonochrome: boolean;  // 是否单色图
  overallScore: number;   // 综合质量评分 (0-100)
}

interface IQualityChecker {
  check(dataset: DataSet): Promise<QualityResult[]>;
}
```

### IExportService — 导出服务接口

```typescript
// 待实现：src/utils/export.ts

interface ExportOptions {
  format: 'csv' | 'json' | 'zip' | 'pdf';
  includeAnnotations: boolean;
  includeQualityReport: boolean;
}

interface IExportService {
  export(dataset: DataSet, options: ExportOptions): Promise<void>;
}
```

---

## 总结

- **3 个核心文档** 已创建：`PROJECT_ARCHITECTURE.md`、`CURRENT_STATUS.md`、`API_CONTRACT.md`
- **接口契约** 已定义：6 个核心接口 + 2 个预留接口
- **解耦设计** 已实现：环境适配层、标注解析器、哈希计算器均可独立替换
- **下一步**：按照接口契约，实现 `IQualityChecker` 和 `IExportService`

---

## 开发规范守则（Dev Conventions）

> 2026-07-10 增补 | 围绕本仓库实际踩坑经验沉淀，供后续开发与 AI 协作遵循

### 1. 组件拆分与状态管理
- **禁止上帝组件（God Component）**：单文件超过 ~600 行即应拆分。`DatasetViewer.vue` 已拆为 `useViewerState`（共享状态/动作 composable，模块级单例）+ `ViewerHeader` / `CompareWizard` / `ExportDialog` / `SettingsPanel` / `SingleView` / `CompareView` 等展示型子组件。
- **跨组件共享状态用 composable 单例**：需要多个兄弟组件共享同一份响应式状态时（如 viewer 的 `datasets`/`selectedFile`/`viewMode`），收敛到一个 `useXxx()` composable（模块级单例，参考 `useTheme`、`useViewerState`），各组件 `const s = useXxx()` 后解构使用。**不要**层层透传 prop。
- **展示型组件走 props**：对外只消费、不持有跨组件状态的部分（如 `StatsView` 接收 `datasets`/`datasetAnnotations`/`categoryColorMap`），用 `defineProps` 接收，`useDatasetStats`/`useChartOptions` 等纯逻辑 composable 在内部计算。
- **纯逻辑优先抽 composable**：统计、图表配置等无 UI 的逻辑务必进 `src/composables/`，组件只负责渲染。
- **碎片根节点（fragment）可用**：子组件在 `.viewer-main` 这类 flex 容器内充当多个并列子元素时，模板可用多根节点（fragment），让父级 flex 正常布局。

### 2. 类型与 TypeScript
- **类型集中出口**：共享类型定义在 `src/types.ts`，并在该文件统一 `export`/`re-export`（含从 `annotationParser`/`datasetStructureAnalyzer` 等再导出的类型）。组件统一从 `../types` 导入，避免“未导出成员”错误。
- **零隐式 any**：函数参数、回调参数显式标注类型；确实无法推断处用 `any` 必须加行内注释说明原因（如“跨全部数据集取标注，类型随 canonical 变化”）。
- **未用参数约定**：不使用的回调参数用下划线前缀（如 `(_total, status)`），避免 TS 报未用变量。
- **验证门槛**：提交前 `pnpm exec vue-tsc --noEmit` 须为 0 error（历史遗留错误修复后不得引入新的）；`vite build` 只做 transform/import 校验，不报类型错误，但能抓出 import 路径/语法错误。

### 3. 工具链与验证
- **只用 pnpm**，禁止混用 npm（会争用 `strictPort: 1420`，旧 dev 进程残留导致改了不生效）。
- **验证手段**：`pnpm dev`/`vite` 用 esbuild 不做类型检查（主验证）；`pnpm build` = `vue-tsc --noEmit && vite build`（门禁）。
- **终端不可靠时上 Python**：涉及编码/乱码/按代码点精确替换/按行截断的修复，用 Python 脚本（`open(..., encoding='utf-8')` + 构造 code point）比 PowerShell 稳定；PowerShell 处理非 ASCII 与特殊字符易出错。
- **禁止把工具调用参数写进源文件**：写入文件时确保只落地真正的代码/注释，绝不能把 `</parameter>`、`<parameter name="...">` 之类的工具调用片段带入 `.ts`/`.vue`。这类泄漏会导致 `TS1110/TS1005/TS1161/TS1127` 解析错误，且难以用肉眼发现。

### 4. 编码与乱码
- **杜绝 mojibake**：中文混入西里尔/亚美尼亚/阿拉伯/希腊等脚本字符是常见的错误解码产物，**不是** U+FFFD。修复时用 Python 按代码点定位并替换，不要靠肉眼或 PowerShell `replace`。
- **文件统一 UTF-8**：所有源文件以 UTF-8 读写，禁止在中间环节用错误编码解码。

### 5. 双端（浏览器 / Tauri）适配
- **统一走环境适配层**：所有文件读写走 `src/env.ts` 的 `IFileSystem` 抽象（`pickDirectory` / `readDir` / 字节读取 / 尺寸解析），组件不写平台分支。
- **Tauri 调用**：用 `@tauri-apps/api/core` 的 `invoke`（v2，不是 v1 的 `/tauri`）。
- **偏好纯 Web 标准**：能用 `IndexedDB` / `Worker` / `createImageBitmap` / `OffscreenCanvas` 的，双端通用，不写平台专属实现。

### 6. 数据管线（canonical 中间模型）
- **标注以 canonical 为权威**：`getFileAnnotations` 优先读 `dataset.canonical.samples[].annotations`（经 `sampleToAnnotations` 还原为 `ParsedAnnotation`），旧 `datasetAnnotations` 表仅作 id/path 兜底。
- **坐标约定**：bbox 统一存归一化 YOLO `[cx, cy, w, h]`（0~1），导出时按图片尺寸换算为像素（VOC/COCO）；polygon/seg 存归一化点。导入/导出阶段无需反复读图取尺寸。
- **尺寸解析零解码**：`env.parseImageSize(bytes)` 从字节头部解析宽高，主线程零开销；禁止在加载循环里 `new Image()` 整图解码（主线程卡顿根因）。

### 7. 死代码与废弃功能
- **直接删，不留壳**：确认废弃的功能（如缩略图）连同其渲染、生成、占位框、未用 import 一起删除；不要保留 `setupXxx()` 空函数、空 `watch`、`.file-thumb-placeholder` 之类死代码。
- **大功能下线要连带清理**：移除 feature 时同步清理 `datasetService`/`datasetServiceV2` 等旧管线里对应的旧实现（若确认无其它调用方）。

### 8. 命名与结构
- composable：`use` 前缀（`useTheme`/`useViewerState`/`useDatasetStats`）；
- 展示型组件：`PascalCase` 单文件组件，放在 `src/components/`；
- 类型/接口：大驼峰，集中在 `types.ts`；
- 全局样式放 `src/styles/*.less`，组件级唯一前缀类名（如 `.viewer-*`、`.compare-*`）可安全全局生效，不与 scoped 样式冲突。

