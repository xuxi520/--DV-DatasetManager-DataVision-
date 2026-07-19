import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { readFileSync, existsSync } from 'node:fs'
import { consoleSink } from './vite-console-sink'

// 强制以 UTF-8 读取源文件，规避部分环境下 Vite 按系统代码页(GBK)解码 .vue 导致的中文乱码
const forceUtf8 = {
  name: 'force-utf8-source',
  enforce: 'pre',
  load(id: string) {
    if ((id.endsWith('.vue') || id.endsWith('.ts') || id.endsWith('.js')) && existsSync(id)) {
      try {
        return readFileSync(id, 'utf-8')
      } catch {
        return null
      }
    }
    return null
  },
}

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    forceUtf8,
    consoleSink(),
    vue(),
    // 自动导入 Vue 和相关库的 API
    AutoImport({
      resolvers: [ElementPlusResolver()],
      imports: ['vue', '@vueuse/core'],
      dts: 'src/auto-imports.d.ts',
      eslintrc: {
        enabled: true,
        filepath: './.eslintrc-auto-import.json'
      }
    }),
    // 自动导入 Element Plus 组件
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts'
    })
  ],

  // CSS 预处理器配置
  css: {
    preprocessorOptions: {
      less: {
        // 注意：不能使用路径别名，需要使用相对路径
        additionalData: `@import "${process.cwd()}/src/styles/variables.less";`,
        javascriptEnabled: true
      }
    }
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    // 多线程 wasm（onnxruntime-web numThreads>1 依赖 SharedArrayBuffer）需要
    // COOP/COEP 跨域隔离响应头；单线程模式无需。仅 dev 生效，Tauri 打包需在
    // 自定义协议侧另行配置或在目标机器用单线程。
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // onnxruntime-web 自带 wasm loader，需由打包工具直接处理（不走 esbuild 预打包），
  // 否则 dev 下 wasmPaths 动态 import 会解析异常
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },

  // 本项目 Worker 均为 type:'module'，且内部使用动态 import（如 ann.worker 懒加载
  // hnswlib-wasm 会产生 code-split 子块）。IIFE 默认格式不支持 code-split，
  // 故统一指定 ES 模块 Worker 格式。
  worker: {
    format: 'es',
  },

  // 路径别名
  resolve: {
    alias: {
      '@': '/src'
    }
  },
}));
