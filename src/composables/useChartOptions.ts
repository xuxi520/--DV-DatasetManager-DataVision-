import { computed, type ComputedRef } from 'vue'
import type { EChartsOption } from 'echarts'
import { useTheme } from './useTheme'
import type { DatasetStats, StatsBarItem } from './useDatasetStats'

type ChartColors = {
  text: string
  textStrong: string
  axisLine: string
  splitLine: string
  tooltipBg: string
  tooltipBorder: string
  legend: string
  label: string
  pieBorder: string
}

function pieOption(items: StatsBarItem[], c: ChartColors): EChartsOption {
  return {
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)',
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.textStrong },
    },
    legend: { bottom: 0, type: 'scroll', textStyle: { fontSize: 11, color: c.legend } },
    series: [{
      type: 'pie',
      radius: ['42%', '70%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 4, borderColor: c.pieBorder, borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{c}', fontSize: 11, color: c.label },
      data: items.map((it) => ({ name: it.label, value: it.count, itemStyle: { color: it.color } })),
    }],
  }
}

function barOption(items: StatsBarItem[], name: string, c: ChartColors): EChartsOption {
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.textStrong },
    },
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: items.map((i) => i.label),
      axisLabel: { fontSize: 11, color: c.text },
      axisLine: { lineStyle: { color: c.axisLine } },
    },
    yAxis: {
      type: 'value',
      name,
      nameTextStyle: { fontSize: 11, color: c.text },
      axisLabel: { color: c.text },
      axisLine: { show: true, lineStyle: { color: c.axisLine } },
      splitLine: { lineStyle: { color: c.splitLine } },
    },
    series: [{
      type: 'bar',
      data: items.map((i) => ({ value: i.count, itemStyle: { color: i.color || '#409eff' } })),
      barMaxWidth: 36,
      label: { show: true, position: 'top', fontSize: 11, color: c.label },
    }],
  }
}

/** 单份统计对应的全套图表配置 */
export interface ChartOptionSet {
  classChartOption: EChartsOption | null
  splitChartOption: EChartsOption | null
  typeChartOption: EChartsOption | null
  resolutionChartOption: EChartsOption | null
  aspectChartOption: EChartsOption | null
  sizeChartOption: EChartsOption | null
  boxSizeChartOption: EChartsOption | null
  overlapPieOption: EChartsOption | null
  iouHistogramOption: EChartsOption | null
}

function buildChartColors(dark: boolean): ChartColors {
  return {
    text: dark ? '#A3A6AD' : '#606266',
    textStrong: dark ? '#E5EAF3' : '#303133',
    axisLine: dark ? '#43484D' : '#DCDFE6',
    splitLine: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
    tooltipBg: dark ? '#1D1E1F' : '#FFFFFF',
    tooltipBorder: dark ? '#43484D' : '#EBEEF5',
    legend: dark ? '#A3A6AD' : '#606266',
    label: dark ? '#E5EAF3' : '#303133',
    pieBorder: dark ? '#1D1E1F' : '#FFFFFF',
  }
}

/**
 * 由统计结果派生各 ECharts 图表配置（随主题自动切换配色）。纯函数，便于多数据集对比时逐个生成。
 * @param stats 统计聚合结果
 * @param c 主题配色
 */
