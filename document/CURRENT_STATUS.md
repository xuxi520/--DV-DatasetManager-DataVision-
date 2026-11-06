# CURRENT_STATUS - 进度看板

> 最后更新：2026-07-20 | Checklist 形式，只记录状态。项目定位：本地优先（Local-First）的 AI 数据集管理与清洗工具，弥补市面开源/商业工具短板。
> 版本以 `package.json` 为准（当前 `1.0.0`）。
> 本期重点（2026-07-18）：P3 可用性收官——主动学习钩子（导入模型输出定位难样本）、增强预览、拖拽上传文件夹、操作历史与撤销快捷键、多语言 i18n（中/英，vue-i18n@11）全部落地。
> 上期重点（2026-07-17）：去重从顶层独立 Tab 并入浏览工作台（预览/统计/相似/去重 平级视图，共享已加载数据集）；导出报表彻底统一为单一模块 `src/report/reportHtml.ts`，质量/统计/相似/去重全部复用。
> **2026-07-20 修正**：① **客户端（Tauri）拖放加载功能已移除**——WebView2 在 HTML5 模式剥离 `File.path`（拿不到真实路径），原生 `onDragDropEvent` 模式又带 Windows 禁止光标且体验差，两条路都不可接受；客户端现统一走标题栏「选择文件夹」按钮加载，拖放加载**仅浏览器端可用**。② 新增**启动动画（splash）**：`index.html` 内联静态层（白底 + `about-hero.png` 全屏 `contain` + 底部 spinner/品牌名/流光进度条），`main.ts` 首屏渲染后淡出；`tauri.conf.json` 窗口 `backgroundColor` 改白消除蓝闪。③ 修复 `ann.worker.ts` 类型错误（`DedicatedWorkerGlobalScope` 缺失，改用最小本地 `WorkerCtx` 接口，避免引入 webworker lib 与 DOM 全局冲突）。

## 已完成功能 ✅

### 基础架构
- [x] Vue3 + Vite + Element Plus + TypeScript 搭建
- [x] 环境适配层（`src/env.ts`，浏览器 `showDirectoryPicker` + Tauri v2 双端统一，`__TAURI_INTERNALS__` 判定）
- [x] Less 样式 + 深色模式（`dark.less`，`useTheme` 浅色/深色/跟随系统）
- [x] 自动导入（unplugin-auto-import + unplugin-vue-components）
- [x] 导航栏 / 工具栏紧凑化（2026-07-11）：顶部工具条由一排 7 按钮收敛为「加载(分裂下拉) + 导出图标 + 更多菜单」，摘要压缩为一行灰字，栏高 56→46px；导航栏主题选择器图标化。去重不再是顶层独立 Tab（2026-07-17 重组）：顶层只保留品牌 + 主题，浏览工作台内部 `viewMode` 统一切换「预览 / 统计 / 相似 / 去重」四个平级视图（`ViewerHeader` radio），去重现共享浏览区已加载的全部数据集、总揽全局。

### 数据集加载与识别（Canonical 统一管线）
- [x] 文件夹选择（浏览器 / Tauri FS API）
- [x] 图片递归读取 + 过滤
- [x] 数据集结构自动识别 + 子集（train/val/test）权威识别（`splitDetect.ts`，canonical 优先，路径推断兜底）
- [x] **规范中间模型（CanonicalDataset）**：所有格式导入归一化为统一模型，与目录结构解耦
- [x] 导入器 `src/dataset/importers/`：YOLO / COCO / VOC / LabelMe / 分类文件夹（自动识别分发）
- [x] 类别注册表 `classRegistry.ts`：别名/大小写归并（data.yaml/classes.txt 权威）
- [x] `exportDatasetZip` + YOLO / COCO / VOC 导出器 + `rebalanceSplits` 分层抽样重划分
- [x] **Tauri 批量读字节（2026-07-11）**：Rust `read_files_bytes` 手写 base64 批量返回，替代逐图 IPC；去重分块 32 批量读 + 逐张哈希，导出批量读 `imageBytesMap`，加载/去重/导出显著提速。

### 文件列表与预览
- [x] 虚拟文件列表 `FileList.vue`（按 id 引用，无缩略图，占位图标；缩略图功能已整体移除，主线程零解码 `parseImageSize`）
- [x] 搜索 / 筛选（已标注/未标注/重叠/非重叠）/ 排序（名称/标注数/重叠/宽高/大小）
- [x] 图片预览 + Canvas 标注框渲染（绘制原语抽 `canvas/canvasDraw.ts`，零响应式状态）

### 多窗格对照浏览（PaneView，2026-07-11 升级为可变多窗格）
- [x] `useViewerState.panes`：`shallowRef<PaneState[]>`（上限 `MAX_PANES=6`），水平均分铺满超宽屏；`dualPane` 由 `panes.length>1` 派生
- [x] 增删：`addPane()` / `closePane(id)` 对 `panes.value` 整体重赋值触发响应式；底部多窗格标签条切换焦点窗格
- [x] 每个窗格独立 datasetId / 搜索 / 排序 / 筛选 / 选中 / 面板折叠
- [x] 键盘 ←/→ 作用于焦点窗格；同步切换仅双窗格时显示
- [x] 关键坑已规避：`PaneState` 内含 `Ref`/`ComputedRef`，必须用 `shallowRef` 避免 `UnwrapRef` 深层解包破坏类型

### 标注解析与渲染
- [x] 标注匹配：canonical 为权威，`datasetAnnotations` 表兜底
- [x] YOLO / VOC / COCO / LabelMe 解析；置信度百分比、描述悬浮窗
- [x] 标注框重叠检测（IoU ≥ 0.5 视为重叠，供筛选/统计）

### 哈希计算与去重（`src/dedup/`）
- [x] MD5 + pHash + dHash + aHash（WebWorker `hash.worker.ts`）
- [x] 进度 + 取消；完全重复（MD5）+ 近重复（pHash 汉明距离）
- [x] 三档强度（strict / standard / loose）；train/val/test 不交叉（`separateSplits`）
- [x] 跨子集泄漏检测 `LeakagePair`；脏数据检测（无效图 / 离群 outlier）
- [x] 增量索引（复用已有哈希）；删除走真实 sourcePath（Tauri 可用）
- [x] **去重并入浏览工作台（2026-07-17）**：`DedupView` 取消独立 `loadDataset`，改为消费浏览区共享的 `datasets`（`viewMode==='dedup'` 平级视图）；顶部「全部已加载数据集 / 各数据集」选择器，`splitOf` 跨所有数据集 canonical 建 `id→split` 映射使「全部已加载」也能正确分组去重；删除对单数据集走原逻辑、`__all__` 按路径反查所属数据集分组逐数据集删。

