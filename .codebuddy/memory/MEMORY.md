# 项目长期记忆（dataset-manager / DV-DatasetManager）

> 编辑工具正常可用，直接用 replace_in_file。仅用 pnpm（禁 npm）。

## 工具链与验证
- 只用 pnpm。验证：`pnpm dev`（esbuild 无类型检查）/ `pnpm exec vue-tsc --noEmit`（类型门禁）/ `pnpm exec vite build`。无独立 eslint 脚本（仅 unplugin-auto-import 生成的 `.eslintrc-auto-import.json`）。
- 死代码直接删；`.vue` 改后 `components.d.ts` 自动再生。源文件编码问题用 Python，禁止把工具参数写进源文件。

## 高频坑（必记）
- 勿把 Vue reactive Proxy 直接 postMessage 给 Worker（DataCloneError）；传参前 {...}/toRaw/JSON 拷贝。
- 长挂弹窗的异步状态（running）复位放 try/finally；Worker 失败只触发 onerror，主线程须监听 onerror/onmessageerror 并 reject 在途。
- Tauri v2 双端判定：`env = ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) ? 'tauri':'browser'`；invoke 来自 `@tauri-apps/api/core`；分支生效以 `tauri dev` + `debug/browser.log` 的 `[env-detect] tauri` 为准（vue-tsc 通过≠运行时生效）。
- 本环境 read_file 不支持图片，改图只能程序化（pngjs 抠背景）。

## Tauri v2 命令 / 能力清单（必记）
- 本机这套 Tauri v2：**自定义 `#[tauri::command]` 默认放行，无需在 capabilities 加 `allow-*`**；`write_binary_file`/`write_text_file` 未列却照常工作。
- 往 capabilities 加 `allow-<命令名>` 会让 build 解析失败（报错 "Permission allow-xxx not found"）。新增命令只需在 `lib.rs` 的 `generate_handler!` 注册；保持 capabilities 三项（core:default/opener:default/dialog:default）不动。

