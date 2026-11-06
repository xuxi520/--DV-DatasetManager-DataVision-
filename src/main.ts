import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import { i18n } from './i18n'
import './style.less'

const app = createApp(App)
app.use(i18n)
app.use(ElementPlus)
// ElementPlus 内置组件文案通过 App.vue 的 <el-config-provider :locale> 与 i18n 同步切换

// 自动注册所有 Element Plus 图标（unplugin-vue-components 会自动导入）
// 如果需要手动注册，可以在组件中使用 <el-icon><IconName /></el-icon>

// [临时诊断] 运行时错误捕获（定位后移除）
// - 浏览器端：显示在页面顶部红条（__diag_err）
// - Tauri 客户端：额外把错误写盘到项目根 .tauri_runtime_errors.log，便于在「双端」里
//   没法直接进 WebView2 窗口时，仍能读到客户端真实运行时报错。
// 同时捕获：window error / unhandledrejection / Vue 渲染错误 / console.error，
// 因为 Vue 在事件处理函数或渲染期抛错时走 console.error，不会触发 window 'error'。
const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window
const TAURI_ERR_LOG = 'F:\\WorkSpace\\dataset-manager\\.tauri_runtime_errors.log'
const TAURI_DOM_LOG = 'F:\\WorkSpace\\dataset-manager\\.tauri_runtime_dom.html'
let tauriErrBuf = ''
async function sinkTauri(msg: string) {
  if (!isTauri) return
  tauriErrBuf += msg + '\n---\n'
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    // 错误文本
    await invoke('write_text_file', { path: TAURI_ERR_LOG, content: tauriErrBuf })
    // 同时落盘「出错瞬间客户端真实 DOM」，便于在无 JS 抛错（静默渲染问题）时也能看到结构
    const html = (document.body ? document.body.innerHTML : '') as string
    await invoke('write_text_file', {
      path: TAURI_DOM_LOG,
      content: '<!-- tauri DOM snapshot @ ' + new Date().toISOString() + ' -->\n' + html.slice(0, 200000),
    })
  } catch { /* ignore */ }
}
function showErr(msg: string) {
  let box = document.getElementById('__diag_err')
  if (!box) {
    box = document.createElement('div')
    box.id = '__diag_err'
    box.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:99999;max-height:50vh;overflow:auto;' +
      'background:#1a0000;color:#ff6b6b;font:12px/1.5 monospace;padding:8px 12px;white-space:pre-wrap;' +
      'border-bottom:2px solid #ff6b6b;'
    document.body.appendChild(box)
  }
  box.textContent = (box.textContent ? box.textContent + '\n---\n' : '') + msg
  void sinkTauri(msg)
}
window.addEventListener('error', (e) => {
  showErr('[error] ' + (e.message || e.error) + (e.error && e.error.stack ? '\n' + e.error.stack : ''))
})
window.addEventListener('unhandledrejection', (e) => {
  showErr('[promise] ' + (e.reason && e.reason.stack ? e.reason.stack : e.reason))
})
const _origErr = console.error
console.error = (...args: unknown[]) => {
  try {
    showErr('[console.error] ' + args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(' '))
  } catch { /* ignore */ }
  _origErr.apply(console, args as [])
}
// Vue 渲染/setup 期错误会经 errorHandler 上报，而非 window 'error'
app.config.errorHandler = (err, _instance, info) => {
  showErr('[vue:' + info + '] ' + (err instanceof Error ? err.stack || err.message : String(err)))
}

// [临时诊断] 按需快照热键：Tauri 客户端里按 Ctrl+Shift+D，把当前真实 DOM 写盘，
// 即使没有任何 JS 报错，也能让 AI 读到客户端窗口此刻渲染出的结构（排查静默渲染问题）。
if (isTauri) {
  window.addEventListener('keydown', async (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault()
      const html = (document.body ? document.body.innerHTML : '') as string
      const stamp = '<!-- tauri DOM snapshot @ ' + new Date().toISOString() + ' -->\n'
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('write_text_file', { path: TAURI_DOM_LOG, content: stamp + html.slice(0, 200000) })
      } catch { /* ignore */ }
    }
  })
}

// 桌面端禁用浏览器/WebView2 原生右键菜单（避免露出「重新加载 / 检查元素」等系统菜单）。
// 画布区自有的 @contextmenu 处理不受影响——事件仍会正常冒泡并执行各自逻辑。
if (isTauri) {
  document.addEventListener('contextmenu', (e) => e.preventDefault())
}

app.mount('#app')

// 启动动画：首屏渲染完成后淡出并移除 index.html 内的静态 splash 层（避免白屏加载态）
requestAnimationFrame(() => {
  setTimeout(() => {
    const splash = document.getElementById('splash')
    if (!splash) return
    splash.classList.add('hide')
    const remove = () => splash.remove()
    splash.addEventListener('transitionend', remove, { once: true })
    setTimeout(remove, 800) // 动画兜底移除
  }, 600)
})