### 统计页（StatsView，ECharts）
- [x] 指标：图总数 / 标注总数 / 已标注 / 类别数 / 平均标注 / 疑似重复 / 无效 / 重叠框率 / 平均 IoU
- [x] 图表：类别分布（横向柱）、子集/类型/宽高比/目标尺寸（饼）、分辨率/大小（柱）
- [x] 「概览」模式（单选数据集或叠加所有）
- [x] 「对比」模式（多数据集并排列表对比 + **各数据集独立图表卡片**，2026-07-11）
- [x] **统计默认空（性能，2026-07-11）**：未选数据集返回 `EMPTY_STATS` 不遍历全部；概览下拉默认空 + clearable，「全部叠加」特殊值 `'__all__'`，未选显示 el-empty
- [x] **数据集级概览导出（2026-07-17）**：概览 / 对比模式工具栏加「HTML / PDF」按钮（复用 `src/report/reportHtml.ts`）。概览导出 12 项摘要卡 + 数据集概览/类别分布/子集分布/标注类型/分辨率/宽高比/文件大小/目标尺寸/IoU 分布等区段；对比导出每数据集卡 + 总体指标对比表 + 类别标注数对比表。质量模式导出沿用其自带按钮。

### 导出功能
- [x] 统一命名策略 `naming.ts`（class_seq 等）
- [x] 重划分（按比例分层抽样 + 分层 + 锁定 test + 种子）
- [x] 导出对话框 `ExportDialog.vue`
- [x] **统一报表模块 `src/report/reportHtml.ts`（2026-07-17）**：所有视图的 HTML/PDF 导出彻底统一为单一模块，不再各写一套 HTML。`generateReportHtml(ReportOptions{ title, subtitle?, summaryCards?, sections:[{caption?,cards?,headers,rows,emptyHint}] })` 数据驱动 + `downloadReportHtml` / `printReportHtml`（隐藏 iframe + `window.print()` 浏览器「另存为 PDF」，中文字体与内联样式正确、零额外依赖，打印不可用回退下载 HTML）+ `escapeHtml`。单文件、内联样式，可直接发给干系人或打印 PDF。
- [x] **各功能复用统一模块导出**：
  - 质量（质量页「导出 HTML/PDF 报告」）：`quality/report.ts` 重写为调用通用模块，保留 `downloadQualityReport`/`printQualityReport` 签名，`StatsView` 调用兼容不变。
  - 统计（概览/对比「HTML/PDF」）：数据集级概览（类分布/拆分等）+ 对比指标，见统计页章节。
  - 相似（`SimilarityView` 两 tab 工具栏「HTML/PDF」）：相似结果 + 离群 Top20。
  - 去重（`DedupView` 操作栏「HTML/PDF 报告」）：重复分组表 + 脏数据表 + 摘要卡，与既有 JSON 清单并存。
- [x] **标注 CSV / JSON 导出（IExportService，2026-07-17）**：`src/dataset/exportAnnotations.ts` 的 `exportAnnotations` 直接下载单文件（不打包图片），覆盖 bbox / OBB / 多边形 / 分割 / mask（RLE 与多边形）/ 关键点全部规范类型；归一化坐标 + mask RLE 原样保留（无损往返 COCO）；CSV 带 BOM 兼容 Excel 中文、列含 image_path/split/class/type/bbox/rotation/points/rle/iscrowd/confidence，JSON 结构化含 points / keypoints / rle / iscrowd；导出对话框新增「标注 CSV/JSON」内容模式（CSV / JSON 二选一），可选「重新划分」使导出子集反映重划分结果。

### 数据集版本 / 迭代间 diff（Versioning，2026-07-17）
- [x] **版本清单模型（轻量、可 diff）**：`src/dataset/versioning.ts` 的 `DatasetVersionManifest` 不内嵌全量标注，只保存类表 / split 计数 / 每类标注数 / 每样本 `{id, sourcePath, split, imageSize, annCount, annHash}`；`annHash` 由「归一化标注内容 + 类名 + split + 路径」经 FNV-1a 算出（坐标定点舍入，避免浮点噪声误判），用于判定「该图标注是否被改」。
- [x] **diff 引擎**：`diffManifests(after, before)` 纯内存比对，产出 新增 / 删除 / 修改（含标注数增减 + split 变更 ⚠）/ 类变化（增/删/重命名）/ split 变化 / 总量增减；`diffVersions(current, saved)` 便捷包装。
- [x] **双端存储 `versionStore.ts`**：
  - Tauri：每次保存把最新版本写数据集根 `dataset.dv.json`（自标识文件，下次打开经 `detectMarker` 自动识别并入历史）+ 全量历史写 IDB（`idbCache` v3 新增 `versions` store，按 `datasetKey::versionId` 索引）。
  - 浏览器：版本历史存 IDB（按数据集名建键）；提供 `downloadManifest` 下载 `dataset.dv.json` 做便携标识、`importManifestFile` 导入他人/历史标识文件。
- [x] **UI `VersionDialog.vue`**（顶部「版本」按钮，紧邻导出）：保存版本（标签输入）、版本列表（下载标识文件 / 删除）、选「基准 before」+「对比 after（当前工作区 / 某版本）」点「对比」展示迭代间差异（汇总徽标 + 类变化 chip + split 变化 + 总量 + 样本级表格，修改/删除/新增行可排序列）。

### 轻量标注编辑（清洗台，2026-07-15）
- 定位：把"查看器"变"清洗台"，对标 CVAT / Label Studio 轻量版（本地优先、开文件夹即用）；复杂度为中——canvas 绘制原语与坐标变换已就绪，新增交互控制器 + canonical 变更/脏标记/撤销 + 面板控件 + 写回。
- 设计：以 canonical 为唯一数据源，**直接改 canonical** 并 bump `annVersion` 绕过标注缓存（`getFileAnnotations`/`currentAnnotations` 重算），避免改 ParsedAnnotation 导致与导出/去重脱钩。
- 几何/交互：`src/canvas/canvasEdit.ts`（纯函数：fit 变换、8 手柄位置/命中、resize 重算）；`ImageViewer.vue` 交互状态机 `dragMode`(pan/move/resize/draw)——选中→拖拽移动、拖手柄→缩放、画框模式拖拽生成新 bbox；`pBBoxToC/cBBoxToP` 在 Parsed `[x,y,w,h]` 与 canonical `[cx,cy,w,h]` 间转换。
- 撤销/脏标记：`useViewerState` 内 `EditCommand{apply,revert}` 命令栈（`undo/redo`/`canUndo/canRedo`）、`dirtyFiles:Set` 标脏、`Delete` 键删选中标注。
- 持久化：`src/dataset/annotationIO.ts` 的 `buildSaveFiles`/`saveAnnotations`——YOLO/VOC/LabelMe 按文件写回，COCO 按 split 整 JSON 重写；Tauri 经新增 `write_text_file` Rust 命令落盘，浏览器打包脏文件 ZIP 下载。
- 面板控件：`SidebarPanel.vue` 标注面板新增工具条（选择/画框切换、新框类别下拉、撤销/重做、保存(脏文件数)）+ 每条标注的类别下拉（改类）与删除按钮。
- 范围：bbox 移动/缩放/删除/改类/补画已全；**画框支持 bbox 拖拽 + polygon 多点连击（双击/Enter 收尾、Esc 取消、虚线橡皮筋预览）**；polygon 同时支持整体平移。**OBB/keypoint/mask 的"新建"仍暂未做（仅移动/编辑已有），已固化为已知限制（外部标注工具负责造）**。