## Canonical 数据管线
- 中间模型归一化承载 bbox/obb/keypoints/mask/segmentation。坐标：bbox/obb=[cx,cy,w,h](0~1)；obb 加 rotation(弧度,CCW)；keypoints=扁平 [x,y,v,...]+edges；mask 可带 rle+iscrowd。
- 关键文件：dataset/types.ts、classRegistry.ts、dataYaml.ts、importers/（auto-id 于 index.ts）、**parsers/**（annotationParser 逻辑，与 importers 对称）、exporters/（yolo/coco/voc/dota + exportBrowser.ts）、**exportCore.ts**（packZip/writeFilesBatchTauri/addToZip/isImagePath/downloadZip 三路径共用）、annotationIO.ts（编辑写回）。
- ImageFile.path=真实相对路径；canonical 是标注权威来源（getFileAnnotations 优先），编辑直接改 canonical + bump annVersion。格式优先级 coco>voc>labelme>dota>yolo>folder；DOTA：images/<n>.png + labelTxt/<n>.txt（8角点像素→归一化 obb）。

## 模块架构
- DatasetViewer.vue 编排；共享状态→useViewerState（模块级单例，panes:shallowRef<PaneState[]>，MAX_PANES=6）。已按簇拆子 composable（`src/composables/viewer/`：useUrlCache/useAnnotations/usePanes/useCompute/useLoading/useWorkspace/useView/types），主文件 `src/composables/useViewerState.ts` 仅组合+展开返回，13 个 .vue 消费者零改动。
- canvas 绘制 canvasDraw.ts（无响应式）+ 几何 canvasEdit.ts；ImageViewer.vue 拆为 `src/components/canvas/`：useCanvasRender / useCanvasInteraction / geometry。样式抽全局 less（style.less 于 dark.less 前 @import）。

## ImageViewer / canvas API 契约（必记）
- `editingMode` 是 `'select'|'draw'`（非 'edit'）；'select'=可编辑/选中，'draw'=绘制。
- `store.commitCoordsEdit(file, idx, prev, next)` / `commitRotationEdit(...)` 需 prev/next 四参；`addBBoxAnnotation(file, bbox, classId)` 需 classId 三参（用 `store.editClassId.value`）。
- `ParsedAnnotation.type` 是 `'keypoint'`（非 'keypoints'），无 `'segmentation'`（`mask`/`polygon` 代替）。
- `drawAnnotation(ctx, ann, fitX, fitY, scaleX, scaleY, isSelected, imgW, imgH, zoom, prediction?, overrideColor?)` 需 imgW/imgH；`drawHandles(ctx, handles: Record<HandleId,{x,y}>, zoom)` 收 Record；`drawCheckerboard(ctx,x,y,w,h)` 5 参；`obbCornerHandles` 返回 `{id,x,y}[]`（喂 hitHandle 前转 Record）；`computeFit` 返回 `ImageFit` 含 cw/ch/scaleX/scaleY（无 scale/zoom）。
- `src/components/canvas/geometry.ts` / `activeLearning/` / `components/canvas/` 下新建文件曾多次因写入异常变**空文件**→写后务必确认非 0 字节。

## 主动学习预测持久化（跨会话 AL）
- `src/activeLearning/persistence.ts` 照 versionStore「`.dv` 侧车 + IDB 双端」：`AL_SCHEMA_VERSION=1`，Tauri 落盘 `.dv/al_predictions.json`（无 remove_file→clear 用空快照覆盖），浏览器仅 IDB（`idbCache.STORE_AL`, key=`datasetKeyOf(ds)`）。
- `ReviewStatus='pending'|'reviewed'|'accepted'|'rejected'|'labeled'|'exported'`；导出难样本队列时 `markExported` 回写 `exported`。
- 恢复：`ActiveLearningView` onMounted + watch(selectedDsId) 调 `loadPersisted`；导入/清除/改状态/导出后 `persist(dataset)`。`dedup/report.downloadJSON` 签名 `(filename, data)`。

## 质量检查 / 去重
- quality/：Worker 化，降采样≤128px；阈值 maxEdge128/blur80/dark<40/bright>220/minRes32/monoSat<8；单例 useQuality + WorkerPool + IDB 双层缓存（md5 寻址）。
- dedup/：三档强度、split 不交叉、泄漏检测；fileOps.getFileBytesBatch（Tauri 批量 base64 读字节，块 32）；缩略图已移除，parseImageSize(buf) 零解码取尺寸。

## 品牌
- DV-DatasetManager（DataVision）。主色蓝 #409EFF→渐变 #4D9BFF→#2D6FE6。Logo logo-mark-square.png，桌面/Web 图标同源。OBB/keypoints/mask 全链路已打通（types→导入→渲染 canvasDraw 含 RLE 解码 src/codec/rle.ts→导出→编辑→持久化），视频帧排除。

## ONNX 权重导出与推理
- 导出：本机 conda `E:\ProgramData\miniconda3\envs\pytorch_env`；`scripts/export-efficientnet.py` 产出 `public/models/efficientnet-b0.onnx`（特征 `[1,1280]`）。坑：① ProgramData 不可写→`python -m pip install --target <项目/.venv_onnx> onnx`(1.22.0)；② 运行设 `PYTHONPATH=<项目/.venv_onnx>`；③ PowerShell `*>` 误报 cancelled→用 `cmd /c "py ... > log.txt 2>&1"`；④ 限速换 `https://pypi.org/simple`；⑤ 绝对路径调 python.exe。
- 运行时 onnxruntime-web：绝不可把 jsep loader 放 `public/onnx`+设 `wasmPaths='/onnx/'`（Vite dev 拒绝 import public 下 JS）。正确：`import ortWasmMjsUrl from '...jsep.mjs?url'` + `import ortWasmWasmUrl from '...jsep.wasm?url'`，再 `ort.env.wasm.wasmPaths={mjs,wasm}`，由 Vite 打包提供（本地离线）。`vite.config.ts` 保留 `optimizeDeps.exclude:['onnxruntime-web']`。

## hnswlib-wasm（对比 onnxruntime-web）
- `hnswlib-wasm@0.8.2` 的 WASM 以 base64 data URI 内联进 JS，Vite 直接打包为动态 import 独立懒加载 chunk，**无需 wasmPaths/locateFile/optimizeDeps.exclude**。用 `import('hnswlib-wasm').then(m => m.loadHnswlib())` 惰性加载，`new lib.HierarchicalNSW('ip', dim, '')`（第 3 参 `''` 关自动落盘）。'ip' 距离=1−点积，归一化下 `score = 1 - distance ∈ [0,1]`。
- 已迁 Worker：`src/embed/ann.worker.ts` 持有 HNSW 索引，`src/embed/annClient.ts` 主线程单例客户端（reqId 映射 + destroyAnnWorker）。`useEmbeddings.findSimilar` 仅当 `all.size > ANN_THRESHOLD(5000)` 走 Worker，否则主线程暴力、异常 annBroken 回退；Worker 构建时拷贝 entries（不 transfer）防 neuter。

## i18n 迁移审计（必记）
- vue-i18n@11：`import { useI18n }` + `const { t } = useI18n()`（非 auto-import）；`el-switch` 的 `active-text` 须 `:active-text="t('...')"`。
- 致命坑：迁移"声称完成"几乎总漏网。每次迁完**必须跑 CJK 审计**：`search_content` 配 `\p{Han}`（ripgrep PCRE2 `-P`）搜该文件，过滤 `//` 与 `/** */` 注释后，用户可见硬编码中文须为 0。最易漏：① 报告构造器的 caption/headers/emptyHint（忘了调 `t()`）；② 图表单元标题/`el-empty description`；③ 配置区 `<span class="config-label">` 小标签。注释中文可保留。

## 工作区恢复（启动行为）
- `useWorkspace.ts` 提供 `autoRestore`（localStorage `dv.workspace.autoRestore`，默认 true，语义=「启动时提示恢复」）；`promptRestoreOnStartup()` 在 DatasetViewer onMounted 调用：无数据集且存在已保存工作区时弹 `ElMessageBox.confirm` 询问恢复，取消则保持空白（已存配置保留，可稍后手动恢复）。取代原先静默自动恢复。
