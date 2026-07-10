import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import './style.less'

const app = createApp(App)
app.use(ElementPlus)

// 自动注册所有 Element Plus 图标（unplugin-vue-components 会自动导入）
// 如果需要手动注册，可以在组件中使用 <el-icon><IconName /></el-icon>

app.mount('#app')