### 标注格式覆盖补全（OBB / 关键点 / mask，2026-07）⭐⭐⭐⭐⭐
- 目标：弥补主流工具短板，覆盖生产主流标注类型，端到端打通（模型 → 导入 → 渲染 → 导出 → 编辑 → 持久化写回）。
- **旋转框 OBB（DOTA / YOLO-OBB）**：`ParsedAnnotation.rotation`（弧度 CCW）；DOTA 8 角点像素导入按图尺寸归一化；`canvasDraw` 旋转框渲染；ImageViewer 旋转手柄拖拽；导出 YOLO-OBB（角度制）/ COCO / DOTA；`annotationIO` 写回。
- **关键点（COCO keypoints）**：`ParsedAnnotation.keypoint`（扁平 `[x,y,v,...]` + 骨架边 edges）；COCO keypoints 带 `num_keypoints` 渲染；ImageViewer 拖拽关键点；导出 YOLO pose（`5+3k`）/ COCO；写回。
- **分割掩码（COCO 实例分割 / RLE）**：`src/codec/rle.ts` RLE 解码 + `canvasDraw` 像素级绘制；导入（COCO segmentation：多边形或 RLE）/ 导出 + 写回。
- **视频帧数据集**：范式级重构（引入时序维度牵连整条数据管线），未启动，单独立项。

### 规模化算力与缓存层（2026-07-15）
- [x] **通用 WorkerPool**（`src/workers/workerPool.ts`，默认 4-8 并行）：哈希 / 质量各一池，替代单 Worker，万级图片并行计算
- [x] **IndexedDB 双层缓存**（`src/cache/idbCache.ts`）：hashes / quality 按 md5 内容寻址 + statIndex 按 `path::size` 实现「免读字节」命中；重跑 / 重开 / 跨路径同内容均复用，跨数据集 / 会话持久
- [x] **Worker 内批量写（2026-07-15）**：`putHash`/`putQuality` 改为缓冲累积，达 `HASH_FLUSH=128` 阈值单事务提交，并用 `setInterval(2000)` 低频定时器兜底确保残余缓冲落盘（缓冲空自动撤定时器，无空转）；万级文件事务数从上万降到百次级
- [x] **进度 UI 暴露缓存命中（2026-07-15）**：两引擎 `onProgress` 透出 `cacheHits`（主线程 statIndex 命中 + Worker 内容缓存命中两类）；去重进度卡 / 哈希计算对话框 / 质量检查对话框均展示「已命中缓存（跳过计算）：N 张」
- [x] 缓存可视化 + 清空（`getCacheStats` 三表计数与预估占用、`clearCache` 全清），接入设置面板

---

## 进行中功能 🚧

（无进行中项。最后落地的「规模化算力与缓存层」已转入已完成功能。）

- [x] 多窗口对照浏览（可变多窗格，上限 6）
- [x] canonical 管线 + split 权威识别
- [x] 标注文件同步（删图走真实 sourcePath 同步删标注）
- [x] 工具栏/导航栏紧凑化
- [x] Tauri 批量读字节（去重/导出/加载提速）
- [x] **质量检查功能**（引擎 + UI 全链路落地）
- [x] **规模化算力与缓存层**（WorkerPool + IndexedDB 双层缓存 + 批量写 + 进度 UI 缓存命中；详见已完成功能章节）

---

## 待开发功能 ❌

### 优先级：P0 已闭环 ⭐⭐⭐⭐⭐（数据清洗闭环 + 规模化，已全部落地）
- [x] **质量检查**（已落地全链路）：引擎（模糊/过暗/过亮/低分辨率/单色检测 + 0-100 评分 + 聚合统计）+ UI（菜单触发 + 文件行徽标 + 质量 tab + 阈值设置 + HTML 报告导出），对齐 `IQualityChecker` 接口预留。
- [x] **质量报告 PDF 版**（2026-07-15）：`report.ts` 新增 `printQualityReport`，经隐藏 iframe + `window.print()` 触发浏览器「另存为 PDF」，中文字体与内联样式正确渲染、零额外依赖；打印不可用时回退下载 HTML。StatsView 质量页加「导出 PDF 报告」按钮（原按钮改名「导出 HTML 报告」）；HTML 报告加 `print-color-adjust: exact` 保留配色。
- [x] **WebWorker 池（4-8 并行）+ IndexedDB 哈希缓存**（万级图片规模化必需；已落地：通用 `WorkerPool` + 双层内容寻址缓存 + 批量写 + 进度 UI 缓存命中，详见已完成功能章节）
- [x] **增量哈希计算 UI 化**（2026-07-15）：去重逻辑 `options.incremental` + `baseIndex` 早已有，但产出索引未自动复用。现 `startAnalysis` 运行成功后自动把本次 `index` 留存为 `baseIndex`（来源标记 'run'），下次运行可一键开「增量模式」无需手动导出/导入；并加「清空」按钮重置，提示区分「已导入索引 / 已留存上次运行索引」。

### 优先级：P0 基座 ⭐⭐⭐⭐⭐（开箱即用硬前提）
- [ ] **Tauri 客户端打包发布 + 安装包**：没有可分发的桌面二进制，对非技术/离线用户不叫"开箱即用"；当前完全缺失，须先于功能扩展推进。

### 优先级：P0 生产刚需 ⭐⭐⭐⭐⭐（格式覆盖补全，弥补主流工具短板）
- [x] **旋转框 OBB（DOTA / YOLO-OBB）**：✅ 已落地（2026-07）。`ParsedAnnotation.rotation` 端到端打通：DOTA 8 角点像素导入归一化 + `canvasDraw` 旋转框渲染 + ImageViewer 旋转手柄 + YOLO-OBB/COCO/DOTA 导出 + `annotationIO` 写回。
- [x] **关键点（COCO keypoints）**：✅ 已落地（2026-07）。`ParsedAnnotation.keypoint` 端到端打通：COCO keypoints 带骨架边渲染 + ImageViewer 拖拽关键点 + 导出（YOLO pose `5+3k` / COCO）+ 写回。
- [x] **分割掩码（mask，非 polygon）**：✅ 已落地（2026-07）。COCO 实例分割 RLE / polygon 解码（`src/codec/rle.ts`）+ `canvasDraw` 像素级绘制 + 导入/导出 + 写回。
- [ ] **视频帧数据集**：范式级重构（引入时序维度牵连整条数据管线），单独立项，未启动。

### 优先级：P1 差异化竞争力 ⭐⭐⭐⭐（已落地项）
- [x] **轻量标注编辑**（移动/删除框、改类别、补画框）——2026-07-15 落地，见「轻量标注编辑（清洗台）」小节。
- [x] **训练框架配置导出**：自动生成 YOLOv8 / MMDetection / Detectron2 工程配置 + class yaml（导出对话框「训练框架配置」模式，生成「数据 + 工程配置 + 类别文件」可直接训练 ZIP；YOLOv8→YOLO 数据+data.yaml+train.py，MMDetection/Detectron2→COCO 数据+各自配置+classes.txt，超参可调）。

