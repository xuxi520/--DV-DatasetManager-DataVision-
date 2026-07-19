<template>
  <div class="stats-view">
    <!-- 顶部工具栏：模式切换 + 数据集选择 -->
    <div class="stats-toolbar">
      <div class="scope-select">
      <span class="scope-label">{{ t('stats.mode') }}</span>
      <el-radio-group v-model="mode" size="default">
        <el-radio-button label="overview">{{ t('stats.modeOverview') }}</el-radio-button>
        <el-radio-button label="compare">{{ t('stats.modeCompare') }}</el-radio-button>
        <el-radio-button label="quality">{{ t('stats.modeQuality') }}</el-radio-button>
      </el-radio-group>
      </div>

      <!-- 概览模式：单选数据集 / 叠加总和 -->
      <div class="scope-select" v-if="mode === 'overview'">
        <span class="scope-label">{{ t('stats.scope') }}</span>
        <el-select v-model="selectedDataset" size="default" :placeholder="t('stats.scopePlaceholder')" clearable class="scope-select-input">
          <el-option :label="t('stats.allSum')" value="__all__" />
          <el-option
            v-for="ds in datasets"
            :key="ds.id"
            :label="ds.name"
            :value="ds.name"
          />
        </el-select>
      </div>

      <!-- 对比模式：多选数据集 -->
      <div class="scope-select" v-else-if="mode === 'compare'">
        <span class="scope-label">{{ t('stats.compareDatasets') }}</span>
        <el-select
          v-model="compareSelection"
          multiple
          size="default"
          :placeholder="t('stats.comparePlaceholder')"
          class="scope-select-input multi"
        >
          <el-option
            v-for="ds in datasets"
            :key="ds.id"
            :label="ds.name"
            :value="ds.name"
          />
        </el-select>
      </div>

      <div class="scope-summary" v-if="mode === 'overview'">
        <el-tag size="small" effect="plain">{{ t('stats.imagesCount', { n: datasetStats.totalImages }) }}</el-tag>
        <el-tag size="small" effect="plain" type="success">{{ t('stats.annsCount', { n: datasetStats.totalAnnotations }) }}</el-tag>
        <el-tag size="small" effect="plain" type="warning">{{ t('stats.classesCount', { n: datasetStats.classCount }) }}</el-tag>
        <el-tag v-if="datasetStats.selectedName" size="small" type="primary" effect="plain">
          {{ t('stats.current') }}{{ datasetStats.selectedName }}
        </el-tag>
        <el-tag v-else size="small" type="info" effect="plain">{{ t('stats.sumTotal') }}</el-tag>
      </div>

      <!-- 质量模式：作用于所选数据集（默认全部已加载数据集） -->
      <div class="scope-select" v-else>
        <span class="scope-label">{{ t('stats.qualityCheck') }}</span>
        <el-select
          v-model="qualityTargetDatasetId"
          size="default"
          :placeholder="t('stats.qualityPlaceholder')"
          class="scope-select-input"
        >
          <el-option :label="t('stats.allLoaded')" value="__all__" />
          <el-option
            v-for="ds in datasets"
            :key="ds.id"
            :label="ds.name"
            :value="ds.id"
          />
        </el-select>
      </div>

      <!-- 概览 / 对比模式：数据集级概览导出（质量模式自带导出按钮） -->
      <div class="scope-export" v-if="mode === 'overview' || mode === 'compare'">
        <el-button-group>
          <el-button size="small" :disabled="exportDisabled" @click="exportStatsHtml">
            <el-icon><Document /></el-icon> HTML
          </el-button>
          <el-button size="small" :disabled="exportDisabled" @click="exportStatsPdf">
            <el-icon><Printer /></el-icon> PDF
          </el-button>
        </el-button-group>
      </div>
    </div>

    <template v-if="mode === 'overview' && selectedDataset">
    <!-- 概览卡片 -->
    <div class="stats-cards">
      <div class="stat-card"><div class="stat-num">{{ datasetStats.totalImages }}</div><div class="stat-label">{{ t('stats.cardImages') }}</div></div>
      <div class="stat-card"><div class="stat-num">{{ datasetStats.totalAnnotations }}</div><div class="stat-label">{{ t('stats.cardAnns') }}</div></div>
      <div class="stat-card"><div class="stat-num">{{ datasetStats.annotatedImages }}</div><div class="stat-label">{{ t('stats.cardAnnotated') }}</div></div>
      <div class="stat-card"><div class="stat-num">{{ datasetStats.unannotatedImages }}</div><div class="stat-label">{{ t('stats.cardUnannotated') }}</div></div>
      <div class="stat-card"><div class="stat-num">{{ datasetStats.classCount }}</div><div class="stat-label">{{ t('stats.cardClasses') }}</div></div>
      <div class="stat-card"><div class="stat-num">{{ datasetStats.avgAnnPerImage }}</div><div class="stat-label">{{ t('stats.cardAvgAnn') }}</div></div>
      <div class="stat-card warn"><div class="stat-num">{{ datasetStats.duplicateImages }}</div><div class="stat-label">{{ t('stats.cardDup') }}</div></div>
      <div class="stat-card warn"><div class="stat-num">{{ datasetStats.invalidImages }}</div><div class="stat-label">{{ t('stats.cardInvalid') }}</div></div>
      <div class="stat-card warn"><div class="stat-num">{{ datasetStats.overlapImages }}</div><div class="stat-label">{{ t('stats.cardOverlapImgs') }}</div></div>
      <div class="stat-card warn"><div class="stat-num">{{ (datasetStats.overlapImageRate * 100).toFixed(1) }}%</div><div class="stat-label">{{ t('stats.cardOverlapRate') }}</div></div>
      <div class="stat-card warn"><div class="stat-num">{{ datasetStats.overlapPairs }}</div><div class="stat-label">{{ t('stats.cardOverlapPairs') }}</div></div>
      <div class="stat-card warn"><div class="stat-num">{{ datasetStats.avgOverlapIou.toFixed(2) }}</div><div class="stat-label">{{ t('stats.cardAvgIou') }}</div></div>
    </div>

    <!-- 多数据集概览（仅叠加总和时显示） -->
    <div class="stats-section" v-if="!datasetStats.selectedName && datasetStats.perDataset.length > 1">
      <h3>{{ t('stats.sectionDsOverview') }}</h3>
      <table class="stats-table">
        <thead><tr><th>{{ t('stats.thDataset') }}</th><th class="num">{{ t('stats.thImages') }}</th><th class="num">{{ t('stats.thAnns') }}</th></tr></thead>
        <tbody>
          <tr v-for="d in datasetStats.perDataset" :key="d.name">
            <td>{{ d.name }}</td><td class="num">{{ d.images }}</td><td class="num">{{ d.annotations }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 标签信息（纯信息展示） -->
    <div class="stats-section">
      <h3>{{ t('stats.sectionCatInfo') }}</h3>
      <div class="table-scroll">
        <table class="stats-table cat-table">
          <thead>
            <tr>
              <th>{{ t('stats.thLabel') }}</th>
              <th class="num">{{ t('stats.thAnnCount') }}</th>
              <th class="num">{{ t('stats.thImgCount') }}</th>
              <th class="num">{{ t('stats.thAvgPerImg') }}</th>
              <th class="num">{{ t('stats.thRatio') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in datasetStats.classes" :key="c.name">
              <td><span class="swatch" :style="{ background: c.color }"></span>{{ c.name }}</td>
              <td class="num">{{ c.annCount }}</td>
              <td class="num">{{ c.imgCount }}</td>
              <td class="num">{{ (c.annCount / Math.max(1, c.imgCount)).toFixed(1) }}</td>
              <td class="num">{{ ((c.annCount / Math.max(1, datasetStats.totalAnnotations)) * 100).toFixed(1) }}%</td>
            </tr>
            <tr v-if="!datasetStats.classes.length"><td colspan="5" class="empty">{{ t('stats.emptyNoAnn') }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 图表网格（全宽，信息密度更高） -->
    <div class="stats-grid">
      <div class="stats-section chart-section">
        <h3>{{ t('stats.chartCatDist') }}</h3>
        <ChartPanel v-if="classChartOption" :option="classChartOption" height="320px" />
        <div v-else class="stats-empty">{{ t('stats.emptyNoAnn') }}</div>
      </div>

      <div class="stats-section chart-section">
        <h3>{{ t('stats.chartSplit') }}</h3>
        <ChartPanel v-if="splitChartOption" :option="splitChartOption" height="280px" />
        <div v-else class="stats-empty">{{ t('stats.emptyData') }}</div>
      </div>

      <div class="stats-section chart-section">
        <h3>{{ t('stats.chartType') }}</h3>
        <ChartPanel v-if="typeChartOption" :option="typeChartOption" height="280px" />
        <div v-else class="stats-empty">{{ t('stats.emptyData') }}</div>
      </div>

      <div class="stats-section chart-section">
        <h3>{{ t('stats.chartRes') }}</h3>
        <ChartPanel v-if="resolutionChartOption" :option="resolutionChartOption" height="280px" />
      </div>

      <div class="stats-section chart-section">
        <h3>{{ t('stats.chartAspect') }}</h3>
        <ChartPanel v-if="aspectChartOption" :option="aspectChartOption" height="280px" />
      </div>

      <div class="stats-section chart-section">
        <h3>{{ t('stats.chartFileSize') }}</h3>
        <ChartPanel v-if="sizeChartOption" :option="sizeChartOption" height="280px" />
      </div>

      <div class="stats-section chart-section">
        <h3>{{ t('stats.chartBoxSize') }}</h3>
        <ChartPanel v-if="boxSizeChartOption" :option="boxSizeChartOption" height="280px" />
        <div v-else class="stats-empty">{{ t('stats.emptyBox') }}</div>
      </div>

      <div class="stats-section chart-section">
        <h3>{{ t('stats.chartOverlap') }}</h3>
        <ChartPanel v-if="overlapPieOption" :option="overlapPieOption" height="280px" />
        <div v-else class="stats-empty">{{ t('stats.emptyAnnShort') }}</div>
      </div>

      <div class="stats-section chart-section">
        <h3>{{ t('stats.chartIouHist') }}</h3>
        <ChartPanel v-if="iouHistogramOption" :option="iouHistogramOption" height="280px" />
        <div v-else class="stats-empty">{{ t('stats.emptyAnnShort') }}</div>
      </div>
    </div>
    </template>

    <!-- 概览但未选择数据集：默认空，避免瞬时加载全部统计 -->
    <template v-else-if="mode === 'overview'">
      <div class="stats-placeholder">
        <el-empty :description="t('stats.placeholderSelect')" />
      </div>
    </template>

    <!-- 对比模式：列表形式并排对比各项统计指标 -->
    <template v-else-if="mode === 'compare'">
      <div class="stats-section" v-if="compareSelection.length < 2">
        <el-empty :description="t('stats.compareEmpty')" />
      </div>
      <template v-else>
        <div class="stats-section">
          <h3>{{ t('stats.compareOverall') }}</h3>
          <div class="table-scroll">
            <table class="stats-table compare-table">
              <thead>
                <tr>
                  <th>{{ t('stats.thMetric') }}</th>
                  <th v-for="s in compareStats" :key="s.selectedName || ''" class="num">{{ s.selectedName }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in compareMetrics" :key="m.key">
                  <td>{{ m.label }}</td>
                  <td v-for="s in compareStats" :key="s.selectedName || ''" class="num">{{ m.fmt(s) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="stats-section">
          <h3>{{ t('stats.compareCatCount') }}</h3>
          <div class="table-scroll">
            <table class="stats-table compare-table">
              <thead>
                <tr>
                  <th>{{ t('stats.thCategory') }}</th>
                  <th v-for="s in compareStats" :key="s.selectedName || ''" class="num">{{ s.selectedName }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in compareClassRows" :key="c.name">
                  <td><span class="swatch" :style="{ background: c.color }"></span>{{ c.name }}</td>
                  <td v-for="s in compareStats" :key="s.selectedName || ''" class="num">
                    {{ c.counts[s.selectedName || ''] ?? 0 }}
                  </td>
                </tr>
                <tr v-if="!compareClassRows.length">
                  <td colspan="999" class="empty">{{ t('stats.emptyNoAnn') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <!-- 各数据集图表对比：超宽屏并排即多数据集直观对照 -->
      <div class="stats-section" v-if="compareSelection.length >= 2">
        <h3>{{ t('stats.compareCharts') }}</h3>
        <div class="compare-charts">
          <div class="compare-chart-card" v-for="item in compareCharts" :key="item.stats.selectedName || ''">
            <h4 class="compare-chart-title">{{ item.stats.selectedName }}</h4>
            <div class="compare-chart-grid">
              <div class="chart-cell" v-if="item.charts.classChartOption">
                <div class="chart-cell-title">{{ t('stats.cellCatDist') }}</div>
                <ChartPanel :option="item.charts.classChartOption" height="240px" />
              </div>
              <div class="chart-cell" v-if="item.charts.splitChartOption">
                <div class="chart-cell-title">{{ t('stats.cellSplit') }}</div>
                <ChartPanel :option="item.charts.splitChartOption" height="240px" />
              </div>
              <div class="chart-cell" v-if="item.charts.typeChartOption">
                <div class="chart-cell-title">{{ t('stats.cellType') }}</div>
                <ChartPanel :option="item.charts.typeChartOption" height="240px" />
              </div>
              <div class="chart-cell" v-if="item.charts.resolutionChartOption">
                <div class="chart-cell-title">{{ t('stats.cellRes') }}</div>
                <ChartPanel :option="item.charts.resolutionChartOption" height="240px" />
              </div>
              <div class="chart-cell" v-if="item.charts.aspectChartOption">
                <div class="chart-cell-title">{{ t('stats.cellAspect') }}</div>
                <ChartPanel :option="item.charts.aspectChartOption" height="240px" />
              </div>
              <div class="chart-cell" v-if="item.charts.sizeChartOption">
                <div class="chart-cell-title">{{ t('stats.cellFileSize') }}</div>
                <ChartPanel :option="item.charts.sizeChartOption" height="240px" />
              </div>
              <div class="chart-cell" v-if="item.charts.boxSizeChartOption">
                <div class="chart-cell-title">{{ t('stats.cellBoxSize') }}</div>
                <ChartPanel :option="item.charts.boxSizeChartOption" height="240px" />
              </div>
              <div class="chart-cell" v-if="item.charts.overlapPieOption">
                <div class="chart-cell-title">{{ t('stats.cellOverlap') }}</div>
                <ChartPanel :option="item.charts.overlapPieOption" height="240px" />
              </div>
              <div class="chart-cell" v-if="item.charts.iouHistogramOption">
                <div class="chart-cell-title">{{ t('stats.cellIou') }}</div>
                <ChartPanel :option="item.charts.iouHistogramOption" height="240px" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 质量模式：跨全部已加载数据集的质量汇总 -->
    <template v-else-if="mode === 'quality'">
      <div class="stats-section">
        <div class="quality-toolbar">
          <h3>{{ t('stats.qualityOverview') }}<span class="quality-scope">{{ qualityTargetName }}</span></h3>
          <el-button size="small" type="primary" :disabled="qualityStats.checked === 0" @click="exportQualityReport">
            {{ t('stats.exportReport', { fmt: 'HTML' }) }}
          </el-button>
          <el-button size="small" :disabled="qualityStats.checked === 0" @click="exportQualityReportPdf">
            {{ t('stats.exportReport', { fmt: 'PDF' }) }}
          </el-button>
        </div>
        <div class="stats-cards">
          <div class="stat-card"><div class="stat-num">{{ qualityStats.checked }}</div><div class="stat-label">{{ t('stats.qChecked') }}</div></div>
          <div class="stat-card"><div class="stat-num">{{ qualityStats.avgScore }}</div><div class="stat-label">{{ t('stats.qAvgScore') }}</div></div>
          <div class="stat-card warn"><div class="stat-num">{{ qualityStats.blur }}</div><div class="stat-label">{{ t('stats.qBlur') }}</div></div>
          <div class="stat-card warn"><div class="stat-num">{{ qualityStats.dark }}</div><div class="stat-label">{{ t('stats.qDark') }}</div></div>
          <div class="stat-card warn"><div class="stat-num">{{ qualityStats.bright }}</div><div class="stat-label">{{ t('stats.qBright') }}</div></div>
          <div class="stat-card warn"><div class="stat-num">{{ qualityStats.lowRes }}</div><div class="stat-label">{{ t('stats.qLowRes') }}</div></div>
          <div class="stat-card warn"><div class="stat-num">{{ qualityStats.monochrome }}</div><div class="stat-label">{{ t('stats.qMono') }}</div></div>
        </div>
      </div>

      <div class="stats-grid" v-if="qualityStats.checked > 0">
        <div class="stats-section chart-section">
          <h3>{{ t('stats.chartScoreDist') }}</h3>
          <ChartPanel :option="qualityCharts.scoreHist" height="300px" />
        </div>
        <div class="stats-section chart-section">
          <h3>{{ t('stats.chartIssuePie') }}</h3>
          <ChartPanel :option="qualityCharts.issuePie" height="300px" />
        </div>
      </div>
      <div class="stats-placeholder" v-else>
        <el-empty :description="t('stats.qualityEmpty')" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRef } from 'vue'
import { ElMessage } from 'element-plus'
import { Document, Printer } from '@element-plus/icons-vue'
import type { EChartsOption } from 'echarts'
import ChartPanel from './ChartPanel.vue'
import type { DataSet, ParsedAnnotation } from '../types'
import { useDatasetStats, type DatasetStats } from '../composables/useDatasetStats'
import { useChartOptions, useMultiChartOptions } from '../composables/useChartOptions'
import { useTheme } from '../composables/useTheme'
import { useQuality, computeQualityStats } from '../composables/useQuality'
import type { QualityResult } from '../quality/types'
import { useViewerState } from '../composables/useViewerState'
import { useStatsReports } from '../composables/useStatsReports'
import { downloadQualityReport, printQualityReport } from '../quality/report'
import { downloadReportHtml, printReportHtml } from '../report/reportHtml'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  datasets: DataSet[]
  datasetAnnotations: Map<string, Map<string, ParsedAnnotation[]>>
  categoryColorMap: Map<string, string>
}>()

// 统计模式：overview 概览（单选/叠加）| compare 对比（多选列表）
const mode = ref<'overview' | 'compare'>('overview')
// 统计范围：null 表示未选择（默认空，不计算全部）；'__all__' 表示全部叠加总和；否则单个数据集名
const selectedDataset = ref<string | null>(null)
// 对比模式下选中的数据集名列表
const compareSelection = ref<string[]>([])

// 单例状态：annVersion 驱动统计在编辑（增删/改类）后实时刷新
const { qualityTargetDatasetId, annVersion } = useViewerState()

const { datasetStats, computeStatsFor } = useDatasetStats(
  toRef(props, 'datasets'),
  toRef(props, 'datasetAnnotations'),
  toRef(props, 'categoryColorMap'),
  selectedDataset,
  annVersion,
)

// 对比模式：对选中的每个数据集分别算出一份统计，用于并排对比
const compareStats = computed(() =>
  compareSelection.value
    .map((name) => {
      const ds = props.datasets.find((d) => d.name === name)
      return ds ? computeStatsFor([ds], name) : null
    })
    .filter((s): s is DatasetStats => s !== null),
)

// 对比模式：为每个选中的数据集各生成一套图表配置（超宽屏并排即多数据集直观对比）
const { sets: compareCharts } = useMultiChartOptions(compareStats)

// 总体指标对比行定义
const compareMetrics = [
  { key: 'totalImages', label: t('stats.cardImages'), fmt: (s: DatasetStats) => s.totalImages },
  { key: 'totalAnnotations', label: t('stats.cardAnns'), fmt: (s: DatasetStats) => s.totalAnnotations },
  { key: 'annotatedImages', label: t('stats.cardAnnotated'), fmt: (s: DatasetStats) => s.annotatedImages },
  { key: 'unannotatedImages', label: t('stats.cardUnannotated'), fmt: (s: DatasetStats) => s.unannotatedImages },
  { key: 'classCount', label: t('stats.cardClasses'), fmt: (s: DatasetStats) => s.classCount },
  { key: 'avgAnnPerImage', label: t('stats.cardAvgAnn'), fmt: (s: DatasetStats) => s.avgAnnPerImage },
  { key: 'duplicateImages', label: t('stats.cardDup'), fmt: (s: DatasetStats) => s.duplicateImages },
  { key: 'invalidImages', label: t('stats.cardInvalid'), fmt: (s: DatasetStats) => s.invalidImages },
  { key: 'overlapImages', label: t('stats.cardOverlapImgs'), fmt: (s: DatasetStats) => s.overlapImages },
  { key: 'overlapImageRate', label: t('stats.cardOverlapRate'), fmt: (s: DatasetStats) => `${(s.overlapImageRate * 100).toFixed(1)}%` },
  { key: 'overlapPairs', label: t('stats.cardOverlapPairs'), fmt: (s: DatasetStats) => s.overlapPairs },
  { key: 'avgOverlapIou', label: t('stats.cardAvgIou'), fmt: (s: DatasetStats) => s.avgOverlapIou.toFixed(2) },
] as const

// 类别标注数对比：按类别对齐，列为各数据集
const compareClassRows = computed(() => {
  const map = new Map<string, { name: string; color: string; counts: Record<string, number> }>()
  for (const s of compareStats.value) {
    const dsName = s.selectedName || ''
    for (const c of s.classes) {
      let row = map.get(c.name)
      if (!row) {
        row = { name: c.name, color: c.color, counts: {} }
        map.set(c.name, row)
      }
      row.counts[dsName] = c.annCount
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const sa = Object.values(a.counts).reduce((x, y) => x + y, 0)
    const sb = Object.values(b.counts).reduce((x, y) => x + y, 0)
    return sb - sa
  })
})

const {
  classChartOption, splitChartOption, typeChartOption,
  resolutionChartOption, aspectChartOption, sizeChartOption,
  boxSizeChartOption, overlapPieOption, iouHistogramOption,
  chartColors,
} = useChartOptions(datasetStats)

// ===== 质量模式：按所选数据集作用域汇总的的质量总览 =====
const { options: qualityOptions, results: qualityResults } = useQuality()

/** 当前质量 tab 所选数据集（null = 全部已加载数据集） */
const qualityTargetDataset = computed(() =>
  qualityTargetDatasetId.value
    ? props.datasets.find((d) => d.id === qualityTargetDatasetId.value) ?? null
    : null,
)

/** 作用域后的检查结果：仅保留所选数据集的 fileId */
const scopedQualityResults = computed<Map<string, QualityResult>>(() => {
  const t = qualityTargetDataset.value
  if (!t) return qualityResults.value
  const ids = new Set(t.fileList.map((f) => f.id))
  const m = new Map<string, QualityResult>()
  for (const [id, r] of qualityResults.value) {
    if (ids.has(id)) m.set(id, r)
  }
  return m
})

/** 作用域后的质量统计（替代原先的全量 stats） */
const qualityStats = computed(() => computeQualityStats(scopedQualityResults.value, qualityOptions.value))

/** 作用域后的文件列表（供导出报告） */
const qualityFiles = computed(() =>
  qualityTargetDataset.value
    ? qualityTargetDataset.value.fileList
    : props.datasets.flatMap((d) => d.fileList),
)

const qualityTargetName = computed(() =>
  qualityTargetDataset.value ? ` · ${qualityTargetDataset.value.name}` : t('stats.allLoadedScope'),
)

const qualityCharts = computed<{ scoreHist: EChartsOption; issuePie: EChartsOption }>(() => {
  const s = qualityStats.value
  const c = chartColors.value
  const scoreHist: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 44, right: 16, top: 24, bottom: 28 },
    xAxis: {
      type: 'category',
      data: s.scoreBuckets.map((b) => b.range),
      axisLabel: { color: c.text },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: c.text },
      splitLine: { lineStyle: { color: c.splitLine } },
    },
    series: [
      {
        type: 'bar',
        data: s.scoreBuckets.map((b) => b.count),
        itemStyle: { color: c.textStrong },
        barWidth: '55%',
      },
    ],
  }
  const issuePie: EChartsOption = {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, textStyle: { color: c.legend } },
    series: [
      {
        type: 'pie',
        radius: ['42%', '70%'],
        avoidLabelOverlap: true,
        label: { color: c.label },
        data: [
          { name: t('stats.qBlur'), value: s.blur, itemStyle: { color: '#e6a23c' } },
          { name: t('stats.qDark'), value: s.dark, itemStyle: { color: '#909399' } },
          { name: t('stats.qBright'), value: s.bright, itemStyle: { color: '#409eff' } },
          { name: t('stats.qLowRes'), value: s.lowRes, itemStyle: { color: '#f56c6c' } },
          { name: t('stats.qMono'), value: s.monochrome, itemStyle: { color: '#67c23a' } },
        ],
      },
    ],
  }
  return { scoreHist, issuePie }
})

function exportQualityReport() {
  if (qualityStats.value.checked === 0) {
    ElMessage.warning(t('stats.msgRunQuality'))
    return
  }
  downloadQualityReport(
    qualityFiles.value,
    scopedQualityResults.value,
    qualityStats.value,
    qualityOptions.value,
  )
}

function exportQualityReportPdf() {
  if (qualityStats.value.checked === 0) {
    ElMessage.warning(t('stats.msgRunQuality'))
    return
  }
  printQualityReport(
    qualityFiles.value,
    scopedQualityResults.value,
    qualityStats.value,
    qualityOptions.value,
  )
}

// ===== 概览 / 对比模式：数据集级概览导出（统一走通用报表模块） =====

/** 概览模式需先选择数据集；对比模式需至少选 2 个数据集 */
const exportDisabled = computed(() =>
  mode.value === 'overview' ? !selectedDataset.value : compareSelection.value.length < 2,
)

// HTML 报告构造器（数据集级概览 / 对比）抽到独立组合式，主组件只负责导出装配
const { buildOverviewReportHtml, buildCompareReportHtml } = useStatsReports({
  datasetStats,
  compareStats,
  compareMetrics,
  compareClassRows,
})

function exportStatsHtml() {
  if (exportDisabled.value) {
    ElMessage.warning(mode.value === 'overview' ? t('stats.msgSelectOverview') : t('stats.msgSelectCompare'))
    return
  }
  const html = mode.value === 'overview' ? buildOverviewReportHtml() : buildCompareReportHtml()
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const prefix = mode.value === 'overview' ? 'stats-overview' : 'stats-compare'
  void downloadReportHtml(`${prefix}-${ts}.html`, html)
}

function exportStatsPdf() {
  if (exportDisabled.value) {
    ElMessage.warning(mode.value === 'overview' ? t('stats.msgSelectOverview') : t('stats.msgSelectCompare'))
    return
  }
  const html = mode.value === 'overview' ? buildOverviewReportHtml() : buildCompareReportHtml()
  printReportHtml(html)
}
</script>

<style scoped>
.stats-view {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 28px;
  background: var(--el-bg-color);
}

/* 顶部工具栏 */
.stats-toolbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin: -16px -20px 18px;
  padding: 14px 20px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
}

.scope-select {
  display: flex;
  align-items: center;
  gap: 10px;
}

.scope-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.scope-select-input {
  width: 240px;
}

.scope-select-input.multi {
  width: 360px;
}

.scope-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.scope-export {
  margin-left: auto;
}

.quality-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.quality-toolbar h3 {
  margin: 0;
}

.quality-scope {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  margin-left: 8px;
}

/* 概览卡片 */
.stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.stat-card {
  background: var(--el-bg-color-overlay, #fff);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  padding: 14px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.stat-card.warn {
  border-color: var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
}

.stat-card.warn .stat-num {
  color: var(--el-color-warning);
}

.stat-num {
  font-size: 24px;
  font-weight: 700;
  color: var(--el-color-primary);
  line-height: 1.2;
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

/* 区块 */
.stats-section {
  margin-bottom: 20px;
}

.stats-section h3 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
}

.stats-section.chart-section {
  min-height: 320px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--el-bg-color-overlay, #fff);
}

.stats-empty {
  color: var(--el-text-color-secondary);
  text-align: center;
  padding: 40px 0;
}

/* 表格 */
.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.stats-table th,
.stats-table td {
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding: 8px 12px;
  text-align: left;
}

.stats-table th {
  background: var(--el-fill-color-light);
  font-weight: 600;
}

.stats-table td.num,
.stats-table th.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.stats-table tbody tr:hover {
  background: var(--el-fill-color-light);
}

.stats-table .empty {
  text-align: center;
  color: var(--el-text-color-secondary);
  padding: 20px;
}

.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 8px;
  vertical-align: middle;
}

.table-scroll {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}
.stats-placeholder {
  padding: 80px 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 对比模式：各数据集图表并排（超宽屏铺满） */
.compare-charts {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-bottom: 8px;
}
.compare-chart-card {
  flex: 1 1 0;
  min-width: 380px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--el-bg-color-overlay, #fff);
}
.compare-chart-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-color-primary);
}
.compare-chart-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.chart-cell {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 8px;
  background: var(--el-bg-color, #fff);
}
.chart-cell-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
</style>
