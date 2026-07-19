<template>
  <div class="similarity-view">
    <el-tabs v-model="activeTab" class="sim-tabs">
      <!-- 相似检索 -->
      <el-tab-pane :label="t('sim.searchTab')" name="search">
        <div class="sim-toolbar">
          <div class="tool-row">
            <span class="tool-label">{{ t('sim.dataset') }}</span>
            <el-select v-model="selectedDsId" size="default" :placeholder="t('sim.dsPlaceholder')" class="ds-select">
              <el-option v-for="ds in datasets" :key="ds.id" :label="ds.name" :value="ds.id" />
            </el-select>

            <el-button
              type="primary"
              :loading="embed.running.value"
              :disabled="!selectedDs || embed.running.value"
              @click="onCompute"
            >
              <el-icon><Cpu /></el-icon>&nbsp;{{ t('sim.computeFeatures') }}
            </el-button>

            <span class="tool-meta" v-if="selectedDs">
              {{ t('sim.featured', { n: embed.count.value }) }}
            </span>

            <el-tag
              v-if="embed.backend.value"
              size="small"
              :type="embed.backend.value.ep === 'webgpu' ? 'success' : 'info'"
              effect="plain"
            >
              {{ backendLabel }}
            </el-tag>

            <el-tag
              v-if="embed.searchMode.value"
              size="small"
              :type="embed.searchMode.value === 'ann' ? 'warning' : 'info'"
              effect="plain"
            >
              {{ embed.searchMode.value === 'ann' ? t('sim.modeAnn') : t('sim.modeBrute') }}
            </el-tag>

            <el-button-group class="topk-group">
              <span class="tool-label">{{ t('sim.return') }}</span>
              <el-input-number v-model="topK" :min="1" :max="50" size="small" controls-position="right" />
              <span class="tool-label">{{ t('sim.zhang') }}</span>
            </el-button-group>

            <el-button :disabled="!selectedDs || embed.running.value" @click="onFind" type="success">
              <el-icon><Search /></el-icon>&nbsp;{{ t('sim.findSimilar') }}
            </el-button>

            <el-button text @click="embed.reset()" :disabled="embed.running.value">{{ t('sim.reset') }}</el-button>

            <el-button-group class="export-group">
              <el-button size="small" :disabled="!hasReport" @click="exportSimilarityHtml">
                <el-icon><Document /></el-icon> HTML
              </el-button>
              <el-button size="small" :disabled="!hasReport" @click="exportSimilarityPdf">
                <el-icon><Printer /></el-icon> PDF
              </el-button>
            </el-button-group>

            <el-popover placement="bottom-end" :width="280" trigger="click">
              <template #reference>
                <el-button text :disabled="embed.running.value">
                  <el-icon><Setting /></el-icon>&nbsp;{{ t('sim.inferSettings') }}
                </el-button>
              </template>
              <div class="embed-settings">
                <div class="set-row">
                  <span class="set-label">{{ t('sim.preferWebGPU') }}</span>
                  <el-switch v-model="cfg.preferWebGPU" @change="onCfgChange" />
                </div>
                <div class="set-row">
                  <span class="set-label">{{ t('sim.wasmThreads') }}</span>
                  <el-select
                    v-model="cfg.wasmThreads"
                    size="small"
                    style="width: 96px"
                    @change="onCfgChange"
                  >
                    <el-option :value="1" :label="t('sim.t1')" />
                    <el-option :value="2" :label="t('sim.t2')" />
                    <el-option :value="4" :label="t('sim.t4')" />
                  </el-select>
                </div>
                <p class="set-hint">{{ t('sim.threadHint') }}</p>
              </div>
            </el-popover>
          </div>

          <el-progress
            v-if="embed.running.value"
            :percentage="pct"
            :format="() => `${embed.progress.value.processed}/${embed.progress.value.total}`"
            class="sim-progress"
          />
          <p class="sim-status" v-if="embed.status.value && embed.running.value">{{ embed.status.value }}</p>
        </div>

        <div class="query-row" v-if="selectedDs">
          <span class="tool-label">{{ t('sim.queryImage') }}</span>
          <el-select
            v-model="queryFileId"
            size="default"
            :placeholder="t('sim.queryPlaceholder')"
            class="query-select"
            filterable
          >
            <el-option
              v-for="f in embeddableFiles"
              :key="f.id"
              :label="f.name"
              :value="f.id"
            />
          </el-select>
          <span class="hint" v-if="embeddableFiles.length === 0">{{ t('sim.hintComputeFeatures') }}</span>
        </div>

        <div class="sim-body" v-if="results.length">
          <div class="result-query">
            <img v-if="queryUrl" :src="queryUrl" class="thumb" />
            <div class="query-caption">{{ t('sim.queryImage') }}</div>
          </div>
          <div class="result-grid">
            <div class="result-cell" v-for="h in results" :key="h.md5">
              <img v-if="thumbUrl(h.fileId)" :src="thumbUrl(h.fileId)" class="thumb" />
              <div class="score-bar">
                <div class="score-fill" :style="{ width: scorePct(h.score) + '%' }"></div>
              </div>
              <div class="score-text">{{ (h.score * 100).toFixed(1) }}%</div>
            </div>
          </div>
        </div>

        <el-empty v-else-if="selectedDs && embeddableFiles.length" :description="t('sim.emptySelectQuery')" />
        <el-empty v-else-if="selectedDs" :description="t('sim.emptyComputeFirst')" />
      </el-tab-pane>

      <!-- 降维 & 离群 -->
      <el-tab-pane :label="t('sim.reduceTab')" name="analysis">
        <div class="analysis-toolbar">
          <span class="tool-label">{{ t('sim.method') }}</span>
          <el-radio-group v-model="reduceMethod" size="small" :disabled="analyzing || embed.running.value">
            <el-radio-button label="pca">PCA</el-radio-button>
            <el-radio-button label="umap">UMAP</el-radio-button>
          </el-radio-group>
          <el-button type="primary" :loading="analyzing" :disabled="!selectedDs || analyzing || embed.running.value" @click="onAnalyze">
            <el-icon><DataAnalysis /></el-icon>&nbsp;{{ t('sim.analyze') }}
          </el-button>
          <span class="tool-meta" v-if="analysis.length">
            {{ t('sim.pointsOutliers', { n: analysis.length, m: outlierCount }) }}
          </span>
          <el-button text @click="clearAnalysis" :disabled="analyzing || !analysis.length">{{ t('sim.clear') }}</el-button>
          <el-button-group class="export-group">
            <el-button size="small" :disabled="!hasReport" @click="exportSimilarityHtml">
              <el-icon><Document /></el-icon> HTML
            </el-button>
            <el-button size="small" :disabled="!hasReport" @click="exportSimilarityPdf">
              <el-icon><Printer /></el-icon> PDF
            </el-button>
          </el-button-group>
        </div>

        <el-empty
          v-if="!analysis.length"
          :description="t('sim.emptyAnalyze')"
        />
        <div v-else class="analysis-body">
          <div class="scatter-wrap">
            <ChartPanel :option="scatterOption" height="460px" @item-click="onScatterClick" />
            <div class="scatter-legend">
              <span class="dot normal"></span> {{ t('sim.normal') }}
              <span class="dot outlier"></span> {{ t('sim.outlierTop') }}
            </div>
          </div>
          <div class="analysis-side">
            <div class="preview-box" v-if="previewFileId && thumbUrl(previewFileId)">
              <img :src="thumbUrl(previewFileId)" class="preview-img" />
              <div class="preview-name">{{ fileNameOf(previewFileId) }}</div>
            </div>
            <h4 class="side-title">{{ t('sim.outlierTopTitle', { n: Math.min(20, topOutliers.length) }) }}</h4>
            <div class="outlier-list">
              <div
                class="outlier-cell"
                v-for="o in topOutliers"
                :key="o.fileId"
                @click="selectPreview(o.fileId)"
              >
                <img v-if="thumbUrl(o.fileId)" :src="thumbUrl(o.fileId)" class="thumb" />
                <div class="outlier-meta">
                  <div class="outlier-name">{{ fileNameOf(o.fileId) }}</div>
                  <div class="outlier-score">{{ t('sim.outlierScore', { s: (o.score * 100).toFixed(1) }) }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onUnmounted, watch } from 'vue'