### 优先级：P2 护城河 ⭐⭐⭐
- [x] **特征嵌入 + 相似检索 + t-SNE/UMAP**（比 pHash 更准的近重复/离群发现，数据策展核心）——✅ 已落地（2026-07-17 代码完成）：P2-1 检索核心（onnxruntime-web WASM 本地抽 EfficientNet-B0 特征 + IndexedDB 内容寻址缓存 + 暴力余弦 Top-K）、P2-3 降维可视化（PCA + UMAP，ECharts 散点）、P2-4 离群检测（kNN 余弦离群度 Top-20）；运行资产（模型/wasm）已就位，待浏览器「相似」页推理 E2E 验证。
- [x] **数据集版本 / 差异对比（迭代间 diff，2026-07-17）**：✅ 已落地。每个版本是一份轻量可 diff 清单 `dataset.dv.json`（`src/dataset/versioning.ts` 的 `buildManifest` / `diffManifests`）：记录类表 / split 计数 / 每类标注数 / 每样本 `{id, sourcePath, split, annCount, annHash}`；`annHash` 由归一化标注内容 + 类名 + split + 路径经 FNV-1a 算出（不读图字节），用于判定「该图标注是否被改」。存储后端 `src/dataset/versionStore.ts`：Tauri 端把最新版本写数据集根 `dataset.dv.json`（自标识文件，下次打开自动 detectMarker 识别）+ 全量历史存 IDB（`idbCache` v3 新增 `versions` store）；浏览器端历史存 IDB，支持「下载标识文件」做便携传递与「导入」他人/历史标识文件。UI `VersionDialog.vue`（顶部「版本」按钮）：保存版本、版本列表（下载/删除）、选「基准 before」与「对比 after（当前工作区 / 某版本）」做迭代间 diff，结果展示新增/删除/修改/类变化/split 变化/总量增减 + 样本级清单。
- [x] **通用导出报告 + 标注 CSV/JSON 导出（IExportService）**——✅ 已落地（2026-07-17）：统一报表模块 `src/report/reportHtml.ts`，质量/统计/相似/去重全部复用（见导出功能章节）；标注 CSV/JSON 导出经 `src/dataset/exportAnnotations.ts` 的 `exportAnnotations` 落地，导出对话框新增「标注 CSV/JSON」内容模式。

### 工作区结构配置持久化（Workspace，2026-07-17）
- [x] **WorkspaceConfig 模型（多数据集结构）**：`src/workspace/workspaceStore.ts` 定义 `WorkspaceConfig` = `datasets[]`（`WsDataset`：id/name/env/sourceFormat + Tauri 的 `imageRoot`/`labelRoot` 或浏览器的 `handleKey`）+ `panes[]`（paneId→datasetId）+ `activePane` + 视图（`viewMode`/`headerCollapsed`/各侧栏折叠/`syncByFilename`）+ `display`（5 项显示开关）；浏览器目录句柄以 `PersistedHandles`（`id` + `imageHandle`/`labelHandle`）单独存 `handles` 表（结构化克隆），config 仅存 `handleKey`。
- [x] **底层存储 `idbCache.ts` v4**：新增 `workspace`（单条 `id='current'` 存整份 config）+ `handles`（按 id 存目录句柄）两个 store，及 `saveWorkspaceConfig/loadWorkspaceConfig/clearWorkspaceConfig/saveHandles/loadHandles`；`clearCache` 一并清空。
- [x] **重建数据集 `loadCanonical.ts`**：导出 `reloadDatasetFromPaths`（Tauri 用绝对路径重扫目录，不弹选择框）、`reloadDatasetFromHandles`（浏览器用目录句柄重导入）、`peekLoadHandles`（捕获来源元信息）、`recordLoadHandles`（恢复后重建纠错回路信息）。
- [x] **useViewerState 集成**：每加载一个数据集经 `captureMeta` 记录 `DatasetMeta`（路径/句柄/格式，浏览器同步落盘句柄）；`buildWorkspaceConfig` 序列化当前状态；`saveWorkspaceNow`（手动/自动防抖 800ms 写盘）；`restoreWorkspace` 按 config 重建各数据集（Tauri 重扫 / 浏览器申请 `requestPermission` 后重导入）、维护旧 id→新 id 映射、重排数据集顺序、按索引重绑窗格（按需增删到 `MAX_PANES`）、还原视图与显示设置，失败数据集告警跳过；`clearWorkspace` 清配置与句柄；`autoRestore` 开关经 localStorage 持久化，`DatasetViewer` 挂载时若启用且当前无数据集则静默恢复。
- [x] **UI**：`ViewerHeader` 新增「工作区」图标下拉（保存/恢复/清除，busy 时禁用）；`SettingsPanel` 新增「工作区」区块（启动自动恢复开关 + 保存/恢复按钮）。
- [x] **多数据集结构配置持久化（工作区，2026-07-17）**：✅ 已落地。把「当前加载了哪些数据集、各自的来源结构（Tauri 绝对路径 / 浏览器目录句柄）、各窗格绑定、视图与显示设置」序列化为一份 `WorkspaceConfig` 存 IndexedDB（`idbCache` v4 新增 `workspace` 单条记录 + `handles` 表存浏览器目录句柄，结构化克隆可持久化 FileSystemDirectoryHandle），重启后可一键或自动恢复多数据集结构，无需重新逐个选目录。UI：`ViewerHeader` 新增「工作区」菜单（保存/恢复/清除）+ `SettingsPanel` 新增「工作区」区块（启动自动恢复开关、保存/恢复按钮）；`DatasetViewer` 挂载时按开关静默尝试自动恢复。

