import type { Plugin, ViteDevServer, Connect } from 'vite'
import { appendFile, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// 仅 dev 生效：把浏览器/Tauri webview 运行时的 console 与全局错误，
// 通过 fetch/sendBeacon 发到 dev server 中间件，落盘到 debug/browser.log。
// 因为 tauri dev 的 webview 也从同一个 Vite dev server 加载，
// 所以一个桥就能同时覆盖浏览器端和 Tauri 端，且 apply:'serve' 保证生产零污染。

// 注入页面的客户端代码（必须自包含，不引用模块作用域变量）。
function consoleSinkClient() {
  const ENDPOINT = '/__console_sink'
  const queue: unknown[] = []
  const MAX = 200
  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const
  const originals: Record<string, (...a: unknown[]) => void> = {}
  for (const lv of levels) {
    const fn = (console as unknown as Record<string, (...a: unknown[]) => void>)[lv]
    if (fn) originals[lv] = fn.bind(console)
  }
  function push(level: string, args: unknown[]) {
    let msg = ''
    let stack: string | undefined
    try {
      msg = args
        .map((a) => {
          if (typeof a === 'string') return a
          if (a instanceof Error) {
            stack = a.stack
            return a.message
          }
          try {
            return JSON.stringify(a)
          } catch {
            return String(a)
          }
        })
        .join(' ')
    } catch {
      msg = '[unserializable]'
    }
    queue.push({ t: Date.now(), level, msg, stack })
    if (queue.length >= MAX) flush()
  }
  for (const lv of levels) {
    const o = originals[lv]
    if (o) {
      ;(console as unknown as Record<string, (...a: unknown[]) => void>)[lv] = (...args: unknown[]) => {
        push(lv, args)
        o(...args)
      }
    }
  }
  window.addEventListener('error', (e) =>
    push('error', [e.message + (e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : '')]),
  )
  window.addEventListener('unhandledrejection', (e) =>
    push('error', ['Unhandled rejection: ' + ((e.reason && e.reason.message) || e.reason)]),
  )
  function flush() {
    if (!queue.length) return
    const batch = queue.splice(0, queue.length)
    try {
      const blob = new Blob([JSON.stringify(batch)], { type: 'application/json' })
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, blob)
      else
        fetch(ENDPOINT, {
          method: 'POST',
          body: JSON.stringify(batch),
          headers: { 'content-type': 'application/json' },
        })
    } catch {
      /* 忽略：调试桥本身不应影响业务 */
    }
  }
  setInterval(flush, 300)
  window.addEventListener('beforeunload', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

export function consoleSink(): Plugin {
  const logDir = join(process.cwd(), 'debug')
  const logFile = join(logDir, 'browser.log')
  mkdirSync(logDir, { recursive: true })

  return {
    name: 'console-sink',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      // 会话分隔标记，便于区分多次启动
      appendFile(logFile, `\n=== dev server @ ${new Date().toISOString()} ===\n`, () => {})

      const handler: Connect.NextHandleFunction = (req, res, next) => {
        if (req.method !== 'POST' || !req.url || !req.url.startsWith('/__console_sink')) {
          return next()
        }
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          try {
            const entries = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
            if (Array.isArray(entries)) {
              const text =
                entries
                  .map((e: Record<string, unknown>) => {
                    const ts = new Date((e.t as number) || Date.now()).toISOString()
                    const head = `[${ts}] [${(e.level as string) || 'log'}] ${e.msg as string}`
                    return e.stack ? `${head}\n${e.stack}` : head
                  })
                  .join('\n') + '\n'
              appendFile(logFile, text, () => {})
            }
          } catch {
            /* 忽略畸形请求 */
          }
          res.statusCode = 204
          res.end()
        })
      }
      server.middlewares.use(handler)
    },
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module' },
          injectTo: 'head',
          children: `(${consoleSinkClient.toString()})();`,
        },
      ]
    },
  }
}