import { Cpu, Search, DataAnalysis, Setting, Document, Printer } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { EChartsOption } from 'echarts'
import { useViewerState } from '../composables/useViewerState'
import { useEmbeddings, destroyEmbedWorker } from '../embed/useEmbeddings'
import { getEmbedConfig, setEmbedConfig } from '../embed/embedConfig'
import { runAnalysisCached } from '../embed/analysisRunner'
import { getFileBytes } from '../dedup/fileOps'
import { generateReportHtml, downloadReportHtml, printReportHtml, escapeHtml } from '../report/reportHtml'
import type { ImageFile, DataSet } from '../types'
import ChartPanel from './ChartPanel.vue'
import { useI18n } from 'vue-i18n'

interface AnalysisPoint {
  fileId: string
  md5: string
  x: number
  y: number
  score: number
  outlier: boolean
}

const { datasets } = useViewerState()
const embed = useEmbeddings()
const { t } = useI18n()

/** 推理运行时配置（响应式绑定到设置面板），持久化于 localStorage */
const cfg = reactive(getEmbedConfig())

/** 设置变更：写回持久化；未在计算中则销毁旧 Worker 池，下次计算以新配置重建 */
function onCfgChange() {
  setEmbedConfig({ preferWebGPU: cfg.preferWebGPU, wasmThreads: cfg.wasmThreads })
  if (!embed.running.value) destroyEmbedWorker()
}