### 优先级：P3 可用性与分发 ⭐⭐
- [x] **主动学习钩子（导入模型输出，定位低置信/难样本，2026-07-18）**：✅ 已落地。新增 `src/activeLearning/`（`types.ts` 评分 `scorePredictions` = confMin/Mean/Max + hardScore=0.6*(1-confMean)+0.4*离群；`importPredictions.ts` 解析 COCO predictions / 信封 `{predictions:[]}` / 对象映射三形态，bbox_format 归一化 + 类名对齐 dataset.classes；`useActiveLearning.ts` 模块级单例，预测作为「覆盖层」独立存储绝不回写真值，仅会话内有效不写盘）。UI `ActiveLearningView.vue`（选数据集 / 导入模型 JSON / 双阈值滑块 / 结合嵌入离群 / 命中列表 / 导出待标注队列 JSON+CSV）；`viewMode` 加 `'active'` 平级视图，ViewerHeader 加「主动学习」radio。预测覆盖层可经 `src/activeLearning/render.ts` 叠加渲染到 ImageViewer 画布（品红虚线「P:」前缀区分真值，SettingsPanel「显示预测框」开关控制）。`vue-tsc --noEmit` 0 错误。
- [x] **增强预览（可视化 augmentation 对某样本的影响，2026-07-18）**：✅ 已落地。新增 `src/augment/transforms.ts`（仿射矩阵同时作用于图像像素与归一化标注，保证框/点/多边形严格对齐）+ `decode.ts`（按环境解码 ImageFile）+ `AugmentCard.vue`（单卡绘制）+ `AugmentPreview.vue`（模态框：几何/颜色分组开关 + 参数滑杆 + 原图对照网格）。支持 12 种增强：水平/垂直翻转、顺/逆时针 90°、随机旋转、随机裁剪、亮度、对比度、色相、饱和度、高斯模糊、加噪；纯前端预览、非破坏式、不写回数据集。`PaneView` 工具栏新增「增强预览」按钮。`vue-tsc --noEmit` 0 错误。
- [x] **拖拽上传文件夹（仅浏览器端）、操作历史与撤销、多语言（i18n）（2026-07-18，拖放 2026-07-20 收窄）**：✅ 已落地。
  - **拖拽上传（仅浏览器端）**：`src/composables/useFolderDrop.ts` 走 HTML5 拖放 + `DataTransferItem.getAsFileSystemHandle()` 取目录句柄，落点统一成 `LoadOptions` 复用 `handleLoadDataset({imageHandle})`（免弹框），`DatasetViewer` 显示拖放高亮覆盖层。**注意（2026-07-20）：Tauri 客户端拖放加载已移除**——WebView2 在 HTML5 模式剥离 `File.path`（拿不到真实绝对路径），原生 `onDragDropEvent`（`dragDropEnabled:true`）虽能给真实路径但 Windows 拖拽过程显示禁止光标(叉叉)且体验差，两条路都不可接受。客户端端 `useFolderDrop` 现仅对外部文件拖放做 `preventDefault` 无害化（防页面误跳转），**不加载、不显示高亮**；客户端加载统一走标题栏「选择文件夹」按钮（`pickDirectoryTauri`）。详见 `API_CONTRACT.md` §11、`PROJECT_ARCHITECTURE.md` §19。
  - **操作历史与撤销**：撤销/重做基础设施本已存在（`EditCommand`/`undoStack`/`redoStack`/`undo`/`redo`，SidebarPanel 清洗台已有按钮）；本次补齐 **Ctrl+Z 撤销 / Ctrl+Y·Ctrl+Shift+Z 重做**快捷键（`handleKeydown`），并新增 `undoLabels`/`redoLabels` 暴露，SidebarPanel 加「操作历史」弹层（时间线：将来/当前/过去，最近操作高亮）。
  - **多语言 i18n**：新增依赖 `vue-i18n@11` + `src/i18n/`（`index.ts` 实例/持久化/ElementPlus locale 同步 + `locales/zh-CN.ts`·`en-US.ts` 消息目录）；`main.ts` 注入，`App.vue` 用 `<el-config-provider :locale>` 包裹并加语言切换下拉。已翻译主界面 chrome：导航/ViewerHeader（视图模式+加载+更多+工作区菜单）/DatasetViewer（空状态+拖放层+底部栏）/SidebarPanel（文件列表+筛选+排序+清洗台工具条）/PaneView 增强预览按钮；并已完成深层子对话框增量迁移：导出 / 统计 / 相似 / 去重 / 主动学习 五个子对话框 + `useStatsReports` 报告构建，统一 `useI18n()` + `t()` 模式（注意 `el-switch` 的 `active-text` 须绑定 `:active-text`）。
  - **启动动画（splash）（2026-07-20）**：消除 bundle 加载期白屏。在 `index.html` 内联静态 `#splash` 层（白底 + `/branding/about-hero.png` 全屏 `object-fit:contain` 慢拉近淡入 + 底部 spinner/品牌名/流光进度条），不依赖 JS 即可显示；`src/main.ts` 在 `app.mount('#app')` 后 `requestAnimationFrame + 600ms` 最短展示再淡出移除；`tauri.conf.json` 窗口 `backgroundColor` 改 `#ffffff` 消除原生窗口绘制前蓝闪。hero 为 2:1 横幅，`contain` 保证小窗不裁切左右。
  - `vue-tsc --noEmit` 0 错误，lint 0 报错。

---

## 已知问题 / 已解决问题 🐛

1. **缩略图主线程开销** — ✅ 已移除（2026-07-10）：整体下线，改 `parseImageSize` 零解码。
2. **加载期整图解码** — ✅ 已修复（2026-07-10）：`loadCanonical` 不再 `new Image()` 解码。
3. **左右窗格折叠互相同步** — ✅ 已修复：每窗格独立 `filePanelCollapsed`/`annotationPanelCollapsed`。
4. **对照底部只能切一个窗口** — ✅ 已修复：每窗格独立上下张 + 同步切换。
5. **统计页只显示单一/总和** — ✅ 已修复：对比模式 + 各数据集独立图表。
6. **标注统计为 0** — ✅ 已修复（2026-07-09）：`getFileAnnotations` 改 canonical 权威。
7. **Tauri 逐图 IPC 读字节慢** — ✅ 已修复（2026-07-11）：`read_files_bytes` 批量 base64。
8. **数据集结构识别边缘情况** — ✅ 路径推断加固（2026-07-21）：split 关键字补全年份后缀/变体，类别推断改为从文件名向上回溯并跳过 images/labels/data 等通用容器目录，混合/缺 yaml 目录的边缘误判已大幅缓解；手动指定 split 的 UI 兜底留作后续独立项。
9. **规模化性能瓶颈** — ✅ 已大幅缓解（2026-07-15）：WorkerPool 4-8 并行 + IndexedDB 双层缓存 + Worker 批量写，万级图片事务数从上万降到百次级。残余低优先项：LRU 淘汰（#3）/ 去重+质量解码一次（#4）/ 游标遍历（#5，随 #3），详见「后续优化候选」。
10. **仅查看、不可编辑标注** — ✅ 已修复（2026-07-15，polygon 绘制 2026-07-21 补全）：轻量标注编辑（清洗台）落地，支持 bbox 移动/缩放/删除/改类/补画、polygon 移动 + **新建**（多点连击 + 橡皮筋 + 双击/Enter 收尾 + Esc 取消 + 右键撤上一点）。OBB/keypoint/mask 新建仍仅能移动，固化为已知限制。
11. **客户端（Tauri）拖放加载已移除（2026-07-20）** — ⚠️ 已知限制/主动决策：WebView2 在 HTML5 模式（`dragDropEnabled:false`）剥离 `File.path` 拿不到真实绝对路径；原生 `onDragDropEvent`（`dragDropEnabled:true`）虽能给真实路径但 Windows 拖拽过程显示禁止光标(叉叉)且体验差，两条路都不可接受。客户端现统一走标题栏「选择文件夹」按钮（`pickDirectoryTauri`）加载，拖放加载仅浏览器端可用。`useFolderDrop` 客户端分支只做 `preventDefault` 无害化。**未来若重做客户端拖放**：唯一干净方案是「透明浮层窗口」——主窗口 `dragDropEnabled:false`（HTML5 无光标）+ 另建 `transparent/alwaysOnTop/decorations:false` 且 `dragDropEnabled:true` 的覆盖 WebviewWindow 捕获 `onDragDropEvent` 取路径（改动大、需第二个 webview 入口 + 位置同步 + IPC，且本环境无法实测，暂未实现）。

---

## 后续开发方向评估（基于真实生产需求 + 市面工具短板）

### 一、市面工具格局与短板

