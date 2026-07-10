import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { readFileSync, existsSync } from 'node:fs'

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
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // 路径别名
  resolve: {
    alias: {
      '@': '/src'
    }
  },
}));