/** 实际推理后端展示文本 */
const backendLabel = computed(() => {
  const b = embed.backend.value
  if (!b) return ''
  if (b.ep === 'webgpu') return t('sim.webgpuAccel')
  return t('sim.wasmCpu', { n: b.threads })
})

const selectedDsId = ref<string>('')
const selectedDs = computed<DataSet | undefined>(() =>
  datasets.value.find((d) => d.id === selectedDsId.value),
)
const topK = ref(12)
const queryFileId = ref<string>('')
const results = ref<{ fileId: string; md5: string; score: number }[]>([])
const activeTab = ref<'search' | 'analysis'>('search')

/** 已特征化的文件（供查询图下拉，依赖 embed.version 刷新） */
const embeddableFiles = computed<ImageFile[]>(() => {
  void embed.version.value
  const ds = selectedDs.value
  if (!ds) return []
  return ds.fileList.filter((f) => embed.hasEmbedding(f.id))
})

const pct = computed(() =>
  Math.round(
    (embed.progress.value.processed / Math.max(1, embed.progress.value.total)) * 100,
  ),
)

/** 是否有可导出的内容（相似结果或离群分析任一存在） */
const hasReport = computed(() => results.value.length > 0 || analysis.value.length > 0)

/** 构建相似 / 离群的统一 HTML 报告（复用通用报表模块） */
function buildSimilarityReportHtml(): string {
  const dsName = selectedDs.value?.name ?? t('sim.noDataset')
  const cards = [
    { n: dsName, l: t('sim.dataset') },
    { n: results.value.length, l: t('sim.rSimilar') },
    { n: analysis.value.length, l: t('sim.rPoints') },
    { n: outlierCount.value, l: t('sim.rOutlier'), warn: true },
  ]
  const simRows = results.value.map((h, i) => {
    const name = fileNameOf(h.fileId)
    return `<tr><td class="num">${i + 1}</td><td>${escapeHtml(name)}</td><td class="num">${(h.score * 100).toFixed(1)}%</td></tr>`
  })
  const outRows = topOutliers.value.map((o, i) => {
    const name = fileNameOf(o.fileId)
    return `<tr><td class="num">${i + 1}</td><td>${escapeHtml(name)}</td><td class="num">${(o.score * 100).toFixed(1)}</td></tr>`
  })
  const sections: {
    caption: string
    headers: string[]
    rows: string[]
    emptyHint: string
  }[] = []
  if (results.value.length) {
    sections.push({
      caption: t('sim.rSimCaption', { q: queryFileId.value ? escapeHtml(fileNameOf(queryFileId.value)) : '—' }),
      headers: [t('sim.hRank'), t('sim.hFileName'), t('sim.hSimilarity')],
      rows: simRows,
      emptyHint: t('sim.rEmptySim'),
    })
  }
  if (analysis.value.length) {
    sections.push({
      caption: t('sim.rOutlierCaption', { n: topOutliers.value.length }),
      headers: [t('sim.hRank'), t('sim.hFileName'), t('sim.hOutlierScore')],
      rows: outRows,
      emptyHint: t('sim.rEmptyOutlier'),
    })
  }
  return generateReportHtml({
    title: t('sim.reportTitle'),
    subtitle: t('sim.reportSubtitle', { name: dsName }),
    summaryCards: cards,
    sections,
  })
}

function exportSimilarityHtml() {
  if (!hasReport.value) {
    ElMessage.warning(t('sim.msgNoContent'))
    return
  }
  const html = buildSimilarityReportHtml()
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  void downloadReportHtml(`similarity-report-${ts}.html`, html)
}

