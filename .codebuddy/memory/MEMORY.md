# 项目长期记忆（dataset-manager）

## 构建与验证约定
- **只用 pnpm，不要混用 npm**（用户明确要求）。`npm run dev` 会与 pnpm 的 `vite` 争用 `strictPort: 1420`，旧 dev 进程残留导致浏览器连旧代码、改了不生效。验证一律用 `pnpm dev`/`pnpm build`。
- `pnpm dev` / `vite` 用 esbuild，不做类型检查，是主要验证手段。
- `pnpm build` = `vue-tsc --noEmit && vite build`。截至 2026-07-10 经多轮清理（乱码、工具调用片段泄漏、孤儿组件、类型补全），`vue-tsc --noEmit` 已可 **0 错误**通过，可作为门禁；`vite build` 仍仅作 import/transform 校验。
- 环境判定见 `src/env.ts`：`env = '__TAURI__' in window ? 'tauri' : 'browser'`。Tauri v2 的 `invoke` 来自 `@tauri-apps/api/core`（不是 v1 的 `/tauri`）。

## 去重模块（2026-07-09 新增）
- 位置 `src/dedup/`：双端统一核心算法 + 环境分发文件读写。设计细节见当日日记。
- 三档强度、train/val/test 不交叉、脏数据离群检测、增量索引均已实现。

## 统一数据管线「中间模型」（2026-07-09 新增）
- 架构：引入「逻辑数据集」中间层，所有格式导入时归一化进 `CanonicalDataset`、导出时从它生成，与原始目录结构解耦。参考 FiftyOne 文档模型 + Roboflow（split 目录 + data.yaml + 类映射）。
- 坐标约定：**bbox 统一存归一化 YOLO 坐标 [cx, cy, w, h]（0~1）**，导出时按图片尺寸换算为像素（VOC/COCO）；polygon/seg 存归一化点。这样导入/导出阶段无需反复读图取尺寸。
- 文件：`src/dataset/types.ts`（规范模型类型）、`src/dataset/classRegistry.ts`（类别注册表：规范化 key 归并别名解决大小写/命名混乱，data.yaml/classes.txt 为权威）、`src/dataset/dataYaml.ts`（手写最小 data.yaml 解析，未引入 js-yaml）。
- 文件：`src/dataset/importers/`（Phase 2，YOLO/COCO/VOC/LabelMe/分类文件夹 五个导入器 + `index.ts` 自动识别分发）。`VirtualFile{path,getText,getBytes}` 屏蔽浏览器/Tauri 差异。
- **LabelMe 导入器（2026-07-09 补回）**：旧 `annotationParser.parseLabelMe` 支持每图一个 `.json`（shapes 数组，矩形/圆/多边形→bbox），但新版 canonical 管线漏做 `labelme.ts` 且 `detectFormat` 不识别。已补 `src/dataset/importers/labelme.ts`，并在 `detectFormat` 加「采样 .json 校验 `Array.isArray(data.shapes)` → 'labelme'」，`DatasetFormat` 类型加 `'labelme'`，分发加 case。`DatasetStructureDialog` 的 labelme 选项此前无后端实现，现已对齐。
- 已用 esbuild+node 临时自测验证 data.yaml 解析、类归并、四种格式导入（共 29 项断言全绿），临时文件已清理。`read_lints` 全模块 0 错误。
- Phase 3 已完成（2026-07-09）：去重增强——`splitOf` 权威 split 落地、`removedBySplit`（精确统计每个子集删几张）、跨子集泄漏检测 `LeakagePair`、`compareMode:'mixed'` 子集混合模式（优先保留非子集侧）。见当日日记。
- 待续（Phase 4）：`rebalanceSplits` 按比例分层抽样重划分 + 统一命名导出器（YOLO/COCO/VOC）已实现，并已在 DatasetViewer 导出对话框（exportBrowser.ts）接好闭环。DedupView 已迁移到 canonical 管线。