| 工具 | 类型 | 优势 | 短板（我们的机会） |
|------|------|------|-------------------|
| **FiftyOne**（Voxel51） | 开源 Python 库 + Web App | 数据集策展/可视化/质量/嵌入/相似极强 | 需 Python/conda 环境；非原生桌面；上手门槛高；不擅长"开文件夹即看" |
| **Roboflow** | 商业云 | 格式转换/增强/托管一站式 | 须上传云端（隐私/合规风险）；大库付费；离线/内网不可用 |
| **CVAT / Label Studio** | 标注平台 | 标注能力强、协作 | 重、服务端部署；偏向"造数据"而非"管/洗已有数据"；浏览体验弱 |
| **LabelImg / VoTT / makesense** | 轻量标注 | 简单 | 已停更/仅标注；无统计/去重/质量/转换 |
| **cleanlab / Deepchecks** | ML 数据质量 | 标签/数据质量检测学术强 | 非 CV 数据集可视化浏览；无桌面 UX |
| **W&B Tables / Ultralytics HUB** | 实验追踪 | 与训练闭环 | 非独立数据集管理；绑定各自生态 |

**核心洞察**：市面要么"重服务端/云端"（隐私与离线受限、部署重），要么"只标注不管理"，要么"强但需要 Python 环境"。**「本地优先、开文件夹即用、浏览+清洗+转换+质量一体化」的轻量原生桌面工具是明显空白**——这正是本项目的定位。

### 二、真实生产中的数据痛点（决定优先级）

1. **训练前数据清洗闭环**：重复图、跨子集泄漏、模糊/过暗/极小图、错标漏标——直接决定模型上限。当前我们有去重+泄漏，缺质量检查。
2. **格式混乱与跨框架互通**：数据来自手机/无人机/相机/外包，格式五花八门；需稳健自动识别 + 一键转 YOLO/COCO/VOC + 生成训练配置。
3. **train/val/test 不泄漏 + 长尾重平衡**：指标是否可信的前提；已有 rebalance，但类别级不均衡洞察不足。
4. **规模化**：工业数据集常十万~百万级 → 已落地 Worker 池 + IndexedDB 缓存 + 批量写，万级图片无碍；百万级待实测。
5. **可解释报告**：给干系人/甲方交付质量报告（PDF/HTML）。
6. **迭代可追溯**：多版本数据集 diff、复现（种子/锁 test）。

### 三、方向建议（按 ROI 排序）

**P0-A 基座 — 开箱即用分发（最高优先，先于功能扩展）**
- Tauri 客户端打包发布 + 安装包：没有可分发的桌面二进制，对非技术/离线用户不叫"开箱即用"。这是"开箱即用生产刚需工具"的硬前提，当前完全缺失。

**P0-B 生产刚需 — 格式覆盖补全（弥补主流工具短板的主菜）**
- 旋转框 OBB（DOTA/无人机遥感）+ 关键点（COCO 姿态）——`ParsedAnnotation` 已预留 `rotation`/`keypoint`，纯几何扩展，ROI 最高，先行。
- 分割掩码（COCO 实例分割/RLE）——需像素级绘制工具，复杂度更高，次之。视频帧——范式级重构，单独立项。

**P1 — 差异化竞争力（已落地）**
- 轻量标注编辑（移框/删框/改类/补画）：✅ 已落地（2026-07-15），对标 CVAT 轻量场景，让用户"看到问题顺手修"。
- 训练框架配置一键导出（YOLOv8/MMDet/Detectron2）：✅ 已落地（2026-07-15），从"转出格式"到"直接可训"闭环。
- 质量检查 + 规模化算力：✅ 已落地（2026-07-15），本地优先"一键清洗报告"是 FiftyOne/云工具未以"开文件夹即用"方式提供的。

**P2 — 数据策展智能化（护城河）**
- 特征嵌入 + 相似检索 + t-SNE/UMAP：比 pHash 更准的近重复/离群发现，FiftyOne 核心能力，本地优先补齐。
- 主动学习钩子（导入模型输出定位难样本）：✅ 已落地（2026-07-18，见 P3 章节）；数据集版本/diff ✅ 已落地（2026-07-17，见版本/diff 章节）。

**P3 — 可用性与分发**
- i18n（中/英）、增强预览、拖拽上传、操作历史与撤销：✅ 均已落地（2026-07-18）。文档与 onboarding 持续完善中。

### 四、结论
当前已完成"加载识别 → 浏览对照 → 去重泄漏 → 统计可视化 → 导出转换 → 质量检查 → 轻量编辑（含 OBB / 关键点 / mask 全格式覆盖）→ 规模化算力 → 数据策展（相似/降维/离群）→ 主动学习 → 版本 diff → 增强预览 → 拖拽上传 / 操作历史 / i18n → Tauri 二进制分发(P0-A)"主干闭环，具备本地优先 / 双端 / 零解码性能优势。**P0-A 已于 2026-07-17 二进制编译成功（MSI/NSIS 经 Releases 分发）；P0-B 已于 2026-07 端到端落地；P2 数据策展护城河已于 2026-07-17 代码落地并于 2026-07-20 经用户真实数据 E2E 实测验证（特征检索 / 降维 / 离群检测全链路可用，仅 App 端 wasm CPU 推理偏慢）；P3 可用性（主动学习 / 增强预览 / 拖拽上传 / 操作历史与撤销 / 多语言 i18n）已于 2026-07-18 全部落地**。自动标注（路线 B）已于 2026-07-20 决定不再做（外部 X-AnyLabeling 等工具已覆盖）。视频帧属范式重构，单独立项。守住"本地优先的数据集管理与清洗"定位，避免重蹈 CVAT 重服务端标注平台的覆辙。

> **发布决策（2026-07-16）**：项目主干已完成，计划以**二进制试用版**形式分发——GitHub Releases 挂载安装包，仓库不含源码，先试水 adoption，有人用再决定是否开源。
> **P0-A 完成（2026-07-17）**：二进制编译成功，唯一硬缺口已闭环。

---

## 下一步计划

