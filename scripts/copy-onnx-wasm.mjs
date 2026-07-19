/**
 * 历史脚本（已废弃）。
 *
 * 早期方案把 onnxruntime-web 的 .wasm 复制到 public/onnx/ 并设 wasmPaths 为目录路径，
 * 但 ort 后端 loader（.mjs）一旦进入 public/ 会被 Vite dev 拒绝 import（"should not be
 * imported from source code"），导致模型加载失败、特征抽不出来。
 *
 * 现改为在 src/embed/embedModel.ts 用 Vite `?url` 导入后端 (.mjs) 与权重 (.wasm)，
 * 以对象 `{ mjs, wasm }` 传给 ort.env.wasm.wasmPaths —— 资源由打包工具作为静态资产提供，
 * 无需任何手动复制步骤，dev / build 均可用。故本脚本不再需要。
 *
 * 如需从头重建运行资产，请改用：pnpm export-model（导出 efficientnet-b0.onnx 到 public/models）。
 */
console.log('[copy-onnx-wasm] 已废弃：wasm 现由 Vite ?url 自动打包，无需复制。')
console.log('[copy-onnx-wasm] 运行资产只需 public/models/efficientnet-b0.onnx（pnpm export-model 生成）。')