function exportSimilarityPdf() {
  if (!hasReport.value) {
    ElMessage.warning(t('sim.msgNoContent'))
    return
  }
  printReportHtml(buildSimilarityReportHtml())
}

// 缩略图：fileId -> object URL（响应式 Map，生成后驱动重渲染）
const thumbs = ref<Map<string, string>>(new Map())
async function ensureThumb(fileId: string): Promise<void> {
  if (thumbs.value.has(fileId)) return
  const ds = selectedDs.value
  const file = ds?.files.get(fileId)
  if (!file) return
  try {
    const bytes = await getFileBytes(file)
    const url = URL.createObjectURL(new Blob([bytes]))
    const next = new Map(thumbs.value)
    next.set(fileId, url)
    thumbs.value = next
  } catch {
    /* 单图失败忽略 */
  }
}
function thumbUrl(fileId: string): string | undefined {
  return thumbs.value.get(fileId)
}

const queryUrl = computed(() =>
  queryFileId.value ? thumbs.value.get(queryFileId.value) : undefined,
)

function scorePct(s: number): number {
  return Math.max(0, Math.min(100, Math.round(s * 100)))
}

function fileNameOf(fileId: string): string {
  return selectedDs.value?.files.get(fileId)?.name ?? fileId
}

/* ---------- 相似检索 ---------- */
async function onCompute() {
  const ds = selectedDs.value
  if (!ds) return
  await embed.compute(ds.fileList)
  if (!queryFileId.value && embeddableFiles.value.length) {
    queryFileId.value = embeddableFiles.value[0].id
    await ensureThumb(queryFileId.value)
  }
}

async function onFind() {
  if (!queryFileId.value) return
  results.value = await embed.findSimilar(queryFileId.value, topK.value)
  await Promise.all(results.value.map((r) => ensureThumb(r.fileId)))
}

/* ---------- 降维 & 离群 ---------- */
const reduceMethod = ref<'pca' | 'umap'>('pca')
const analyzing = ref(false)
const analysis = ref<AnalysisPoint[]>([])
const previewFileId = ref<string>('')

const outlierCount = computed(() => analysis.value.filter((p) => p.outlier).length)
const topOutliers = computed(() =>
  [...analysis.value].sort((a, b) => b.score - a.score).slice(0, 20),
)

const scatterOption = computed<EChartsOption>(() => {
  const data = analysis.value.map((p) => ({
    value: [p.x, p.y],
    name: fileNameOf(p.fileId),
    itemStyle: { color: p.outlier ? '#F56C6C' : '#4D9BFF' },
  }))
  return {
    tooltip: { trigger: 'item', formatter: (pp: any) => (pp?.name ?? '') as string },
    grid: { left: 48, right: 16, top: 16, bottom: 36 },
    xAxis: {
      type: 'value',
      scale: true,
      name: 'dim-1',
      axisLabel: { color: '#888' },
      nameTextStyle: { color: '#888' },
    },
    yAxis: {
      type: 'value',
      scale: true,
      name: 'dim-2',
      axisLabel: { color: '#888' },
      nameTextStyle: { color: '#888' },
    },
    series: [
      {
        type: 'scatter',
        data,
        symbolSize: 11,
        emphasis: { focus: 'self' },
      },
    ],
  }
})

async function onAnalyze() {
  if (analyzing.value) return
  const pts = await embed.analysisPoints()
  if (pts.length < 2) {
    ElMessage.warning(t('sim.msgFewFeat'))
    return
  }
  analyzing.value = true
  try {
    // 缓存键：数据集 + 方法 + 特征版本。特征重算（version 变化）或切数据集即失效。
    const cacheKey = `${selectedDsId.value}|${reduceMethod.value}|${embed.version.value}`
    // 降维 + 离群度放到后台 Worker 计算，避免几千张图时主线程被堵死（界面卡死）；
    // 命中缓存（切换 PCA/UMAP 或重复点分析）则免 Worker 重算、直接秒回。
    const { coords, scores, cached } = await runAnalysisCached(
      cacheKey,
      pts.map((p) => p.vec),
      reduceMethod.value,
      5,
    )
    if (cached) ElMessage.success(t('sim.cacheHit'))
    // 取分数前 5%（至少 1 个）标记为离群
    const sorted = [...scores].sort((a, b) => b - a)
    const thrIdx = Math.max(0, Math.floor(sorted.length * 0.05) - 1)
    const thr = sorted[thrIdx] ?? sorted[0]
    analysis.value = pts.map((p, i) => ({
      fileId: p.fileId,
      md5: p.md5,
      x: coords[i][0],
      y: coords[i][1],
      score: scores[i],
      outlier: scores[i] >= thr,
    }))
    // 散点图只画坐标、不需要缩略图；只有「离群 Top N」列表与预览区要缩略图，
    // 因此仅对少量项生成，避免一次性对全部 N 张并发读字节 + 建 object URL 卡住主线程。
    const shown = topOutliers.value
    await Promise.all(shown.map((o) => ensureThumb(o.fileId)))
    if (shown.length) selectPreview(shown[0].fileId)
  } catch (err: any) {
    ElMessage.error(t('sim.msgAnalyzeFail', { err: String(err?.message || err) }))
  } finally {
    analyzing.value = false
  }
}