1. ~~P0-A Tauri 客户端打包发布 + 安装包~~：✅ 已完成（2026-07-17 二进制编译成功）。`tauri.conf.json` 的 `bundle.targets:"all"` + `webviewInstaller:true`；MSI / NSIS 安装包经 GitHub Releases 分发（仓库不含源码，二进制试用版）。
2. ~~P0-B 格式覆盖补全（OBB + 关键点 + mask）~~：✅ 已落地（2026-07，端到端全链路）。视频帧单独立项（范式重构，未启动）。
3. ~~轻量标注编辑~~ / ~~框架配置导出~~ / ~~增量哈希计算 UI 化~~ / ~~质量报告 PDF 版~~：✅ 均已落地（2026-07-15）。
4. **缓存层后续优化候选（低优先）**：#3 LRU 容量上限、#4 去重+质量合并单遍解码、#5 游标遍历（随 #3）；均非瓶颈，按需再做。
5. **P2 数据策展护城河（✅ 已落地 + 2026-07-20 用户 E2E 实测验证）**：特征嵌入 + 相似检索 + t-SNE/UMAP（对标 FiftyOne 本地化）。用户已用真实数据跑通全链路（除 App 端 wasm CPU 推理偏慢外均正常；浏览器端因 WebGPU 更快）。`vue-tsc` 0 错误。
   - **P2-1 检索核心（✅ 代码完成，资产已就位，待浏览器 E2E）**：`onnxruntime-web`(WASM) 本地抽取 EfficientNet-B0 特征 → IndexedDB 内容寻址缓存（复用 idbCache，DB v2 新增 `embeddings` store）→ `WorkerPool` 并行 → 选中图暴力余弦 Top-K 相似。`SimilarityView`「相似检索」标签已接入；`vue-tsc --noEmit` 0 错误。
   - **P2-3 降维可视化（✅ 完成）**：`reduce.ts` —— PCA（幂迭代求前 2 主成分，纯算法离线可用）+ UMAP（`umap-js` 纯 JS）。`SimilarityView`「降维 & 离群」标签以 ECharts 散点呈现，点击散点联动预览。
   - **P2-4 离群检测（✅ 完成）**：`outlier.ts` 基于 kNN 余弦离群度（点到第 k 近邻的余弦距离，越大越孤立），取前 5% 标红，侧栏列 Top-20。与降维共用同一散点。
   - **运行资产（✅ 2026-07-17 已就位，不进仓库）**：① 模型 `public/models/efficientnet-b0.onnx`（16MB，特征提取变体，输出 **1280 维**）—— 用本机 `pytorch_env`(torch/torchvision) 经 `scripts/export-efficientnet.py` 导出，并 `onnx` 校验 IO：`input[1,3,224,224]` → `features[1,1280]`，与 `embedModel.ts` 契约一致；`pnpm export-model` 可重导。② onnxruntime-web 的 wasm 后端经 Vite `?url` 导入由打包工具作为静态资源提供（`embedModel.ts` 设 `ort.env.wasm.wasmPaths = { mjs, wasm }`），**无需手动复制任何文件、无需 public/onnx**（`copy-onnx-wasm` 脚本已废弃为说明）。`vite build` 已验证产出 `ort-wasm-simd-threaded.jsep.*.mjs/.wasm` 与 `embed.worker`。两者均 gitignore（用户持有 / 从依赖生成）。待浏览器「相似」页「计算特征」做推理 E2E（构建已验证资源可产出，实跑需用户在浏览器触发）。
   - **P2-2 ANN 索引（✅ 已落地，2026-07-18；2026-07-18 迁 Worker）**：用 hnswlib-wasm 的 HNSW 图索引替换暴力余弦，支撑百万级特征检索。为消除上帝组件，重活（addItems ≈ O(N log N)）已迁至独立 `src/embed/ann.worker.ts`：Worker 持有 HNSW 内存索引（仅内存不落盘、按 version 失效重建），主线程经 `src/embed/annClient.ts` 单例客户端发 `build`/`search`/`reset`（reqId 映射 + onerror 兜底）；`annIndex.ts` 精简为共享类型 `AnnEntry`/`AnnHit` + 常量。`useEmbeddings.findSimilar` 退为协调者：小数据集（<=5000）主线程暴力精确、大数据集走 Worker ANN（查询 O(log N)）、构建/检索异常 `annBroken` 回退暴力（不阻塞功能）；`SimilarityView` 增加 ANN/暴力模式标签。`hnswlib-wasm@0.8.2`，wasm 以 base64 内联进 JS、由 Vite 打包为 `ann.worker` 懒加载 chunk（ES Worker 格式，vite.config 已配 `worker.format:'es'`）。三道门禁全绿。
6. **导航重组 + 统一报表模块（✅ 已完成，2026-07-17）**：去重从顶层独立 Tab 并入浏览工作台 `viewMode` 平级（预览/统计/相似/去重，共享已加载数据集）；导出报表彻底统一为单一模块 `src/report/reportHtml.ts`，质量/统计/相似/去重全部复用（详见导出功能与统计页章节）。`vue-tsc --noEmit` 0 错误、lint 0。
7. **P3 可用性套件（✅ 已完成，2026-07-18）**：主动学习钩子（`src/activeLearning/`）、增强预览（`src/augment/`）、拖拽上传文件夹（`src/composables/useFolderDrop.ts` 双端）、操作历史与撤销快捷键（`useViewerState` 补 Ctrl+Z/Y + `undoLabels`/`redoLabels` 弹层）、多语言 i18n（`src/i18n/` + vue-i18n@11，中/英，`el-config-provider` 同步 ElementPlus locale）。`vue-tsc --noEmit` 0 错误、lint 0。i18n 深层子对话框迁移已全部完成（导出 / 主动学习 / 统计 / 相似 / 去重 五个子对话框 + `useStatsReports` 报告构建，均过三道门禁）。

---

## 待启动路线图（评估后新增，2026-07-18；2026-07-20 范围收敛）

**评估结论（2026-07-20 收敛）**：完成度已达约 98%，核心「加载识别 → 浏览对照 → 去重泄漏 → 统计 → 导出转换 → 质量 → 轻量编辑（全格式覆盖）→ 规模化 → 数据策展（相似/降维/离群）→ 主动学习 → 版本 diff → 增强预览/导出 → i18n → Tauri 二进制」主干闭环已落地。**自动标注（路线 B）经评估决定不再做**——X-AnyLabeling 等成熟开源工具已覆盖该场景，且非本项目「本地优先的数据集管理与清洗」核心定位（见下文 B）。视频帧单列、LRU 三项已评估跳过。项目进入收尾期，剩余为少量体验打磨与已知限制固化，不再新增大功能。

### A. 增强导出（最高 ROI，契合「清洗/增强」卖点）✅ 已落地（2026-07-18）
- 原 `src/augment/` 仅预览（`applyAugmentation` 标注「纯函数、非破坏式」），`ExportDialog` 无增强模式——看了效果却生成不了增强数据集；现已打通。
- 实现：`transforms.ts` 通用化 `applyAugmentation` 接受 canvas，新增 `AugStep` + `applyAugmentationChain`（单一仿射链式组合，像素与标注同步变换，框/点/多边形严格对齐）；新增 `src/augment/export.ts`：每张原图按策略生成 N 份变体（顺序应用 / 随机子集+随机参数），canvas 落盘为图片字节，变换后的 `ParsedAnnotation` 经 `parsedToCanonical` 转回规范标注（bbox/OBB 拟合/多边形/关键点/mask 全类型），与原图合并后复用 `annotationIO.buildSaveFiles` 序列化（YOLO/COCO/VOC/DOTA/LabelMe 全格式），按 `images/` + `labels/` 布局输出（Tauri 写所选目录 / 浏览器打包 ZIP）。`ExportDialog` 新增「增强数据集」模式（输出格式 / 图片格式 / 每图份数 / 策略 / 12 种增强项参数 / 追加原图开关）。`vue-tsc --noEmit` EXIT:0、lint 0。
- 直接复用 canonical + `annotationIO` 写回；是 Roboflow 付费核心，且本项目已具备全部前置，**性价比最高**。