## 关键架构决策（2026-07-09 二次会话）
- **`ImageFile.path` = 真实相对路径 `CanonicalSample.sourcePath`**（不是生成的 `s.id`）。理由：Tauri 下 `deleteFiles`/字节读取依赖真实路径；`detectSplitAndCategory(f.path)` 也靠真实路径推断 split。`ImageFile.id = s.id`（稳定，跨次一致，供去重/索引）。
- **canonical 是标注的权威来源**：`DatasetViewer.getFileAnnotations` 改为 canonical 优先（按 `file.id` 匹配 `canonical.samples[].annotations`，经导出的 `sampleToAnnotations` 转 `ParsedAnnotation`），回退旧 `datasetAnnotations` 表（按 id 再按 path）。统计窗口的「标注总数/类别数/标注类型/类别分布/目标尺寸占比」此前显示 0，正是因为只读了旧 `datasetAnnotations` 表；改读 canonical 后修复。
- **统计窗口已升级为 ECharts 图表**：新增 `src/components/ChartPanel.vue`（封装 `echarts.init` + 响应式 `setOption(notMerge)` + ResizeObserver + dispose）。`echarts`（v6.1.0）已加入 dependencies。类别分布=横向柱状、子集/标注类型/宽高比/目标尺寸占比=饼图、分辨率/文件大小=柱状。类型用 `EChartsOption`（注意 `EChartsCoreOption` 不在 echarts 主包导出，勿用）。
- DedupView：`loadDatasetWithAnnotations`(datasetServiceV2) → `loadDatasetCanonical`；`runDedup` 通过 `options.splitOf` 注入 canonical 的权威 split，使 `removedBySplit`/泄漏检测基于真实子集。删除路径现为真实 sourcePath，Tauri 删除可用。

## DatasetViewer 组件拆分架构（2026-07-10 第四波）
- `src/components/DatasetViewer.vue` 已拆为「编排层 + 子组件」，共享状态收拢进 `src/composables/useViewerState.ts`（模块级单例 composable，参考 `useTheme`）。子组件：`ViewerHeader`/`CompareWizard`/`ExportDialog`/`SettingsPanel`/`SingleView`/`CompareView`，均 `const s = useViewerState()` 解构使用；`StatsView` 经 props 接收 `datasets`/`datasetAnnotations`/`categoryColorMap` 并用自有 `useDatasetStats`/`useChartOptions`。
- 原 `<style scoped>`（849 行）抽为全局 `src/styles/viewer.less`（在 `style.less` 于 `dark.less` 之前 `@import`）；类名组件级唯一前缀，全局安全。
- 早期拆分遗留的 `MultiCompareView/MultiDatasetCompare/CompareItem.vue` 为孤儿组件（无运行时引用），已于 2026-07-10 第五波删除（同步清理 `components.d.ts` 声明，构建时 unplugin-vue-components 自动再生）。
- 行为差异：单例状态在 browse↔dedup 切换时保留已加载数据集（旧版每次挂载清空）。

## 上帝组件拆分延续（2026-07-10 第五波）
- `ImageViewer.vue` 778→494：纯 canvas 绘制原语 `drawCheckerboard/drawAnnotation/drawLabel/rRect/hexA` 抽到 `src/canvas/canvasDraw.ts`（模块，不持有响应式状态；`drawAnnotation/drawLabel` 以 `imgW/imgH/zoom` 参数替代闭包 `currentImage`/`zoom.value`）；`<style scoped>` 抽 `src/styles/image-viewer.less`，用 `.image-viewer {}` 根类嵌套（裸 `canvas`→`.image-viewer canvas`）避免全局污染。
- `DedupView.vue` 762→477：仅 `<style scoped>` 抽 `src/styles/dedup.less`；其样式含大量通用类名（`.config-card`/`.stat-item`/`.action-bar`/`.mt-2`），故整体嵌套在 `.dedup-view` 根选择器下限定作用域。
- `src/style.less` 于 `dark.less` 之前 `@import` `viewer.less`/`image-viewer.less`/`dedup.less`。
- 避免上帝组件的有效手法（已验证）：①状态/纯逻辑抽 composable（`useViewerState` 单例 / `canvasDraw` 模块）；②`<style scoped>` 含通用类名时，抽全局 less 并用根类嵌套限定作用域，而非保留超大 scoped 块；③无运行时引用的孤儿组件直接删并清理 `components.d.ts`。拆分后全量 .vue 最大 494 行，无 >600 行组件。

