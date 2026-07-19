# 开发规范（避免上帝模块 / 上帝组件）

> 目标：保持模块单一职责、可测试、可维护。本规范用于代码评审与重构验收。

## 1. 模块体量上限

- **单文件 ≤ 400 行**（纯逻辑模块，如 composable / util）。超过即触发拆分评审。
- **单 Vue 组件 ≤ 600 行**（模板 + 脚本 + 样式）。交互/绘制逻辑超此限应抽到 composable 或纯函数模块。
- 超过上限的既有文件（如 `useViewerState.ts`、`ImageViewer.vue`）列入技术债清单，按簇逐步拆分，**不得继续往里堆逻辑**。
  - `useViewerState.ts`（1757→~200）已拆为 `src/composables/viewer/` 子切片（见 §3）。
  - `ImageViewer.vue`（993→219）已拆为 `src/components/canvas/` 子切片（见 §3.1）。

## 2. 单一职责与按关注点拆分

- 一个文件/模块只解决一类问题。判定信号：文件同时 import 了“导出 + 版本 + 编辑 + 面板 + 加载”等多簇关注点 → 应拆。
- **对称模式**（已在项目中落地，新代码遵循）：
  - 导入：`src/dataset/importers/`（按格式分文件）
  - 解析：`src/parsers/`（按格式分文件，与 importers 对称）
  - 导出：`src/dataset/exporters/`（序列化）+ `src/dataset/exportCore.ts`（打包/落盘公共核心）
- 同类逻辑既已存在“按格式/按簇”的目录，新增格式/簇时**放进对应目录**，不要塞进主文件。

## 3. Composable 组合而非巨无霸单例

- 共享状态用模块级单例 composable（如 `useViewerState`）没问题，但**内部必须按簇拆子 composable**：
  - 每个子 composable 自己 `ref/computed` 自己的状态与动作，只接收真正共享的依赖（如 `datasets`）。
  - 主 composable 仅负责**声明共享状态 + 组合子 composable + 展开返回**，不内联各簇实现。
- 反例：`useViewerState` 单函数内联 90+ 导出、导出/版本/编辑/面板/加载全部堆在一起。
- 正例：`useViewerState` 组合 `useExport(datasets)`、`useVersion(datasets)` 等，各簇逻辑在各子文件。
- **`useViewerState`（单例主 composable）已按簇拆分落地**，主文件仅保留：共享状态声明 + 计算属性 + 组合子切片 + 展开返回。
  子切片位于 `src/composables/viewer/`：
  - `useExport.ts` / `useVersion.ts`：导出与版本（仅依赖 `datasets`）。
  - `useUrlCache.ts`：Blob URL 全局 LRU（键为文件对象引用）。
  - `useAnnotations.ts`：标注访问 + 编辑清洗台（`deleteAnnotationAt` 的 EditCommand apply/revert）。
  - `usePanes.ts`：多窗格状态（panes/activePane/dualPane/导航/对齐）。
  - `useCompute.ts`：哈希计算 + 质量检查（目标筛选）。
  - `useLoading.ts`：数据集加载 / 纠错回路 / 结果接入 / 来源元信息。
  - `useWorkspace.ts`：工作区结构配置序列化 / 持久化 / 恢复 / 清空 + 自动保存。
  - `useView.ts`：视图模式 / 显示设置 / 共享侧栏 / 键盘导航 glue。
  - `types.ts`：窗格/筛选领域类型（`PaneState`/`FilterType`/`SortKey`/`OverlapInfo`），向消费者再导出。
- 切片组合契约：子切片 `useXxx(deps)` 接收依赖参数并返回自身状态/动作；主文件 `return { ...ann, ...paneSlice, ...computeSlice, ...loadingSlice, ...exportSlice, ...versionSlice, ...workspaceSlice, ...viewSlice }`，**对外命名与形态保持不变**（13 个 .vue 消费者零改动）。

### 3.1 组件级拆分范例：`ImageViewer.vue`（993→219）