### B. 本地自动标注（auto-labeling）⬜ — **2026-07-20 决定：不再做（WON'T DO）**
- **决策依据**：X-AnyLabeling（CVHub520，v4.0.0，本地 ONNX Runtime/TensorRT 后端，50+ 模型，全自动批量 + SAM/Grounding 交互式）等成熟开源工具已**完整覆盖自动标注场景**，且生态成熟、迭代活跃。本项目定位为「本地优先的数据集管理与清洗」，**主动学习（导入模型输出定位难样本）已提供"哪里该人工看"的闭环，真正落笔标注交给用户或外部标注工具更合理**。
- **性能事实（仍成立，但与决策无关）**：浏览器侧 onnxruntime-web 默认 `wasmThreads: 1`（单线程，规避 SAB/COOP-COEP），即便优先 WebGPU 也受 Tauri WebView2 `navigator.gpu` 支持参差与沙箱限制；原生推理需走 Rust `ort`/sidecar，改动大。
- **结论**：自动标注**移出本项目路线图**。如未来有强需求，可单独立项（原生后端路线），不阻塞当前收尾。

### C. 主动学习预测持久化 [x]
- 已完成：预测覆盖层跨会话持久化。`src/activeLearning/persistence.ts` 照 `versionStore` 的「`.dv` 侧车 + IDB 双端」模式——Tauri 落盘数据集根 `.dv/al_predictions.json`，浏览器存 IndexedDB（`idbCache.STORE_AL`）。`useActiveLearning` 新增 `reviewStatus`(复核状态) + `persist/loadPersisted/clearPersisted`；`ActiveLearningView` 挂载/切换数据集自动恢复、导入/清除/改状态/导出后写盘，导出难样本队列时 `markExported` 回写「已导出」状态。三重门禁通过。

### D. 收尾类（低优先）[~]
- i18n 深层子对话框迁移（✅ 已完成）：导出 / 主动学习 / 统计 / 相似 / 去重 五个子对话框 + `useStatsReports` 报告构建，均通过三重门禁（vue-tsc / lint / vite build）。
- P2-2 百万级 ANN 索引（hnswlib-wasm）——✅ 已落地（2026-07-18）。
- 嵌入 / AL 已于 2026-07-20 经用户真实数据 E2E 实测验证（除 App 端 wasm CPU 推理偏慢外均正常），非功能缺口。

### 视频帧数据集 ⬜
- 范式级重构（引入时序维度牵连整条数据管线），单独立项，未启动，不计入当前完成度。

> 完成度维持约 98%：A 增强导出已于 2026-07-18 落地；**B 自动标注已于 2026-07-20 决定不再做（外部工具已覆盖）**；C 主动学习预测持久化已落地；D 收尾类均已落地。视频帧单列。项目进入收尾期，剩余为少量体验打磨 + 已知限制固化。

## 后续优化候选（低优先，已评估）

基于 2026-07-15 评估，以下三项 ROI 有限，暂不实施：

- **#3 LRU 淘汰**：缓存按 md5 内容寻址、跨会话复用，无限增长反而有益（10 万图 ≈ 70MB，远低于浏览器配额）。仅当用户反复处理大量不同数据集或配额告警才需做；可做「软上限安全网」，或等报告配额错误再做。
- **#4 去重 + 质量各解码一次**：仅当同会话先后跑去重+质量才有收益；解码在 Worker 线程、已被批处理摊薄、不阻塞主线程。需合并两独立 Worker 管线（采样尺度不同），重构成本高，待 profiling 显示解码为瓶颈再做。
- **#5 游标遍历**：现状无 `getAll`（批量查为单事务逐条 `get()`，`getCacheStats` 用 `count()`），无独立价值；仅作为 #3 prune 的内部手段，随 #3 一并考虑。

---

## 收尾优化候选（2026-07-20，核心闭环打磨，非新功能）

进入收尾期，以下为**围绕核心「管理 + 清洗」体验**的少量打磨项，按 ROI 排序；均非阻塞，可择 1–2 项即收尾：

1. **清洗台多边形绘制补全（唯一功能性落差）✅ 已完成（2026-07-21）**：bbox 拖拽 + polygon 多点连击（双击/Enter 收尾、Esc 取消、虚线橡皮筋预览）均已落地，经 `vue-tsc` 类型门禁验证。其余 OBB/keypoint/mask 新建固化为已知限制（外部标注工具负责造）。
2. **混合目录结构识别兜底（已知问题 #8）✅ 路径推断加固已完成（2026-07-21）**：`splitDetect.ts` 对非标准/混合目录（图片与标注混层、缺 data.yaml）的边缘误判已加固——split 关键字补全年份后缀与变体（`train2017`/`valset` 等），类别推断改为「从文件名向上回溯、跳过 images/labels/data 等通用容器目录」。**手动指定 split 的 UI 兜底**属新增功能，与「收尾期不加新功能」原则冲突，留作后续独立项，本文档记为已知限制。
3. **收尾体验打磨（典型 release 前项）✅ 已完成（2026-07-21）**：首次启动 onboarding / 空状态引导卡片（功能亮点 + 加载按钮，i18n `viewer.emptyTitle/emptyFeature1-3`）；README 校正已失效的 Polygon 限制说明并补充绘制能力；版本号收口 `package.json` 与 `tauri.conf.json` 统一为 `1.0.0`。
   - **坏图/大图崩溃兜底（错误边界）✅ 已完成（2026-07-21）**：`ImageViewer` 坏图加载优雅降级（不再未捕获 Promise 拒绝 + 空白，改为显示降级提示）；`renderImage` 绘制包裹 try/catch（坏标注/坏图不再沿事件/rAF 抛出拖垮整批）；新增 `ErrorBoundary.vue` 包裹每窗格图像区（单窗格渲染异常隔离、不白屏整页，切换文件自动恢复）；对应 i18n `imageViewer.loadError/renderError`、`errorBoundary.title/retry`。
4. **双端一致性收尾（已决策项固化）✅/⬜**：客户端拖放已移除并文档化（已知限制 #11）；App 端推理慢（wasm CPU）已接受为已知，迁移原生后端属路线 B（已决定不做）。

> 收尾原则：**不加新功能**，只补上述 1–3 项中的体验/健壮性小洞，并将其余（自动标注、视频帧、LRU 三项）明确标记为「已知限制 / 不计划」，固化到本文档即视为收尾完成。

---

## 当前版本

- **版本**：v1.0.0（`package.json` 为准；Tauri 二进制 `tauri.conf.json` 同步为 1.0.0）
- **完成度（相对本项目计划）**：约 98%（主干闭环已落地；质量检查全链路完成；规模化算力 WorkerPool + IndexedDB 缓存已落地；轻量标注编辑（清洗台）已落地；P3 可用性套件（主动学习/增强预览/拖拽上传/操作历史/i18n）已落地；LRU 等低优先项待做）。
- **完成度（相对"开箱即用生产刚需工具"北极星）**：约 97%——主干「能看能洗能转能统计」已闭环，生产级格式覆盖（OBB/关键点/mask）已于 2026-07 落地，Tauri 二进制分发（P0-A）已于 2026-07-17 编译成功；P2 数据策展护城河（特征嵌入+相似检索 P2-1、降维可视化 P2-3、离群检测 P2-4）代码已落地并通过类型检查，仅差用户持有的模型/wasm 资产运行验证；P3 可用性套件已于 2026-07-18 全部落地；百万级 ANN 索引（P2-2）已于 2026-07-18 落地（hnswlib-wasm HNSW，暴力回退保底）。
- **技术栈**：Vue 3 + Vite + Element Plus + Tauri 2 + TypeScript + ECharts + vue-i18n + onnxruntime-web