function clearAnalysis() {
  analysis.value = []
  previewFileId.value = ''
}

function onScatterClick(idx: number) {
  const p = analysis.value[idx]
  if (p) selectPreview(p.fileId)
}

function selectPreview(fileId: string) {
  previewFileId.value = fileId
  void ensureThumb(fileId)
}

// 切换数据集时清空查询选择与结果 & 分析
watch(selectedDsId, () => {
  queryFileId.value = ''
  results.value = []
  clearAnalysis()
})

watch(queryFileId, (id) => {
  if (id) void ensureThumb(id)
})

onUnmounted(() => {
  for (const url of thumbs.value.values()) URL.revokeObjectURL(url)
  thumbs.value.clear()
})
</script>

<style scoped>
.similarity-view {
  /* 父级 .viewer-main 为横向 flex 容器，这里必须 flex:1 + min-width:0
     才能占满整块主内容区，否则内容会按自身宽度收缩、全挤在左侧 */
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 4px 18px 14px;
  overflow: auto;
  box-sizing: border-box;
}
.sim-tabs {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
}
/* 让 tab 内容区撑满，空态/结果得以在整块区域内展开 */
.sim-tabs :deep(.el-tabs__content) {
  flex: 1;
}
.sim-tabs :deep(.el-tab-pane) {
  height: 100%;
}
/* 空态在内容区内垂直居中，避免大片留白显得内容堆在顶部 */
.sim-tabs :deep(.el-empty) {
  padding-top: 8vh;
}
.sim-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.tool-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.tool-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}
.ds-select {
  width: 220px;
}
.tool-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.topk-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.export-group {
  margin-left: 8px;
}
.sim-progress {
  max-width: 520px;
}
.sim-status {
  margin: 0;
  font-size: 12px;
  color: var(--el-color-primary);
}
/* 推理设置弹出框 */
.embed-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.set-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.set-label {
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.set-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.query-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.query-select {
  width: 320px;
}
.hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.sim-body {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}
.result-query {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 180px;
}
.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
  flex: 1;
}
.result-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.thumb {
  width: 100%;
  height: 140px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--el-border-color);
  background: #000;
}
.query-caption {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
.score-bar {
  height: 5px;
  background: var(--el-border-color-lighter);
  border-radius: 3px;
  overflow: hidden;
}
.score-fill {
  height: 100%;
  background: linear-gradient(90deg, #4d9bff, #2d6fe6);
}
.score-text {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  text-align: right;
}
/* 降维 & 离群 */
.analysis-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.analysis-body {
  display: flex;
  gap: 18px;
  align-items: flex-start;
}
.scatter-wrap {
  flex: 1;
  min-width: 0;
}
.scatter-legend {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-left: 8px;
}
.dot.normal {
  background: #4d9bff;
}
.dot.outlier {
  background: #f56c6c;
}
.analysis-side {
  width: 280px;
  flex-shrink: 0;
}
.preview-box {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 12px;
  text-align: center;
}
.preview-img {
  width: 100%;
  height: 160px;
  object-fit: contain;
  background: #000;
  border-radius: 4px;
}
.preview-name {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 6px;
  word-break: break-all;
}
.side-title {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.outlier-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 360px;
  overflow: auto;
}
.outlier-cell {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  cursor: pointer;
}
.outlier-cell:hover {
  border-color: var(--el-color-primary);
}
.outlier-cell .thumb {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
}
.outlier-meta {
  min-width: 0;
}
.outlier-name {
  font-size: 12px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.outlier-score {
  font-size: 11px;
  color: var(--el-color-danger);
}
</style>
