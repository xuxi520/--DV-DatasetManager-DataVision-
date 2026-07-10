<template>
  <div style="padding: 20px;">
    <h1>DataSet Vision Compare - 测试版</h1>
    <el-button type="primary" @click="handleClick">测试按钮</el-button>
    <p v-if="clicked">按钮已点击！</p>
    <p>环境：{{ env }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { env } from './env'

const clicked = ref(false)
function handleClick() {
  clicked.value = true
  console.log('按钮点击，环境：', env)
}
</script>
