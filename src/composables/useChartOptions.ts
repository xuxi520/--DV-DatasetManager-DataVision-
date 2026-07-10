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

/**
 * 由统计结果派生各 ECharts 图表配置（随主题自动切换配色）。
 * @param datasetStats 统计聚合结果
 */
export function useChartOptions(datasetStats: ComputedRef<DatasetStats>) {
  const { isDark } = useTheme()

  const chartColors = computed<ChartColors>(() => {
    const dark = isDark.value
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
  })

  const classChartOption = computed<EChartsOption | null>(() => {
    const cls = datasetStats.value.classes
    if (!cls.length) return null
    const top = cls.slice(0, 30)
    const c = chartColors.value
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
  })

  const splitChartOption = computed<EChartsOption | null>(() =>
    datasetStats.value.splits.length ? pieOption(datasetStats.value.splits, chartColors.value) : null
  )
  const typeChartOption = computed<EChartsOption | null>(() =>
    datasetStats.value.types.length ? pieOption(datasetStats.value.types, chartColors.value) : null
  )
  const resolutionChartOption = computed<EChartsOption | null>(() =>
    datasetStats.value.resolutions.length ? barOption(datasetStats.value.resolutions, '图片数', chartColors.value) : null
  )
  const aspectChartOption = computed<EChartsOption | null>(() =>
    datasetStats.value.aspect.length ? pieOption(datasetStats.value.aspect, chartColors.value) : null
  )
  const sizeChartOption = computed<EChartsOption | null>(() =>
    datasetStats.value.sizes.length ? barOption(datasetStats.value.sizes, '图片数', chartColors.value) : null
  )
  const boxSizeChartOption = computed<EChartsOption | null>(() => {
    const items = datasetStats.value.boxSizes
    if (!items.length || items.every((i) => i.count === 0)) return null
    return pieOption(items, chartColors.value)
  })

  return {
    chartColors,
    classChartOption,
    splitChartOption,
    typeChartOption,
    resolutionChartOption,
    aspectChartOption,
    sizeChartOption,
    boxSizeChartOption,
  }
}
