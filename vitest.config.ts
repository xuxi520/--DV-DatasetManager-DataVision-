import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // 解析器是纯 TS，不需要浏览器环境；index 调度器也只依赖字符串/路径运算
  },
})