- 画布类组件按关注点拆为「渲染编排」与「交互状态机」两片，纯几何工具单独立模块；主组件仅做 glue（props/emit/defineExpose 契约不变）。
- 切片位于 `src/components/canvas/`：
  - `geometry.ts`(32)：纯几何工具 `pBBoxToC/cBBoxToP/flatten/unflatten/normToLocal` + `DragMode` 类型，两切片共用，**禁止在组件内联**。
  - `useCanvasRender.ts`(≤400)：画布渲染编排（图片加载 + 缩放/平移 + 选中手柄绘制 + 指针换算 `pointerInfo` + ResizeObserver 生命周期）；对外 `containerRef/canvasRef/zoom/panX/panY/imageInfo/onWheel/onDoubleClick/resetView/pointerInfo`。
  - `useCanvasInteraction.ts`(≤400)：标注编辑交互状态机（onMouseDown/onGestureMove/onGestureUp/doPan/hitTestAnn/键盘取消绘制 + 拖拽状态 refs）；对外 `canvasCursor/onMouseDown/onCanvasMouseMove/onCanvasMouseLeave/onCanvasContextMenu/cancelDraw`。
- **共享拖拽状态**（dragMode/drawStart/drawCur/drawAnchored）在组件层 `ref` 创建，同时注入两个切片（渲染要靠它们画 draw 框 / 选中手柄）。canvas 内部 private 状态（currentImage）只在 render 片内。
- **关键 API 契约（改动 canvas 时务必对齐，原组件曾与以下真实签名漂移）**：
  - `editingMode` 是 `'select' | 'draw'`（**不是 `'edit'`**）；`'select'` = 可编辑/选中模式，`'draw'` = 绘制模式。
  - `store.commitCoordsEdit(file, idx, prev, next)` 与 `store.commitRotationEdit(file, idx, prev, next)` 需 **prev/next 四参**；`store.addBBoxAnnotation(file, bbox, classId)` 需 **classId 三参**（用 `store.editClassId.value`）。
  - `ParsedAnnotation.type` 是 `'keypoint'`（**不是 `'keypoints'`），且无 `'segmentation'`（`mask`/`polygon` 代替）。
  - `canvasDraw.drawAnnotation(ctx, ann, fitX, fitY, scaleX, scaleY, isSelected, imgW, imgH, zoom, prediction?, overrideColor?)` 需要 imgW/imgH（来自 `currentImage`）；`drawHandles(ctx, handles: Record<HandleId,{x,y}>, zoom)` 收 **Record 而非数组**；`drawCheckerboard(ctx, x, y, w, h)` 收 5 参；`obbCornerHandles` 返回 `{id,x,y}[]`（喂 `hitHandle` 前需转 `Record<HandleId,{x,y}>`）；`computeFit` 返回的 `ImageFit` 含 `cw/ch/scaleX/scaleY`（无 `scale`/`zoom`）。
  - `geometry.ts` 务必用 `write_to_file` 保证内容落地（曾因写入异常变空文件导致 "not a module"）。

## 4. 重构时保护对外契约

- 重构公共 composable / 工具时，**保持对外返回形态与命名不变**，否则所有消费者（解构取值处）会静默断裂。
- 需要移动文件/重命名时，保留**再导出薄壳**（如 `annotationParser.ts` 仅 `export { ... } from './parsers'`）以维持旧 `import` 不变，给消费者迁移窗口。
- 类型再导出用 `export type`（项目开启 `isolatedModules`）。

## 5. 验证门禁

- 任何重构后必须 `pnpm exec vue-tsc --noEmit` 通过（0 错误）且 lint 0。
- Tauri 端改动需 `pnpm tauri dev` 重新编译生效；浏览器端 `pnpm dev` 验证。

## 6. 审查清单（提交前自查）

- [ ] 本文件是否只做一件事？
- [ ] 行数是否 ≤ 上限？超限是否已立项拆分？
- [ ] 新增同类逻辑是否落入了既有“按格式/按簇”目录？
- [ ] 共享 composable 是否按簇拆子 composable，而非继续堆主文件？
- [ ] 对外返回/导出契约是否保持不变（或用薄壳兼容）？
- [ ] `vue-tsc --noEmit` 与 lint 是否通过？