export function buildChartOptions(stats: DatasetStats, c: ChartColors): ChartOptionSet {
  const classChartOption: EChartsOption | null = (() => {
    const cls = stats.classes
    if (!cls.length) return null
    const top = cls.slice(0, 30)
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: c.tooltipBg,
        borderColor: c.tooltipBorder,
        textStyle: { color: c.textStrong },
      },
      grid: { left: 8, right: 28, top: 16, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        name: '标注数',
        nameTextStyle: { color: c.text },
        axisLabel: { color: c.text },
        axisLine: { lineStyle: { color: c.axisLine } },
        splitLine: { lineStyle: { color: c.splitLine } },
      },
      yAxis: {
        type: 'category',
        data: top.map((c2) => c2.name).reverse(),
        axisLabel: { width: 130, overflow: 'truncate', fontSize: 11, color: c.text },
        axisLine: { lineStyle: { color: c.axisLine } },
      },
      series: [{
        type: 'bar',
        data: top.map((c2) => ({ value: c2.annCount, itemStyle: { color: c2.color } })).reverse(),
        barMaxWidth: 18,
        label: { show: true, position: 'right', fontSize: 11, color: c.label },
      }],
    }
  })()

  const splitChartOption = stats.splits.length ? pieOption(stats.splits, c) : null
  const typeChartOption = stats.types.length ? pieOption(stats.types, c) : null
  const resolutionChartOption = stats.resolutions.length ? barOption(stats.resolutions, '图片数', c) : null
  const aspectChartOption = stats.aspect.length ? pieOption(stats.aspect, c) : null
  const sizeChartOption = stats.sizes.length ? barOption(stats.sizes, '图片数', c) : null
  const boxSizeChartOption = (() => {
    const items = stats.boxSizes
    if (!items.length || items.every((i) => i.count === 0)) return null
    return pieOption(items, c)
  })()

  // 重叠框分布（有重叠 / 无重叠）
  const overlapPieOption = (() => {
    const ann = stats.annotatedImages
    const ov = stats.overlapImages
    if (ann === 0) return null
    const items: StatsBarItem[] = [
      { label: '有重叠', count: ov, pct: 0, color: '#f56c6c' },
      { label: '无重叠', count: ann - ov, pct: 0, color: '#67c23a' },
    ]
    return pieOption(items, c)
  })()

  // 图片最大 IoU 分布直方图
  const iouHistogramOption = (() => {
    const items = stats.iouBuckets
    if (!items.length || items.every((i) => i.count === 0)) return null
    return barOption(items, '图片数', c)
  })()

  return {
    classChartOption,
    splitChartOption,
    typeChartOption,
    resolutionChartOption,
    aspectChartOption,
    sizeChartOption,
    boxSizeChartOption,
    overlapPieOption,
    iouHistogramOption,
  }
}

/** 概览模式：单个统计结果的图表配置（响应式） */
export function useChartOptions(datasetStats: ComputedRef<DatasetStats>) {
  const { isDark } = useTheme()
  const chartColors = computed<ChartColors>(() => buildChartColors(isDark.value))
  const all = computed(() => buildChartOptions(datasetStats.value, chartColors.value))
  const classChartOption = computed(() => all.value.classChartOption)
  const splitChartOption = computed(() => all.value.splitChartOption)
  const typeChartOption = computed(() => all.value.typeChartOption)
  const resolutionChartOption = computed(() => all.value.resolutionChartOption)
  const aspectChartOption = computed(() => all.value.aspectChartOption)
  const sizeChartOption = computed(() => all.value.sizeChartOption)
  const boxSizeChartOption = computed(() => all.value.boxSizeChartOption)
  const overlapPieOption = computed(() => all.value.overlapPieOption)
  const iouHistogramOption = computed(() => all.value.iouHistogramOption)
  return {
    chartColors,
    classChartOption,
    splitChartOption,
    typeChartOption,
    resolutionChartOption,
    aspectChartOption,
    sizeChartOption,
    boxSizeChartOption,
    overlapPieOption,
    iouHistogramOption,
  }
}

/** 对比模式：为每个数据集分别生成一套图表配置（响应式） */
export function useMultiChartOptions(statsList: ComputedRef<DatasetStats[]>) {
  const { isDark } = useTheme()
  const chartColors = computed<ChartColors>(() => buildChartColors(isDark.value))
  const sets = computed(() =>
    statsList.value.map((stats) => ({ stats, charts: buildChartOptions(stats, chartColors.value) })),
  )
  return { chartColors, sets }
}