## 开发规范守则（2026-07-10 写入 API_CONTRACT.md）
- `document/API_CONTRACT.md` 末尾「开发规范守则」章节：组件拆分/状态管理、类型与 TS、工具链（只用 pnpm + `vue-tsc` 门禁 + Python 处理编码）、编码与乱码（禁把工具调用参数写入源文件）、双端适配、canonical 管线、死代码直接删、命名结构。

## 缩略图功能已移除（2026-07-10 最终决定）
- **确认根因（用户二次反馈）**：首次加载后"切图先出框延迟后才出图 + 悬停浮窗卡顿，加载完才恢复"。即便已把生成搬进 Worker，在 Tauri 下模块 Worker 易回退主线程解码（或 351 张 `<img>` 响应式更新+解码抢占主线程），缩略图流式生成阶段主线程被占满 → 确认**缩略图确为主线程性能开销**。另一恒定杀手：`loadCanonical.ts` 的 `getImageDimensions` 用 `new Image().src→img.onload` 对**每张图整图解码**（主线程全量解码 351 张后 await）。
- **用户决策**：确认缩略图是开销后，**直接移除缩略图功能与相关逻辑**。
- **执行（双端通用，纯 Web 标准）**：
  - 删除 `src/thumbnailStore.ts`、`src/thumb.worker.ts`，移除 `ImageFile.thumbnail` 字段；
  - `env.ts`：删除 `generateThumbnail`，新增 `parseImageSize(buf)`——**零解码**从字节头部解析宽高（JPEG/PNG/GIF/BMP/WebP VP8/VP8X/VP8L），主线程瞬间完成、无任何像素解码；
  - `loadCanonical.ts`：移除 `getImageDimensions`(整图解码) 与 eager 缩略图块，改用 `parseImageSize(bytes)`（循环内已有 `bytes`，无需额外 I/O）；加载循环变为纯 I/O + 头部解析，主线程全程空闲；
  - `DatasetViewer.vue`/`FileList.vue`/`FileSelector.vue`/`DedupView.vue`/`datasetService.ts`/`datasetServiceV2.ts`：全部移除缩略图渲染（`file.thumbnail` img）与生成（`generateThumbnail`/`getThumbnail`/`prefetchThumbnails`/`ensureThumbs`），文件列表改显示占位图标。
- **效果**：加载期不再有任何主线程图片解码（尺寸解析零开销），主线程全程空闲 → 切图/悬停浮窗即时响应，达到 X-AnyLabeling 式超低延迟。代价：文件列表/重复组/脏数据不再有缩略图预览（仅占位图标），符合用户取舍。
- 死代码已彻底清理（2026-07-10 第三波恢复）：`DatasetViewer` 的 `setupThumbLazyLoad`/`teardownThumbLazyLoad` 空壳函数、对应 `watch(filteredFiles)` 块、`file-thumb-placeholder` 模板与样式，以及不再使用的 `watch`/`nextTick`/`Picture` 导入均已移除。
- 注：`datasetService.ts`/`datasetServiceV2.ts` 的 `getImageDimensions`（整图解码，主线程）属遗留旧管线，本次未改为 `parseImageSize`（DedupView 实际走 `loadDatasetCanonical`，已受益）；若后续启用旧管线再处理。
- lint/tsc：本次新增/改动 0 新错误（DatasetViewer 预存 `ParsedAnnotation` 未导出等 3 个 TS 错误非本次引入）。
