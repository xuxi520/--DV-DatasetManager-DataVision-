<template>
  <div class="stats-view">
    <div class="stats-scroll">
      <!-- 概览卡片 -->
      <div class="stats-cards">
        <div class="stat-card"><div class="stat-num">{{ datasetStats.totalImages }}</div><div class="stat-label">图片总数</div></div>
        <div class="stat-card"><div class="stat-num">{{ datasetStats.totalAnnotations }}</div><div class="stat-label">标注总数</div></div>
        <div class="stat-card"><div class="stat-num">{{ datasetStats.annotatedImages }}</div><div class="stat-label">已标注</div></div>
        <div class="stat-card"><div class="stat-num">{{ datasetStats.unannotatedImages }}</div><div class="stat-label">未标注</div></div>
        <div class="stat-card"><div class="stat-num">{{ datasetStats.classCount }}</div><div class="stat-label">类别数</div></div>
        <div class="stat-card"><div class="stat-num">{{ datasetStats.avgAnnPerImage }}</div><div class="stat-label">平均标注/图</div></div>
        <div class="stat-card warn"><div class="stat-num">{{ datasetStats.duplicateImages }}</div><div class="stat-label">疑似重复(同哈希)</div></div>
        <div class="stat-card warn"><div class="stat-num">{{ datasetStats.invalidImages }}</div><div class="stat-label">无效(0尺寸)</div></div>
      </div>

      <div class="stats-section" v-if="datasetStats.perDataset.length > 1">
        <h3>数据集概览</h3>
        <table class="stats-table">
          <thead><tr><th>数据集</th><th>图片</th><th>标注</th></tr></thead>
          <tbody>
            <tr v-for="d in datasetStats.perDataset" :key="d.name">
              <td>{{ d.name }}</td><td>{{ d.images }}</td><td>{{ d.annotations }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="stats-grid">
        <div class="stats-section chart-section">
          <h3>类别分布 (按标注数)</h3>
          <ChartPanel v-if="classChartOption" :option="classChartOption" height="340px" />
          <div v-else class="stats-empty">暂无标注</div>
        </div>

        <div class="stats-section chart-section">
          <h3>子集分布</h3>
          <ChartPanel v-if="splitChartOption" :option="splitChartOption" height="280px" />
          <div v-else class="stats-empty">无数据</div>
        </div>

        <div class="stats-section chart-section">
          <h3>标注类型</h3>
          <ChartPanel v-if="typeChartOption" :option="typeChartOption" height="280px" />
          <div v-else class="stats-empty">无数据</div>
        </div>

        <div class="stats-section chart-section">
          <h3>分辨率分布 (长边)</h3>
          <ChartPanel v-if="resolutionChartOption" :option="resolutionChartOption" height="280px" />
        </div>

        <div class="stats-section chart-section">
          <h3>宽高比</h3>
          <ChartPanel v-if="aspectChartOption" :option="aspectChartOption" height="280px" />
        </div>

        <div class="stats-section chart-section">
          <h3>文件大小</h3>
          <ChartPanel v-if="sizeChartOption" :option="sizeChartOption" height="280px" />
        </div>

        <div class="stats-section chart-section">
          <h3>目标尺寸占比 (占图面积)</h3>
          <ChartPanel v-if="boxSizeChartOption" :option="boxSizeChartOption" height="280px" />
          <div v-else class="stats-empty">无标注框</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toRef } from 'vue'
import ChartPanel from './ChartPanel.vue'
import type { DataSet, ParsedAnnotation } from '../types'
import { useDatasetStats } from '../composables/useDatasetStats'
import { useChartOptions } from '../composables/useChartOptions'

const props = defineProps<{
  datasets: DataSet[]
  datasetAnnotations: Map<string, Map<string, ParsedAnnotation[]>>
  categoryColorMap: Map<string, string>
}>()

const { datasetStats } = useDatasetStats(
  toRef(props, 'datasets'),
  toRef(props, 'datasetAnnotations'),
  toRef(props, 'categoryColorMap'),
)

const {
  classChartOption,
  splitChartOption,
  typeChartOption,
  resolutionChartOption,
  aspectChartOption,
  sizeChartOption,
  boxSizeChartOption,
} = useChartOptions(datasetStats)
</script>

<style scoped>
.stats-view {
  height: 100%;
}

.stats-scroll {
  height: 100%;
  overflow-y: auto;
  padding: 20px;
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}

.stat-card {
  background: var(--el-bg-color-overlay, #fff);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  padding: 16px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.stat-card.warn {
  border-color: var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
}

.stat-card.warn .stat-num {
  color: var(--el-color-warning);
}

.stat-num {
  font-size: 26px;
  font-weight: 700;
  color: var(--el-color-primary);
  line-height: 1.2;
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.stats-section {
  margin-bottom: 22px;
}

.stats-section h3 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.stats-table th,
.stats-table td {
  border: 1px solid var(--el-border-color-light);
  padding: 8px 12px;
  text-align: left;
}

.stats-table th {
  background: var(--el-fill-color-light);
  font-weight: 600;
}

.stats-section.chart-section {
  min-height: 320px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.stats-empty {
  color: var(--el-text-color-secondary);
  text-align: center;
  padding: 40px 0;
  line-height: 300px;
}
</style>