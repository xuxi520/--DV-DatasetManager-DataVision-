<template>
  <div class="al-view">
    <div class="al-toolbar">
      <div class="tool-row">
        <span class="tool-label">{{ t('al.dataset') }}</span>
        <el-select v-model="selectedDsId" size="default" :placeholder="t('al.selDataset')" class="ds-select">
          <el-option v-for="ds in datasets" :key="ds.id" :label="ds.name" :value="ds.id" />
        </el-select>

        <el-button type="primary" :disabled="!selectedDs" @click="pickFile">
          <el-icon><Upload /></el-icon>&nbsp;{{ t('al.importModel') }}
        </el-button>
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          style="display: none"
          @change="onFileChange"
        />

        <el-button text :disabled="!set" @click="clearImport">{{ t('al.clear') }}</el-button>

        <el-button
          v-if="env === 'browser'"
          type="primary"
          plain
          :disabled="!set"
          :title="t('al.backupTitle')"
          @click="backupAlState"
        >
          <el-icon><Download /></el-icon>&nbsp;{{ t('al.backup') }}
        </el-button>

        <span class="tool-meta" v-if="set">
          {{ t('al.imported', { n: set.predictions.size, d: totalDetections, u: unmatched }) }}
        </span>
        <span class="tool-meta al-persist" v-if="alPersistNote">{{ alPersistNote }}</span>
      </div>

      <div class="tool-row" v-if="set">
        <span class="tool-label">{{ t('al.lowThr') }}</span>
        <el-slider v-model="confThreshold" :min="0" :max="1" :step="0.05" class="thr-slider" />
        <span class="thr-val">{{ confThreshold.toFixed(2) }}</span>

        <span class="tool-label">{{ t('al.hardThr') }}</span>
        <el-slider v-model="hardThreshold" :min="0" :max="1" :step="0.05" class="thr-slider" />
        <span class="thr-val">{{ hardThreshold.toFixed(2) }}</span>

        <el-checkbox v-model="useOutlier" :disabled="computingOutlier" @change="onOutlierToggle">
          {{ t('al.useOutlier') }}
        </el-checkbox>
        <el-button
          size="small"
          :loading="computingOutlier"
          :disabled="!selectedDs || computingOutlier"
          @click="ensureOutlier"
        >
          {{ t('al.computeOutlier') }}
        </el-button>

        <el-button-group class="export-group">
          <el-button size="small" :disabled="!flagged.length" @click="exportJson">
            <el-icon><Document /></el-icon> JSON
          </el-button>
          <el-button size="small" :disabled="!flagged.length" @click="exportCsv">
            <el-icon><Tickets /></el-icon> CSV
          </el-button>
        </el-button-group>
      </div>

      <el-progress
        v-if="computingOutlier"
        :percentage="outlierPct"
        :format="() => `${embed.progress.value.processed}/${embed.progress.value.total}`"
        class="al-progress"
      />
      <p class="al-status" v-if="status">{{ status }}</p>
      <p class="al-hint" v-if="set">
        {{ t('al.hint') }}
      </p>
    </div>

    <el-empty v-if="!set" :description="t('al.emptyDesc')" />
    <el-empty v-else-if="flagged.length === 0" :description="t('al.emptyFlagged', { n: set.predictions.size })" />
    <div v-else class="al-body">
      <div class="al-summary">
        {{ t('al.hit') }}<b>{{ flagged.length }}</b>{{ t('al.summaryTail', { l: lowCount, h: hardCount }) }}
        <span class="al-processed">{{ t('al.processed', { p: processedCount, t: flagged.length }) }}</span>
      </div>
      <div class="al-grid">
        <div
          class="al-cell"
          v-for="s in flagged"
          :key="s.sampleId"
          @click="selectPreview(s.sampleId)"
          :class="{ active: previewId === s.sampleId }"
        >
          <img v-if="thumbUrl(s.sampleId)" :src="thumbUrl(s.sampleId)" class="thumb" />
          <div v-else class="thumb thumb-empty"></div>
          <div class="al-meta">
            <div class="al-name" :title="s.imagePath">{{ baseName(s.imagePath) }}</div>
            <div class="al-scores">
              <span v-if="s.confMin != null" class="tag" :class="s.lowConfidence ? 'warn' : 'ok'">
                {{ t('al.conf') }} {{ (s.confMin * 100).toFixed(0) }}%
              </span>
              <span class="tag hard" :class="s.hard ? 'warn' : 'ok'">
                {{ t('al.diff') }} {{ (s.hardScore * 100).toFixed(0) }}
              </span>
              <span
                class="rs-badge"
                :class="statusMeta(s.sampleId).cls"
                title="点击切换复核状态"
                @click.stop="cycleStatus(s.sampleId)"
                >{{ statusMeta(s.sampleId).label }}</span
              >
            </div>
          </div>
        </div>
      </div>

      <div class="al-preview" v-if="previewId && thumbUrl(previewId)">
        <img :src="thumbUrl(previewId)" class="preview-img" />
        <div class="preview-name">{{ previewName }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload, Document, Tickets, Download } from '@element-plus/icons-vue'
import { useViewerState } from '../composables/useViewerState'
import { useActiveLearning } from '../activeLearning/useActiveLearning'
import { importPredictionsJson } from '../activeLearning/importPredictions'
import { serializeAlState, downloadAlState } from '../activeLearning/persistence'
import { useEmbeddings } from '../embed/useEmbeddings'
import { runAnalysisCached } from '../embed/analysisRunner'
import { getFileBytes } from '../dedup/fileOps'
import { downloadJSON, downloadText } from '../dedup/report'
import { env } from '../env'
import { normSlash, baseName } from '../dataset/importers/shared'
import type { ActiveLearningScore, PredictionSet, ReviewStatus } from '../activeLearning/types'
import type { CanonicalDataset } from '../dataset/types'
import type { DataSet } from '../types'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const { datasets } = useViewerState()
const al = useActiveLearning()
const embed = useEmbeddings()

const { confThreshold, hardThreshold } = al

const selectedDsId = ref<string>('')
const selectedDs = computed<DataSet | undefined>(() =>
  datasets.value.find((d) => d.id === selectedDsId.value),
)
const fileInput = ref<HTMLInputElement | null>(null)

const set = computed<PredictionSet | undefined>(() => al.getPredictions(selectedDsId.value))
const totalDetections = ref(0)
const unmatched = ref(0)

const useOutlier = ref(false)
const outlierScores = ref<Map<string, number>>(new Map())
const computingOutlier = ref(false)
const status = ref('')
const outlierPct = computed(() =>
  Math.round((embed.progress.value.processed / Math.max(1, embed.progress.value.total)) * 100),
)

function canonical(ds: DataSet | undefined): CanonicalDataset | undefined {
  return ds?.canonical
}

/** 按样本 id 评分（结合可选离群度） */
const scores = computed<ActiveLearningScore[]>(() => {
  const s = set.value
  const ds = canonical(selectedDs.value)
  if (!s || !ds) return []
  return al.score(s, ds, { outlierScores: useOutlier.value ? outlierScores.value : undefined })
})

const flagged = computed(() =>
  scores.value
    .filter((x) => x.lowConfidence || x.hard)
    .sort((a, b) => b.hardScore - a.hardScore),
)
const lowCount = computed(() => flagged.value.filter((x) => x.lowConfidence).length)
const hardCount = computed(() => flagged.value.filter((x) => x.hard).length)

/* ---------- 复核状态（持久化的工作流标记，独立于真值标注） ---------- */
const REVIEW_CYCLE: ReviewStatus[] = ['pending', 'reviewed', 'accepted', 'rejected', 'labeled', 'exported']
const REVIEW_META = computed<Record<ReviewStatus, { label: string; cls: string }>>(() => ({
  pending: { label: t('al.rvPending'), cls: 'rs-pending' },
  reviewed: { label: t('al.rvReviewed'), cls: 'rs-reviewed' },
  accepted: { label: t('al.rvAccepted'), cls: 'rs-accepted' },
  rejected: { label: t('al.rvRejected'), cls: 'rs-rejected' },
  labeled: { label: t('al.rvLabeled'), cls: 'rs-labeled' },
  exported: { label: t('al.rvExported'), cls: 'rs-exported' },
}))
/** 点击切换单样本复核状态，并落盘 */
function cycleStatus(sampleId: string) {
  const cur = al.getReviewStatus(selectedDsId.value, sampleId)
  const idx = REVIEW_CYCLE.indexOf(cur)
  const next = REVIEW_CYCLE[(idx + 1) % REVIEW_CYCLE.length]
  al.setReviewStatus(selectedDsId.value, sampleId, next)
  const ds = selectedDs.value
  if (ds) void al.persist(ds)
}
function statusMeta(sampleId: string) {
  return REVIEW_META.value[al.getReviewStatus(selectedDsId.value, sampleId)]
}
const processedCount = computed(
  () =>
    flagged.value.filter((x) => al.getReviewStatus(selectedDsId.value, x.sampleId) !== 'pending').length,
)

/* ---------- 跨会话持久化恢复 ---------- */
const alPersistNote = ref('')
async function restoreAl() {
  const ds = selectedDs.value
  if (!ds) return
  const ok = await al.loadPersisted(ds)
  alPersistNote.value = ok
    ? t('al.restored', { n: al.getPredictions(ds.id)?.predictions.size ?? 0 })
    : ''
}
onMounted(() => void restoreAl())

/* ---------- 导入 ---------- */
function pickFile() {
  fileInput.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const ds = canonical(selectedDs.value)
  if (!ds) {
    ElMessage.warning(t('al.msgSelectDs'))
    return
  }
  try {
    const text = await (file as File).text()
    const { set: ps, unmatched: um, totalDetections: td } = importPredictionsJson(text, ds, file.name)
    if (ps.predictions.size === 0) {
      ElMessage.warning(t('al.msgNoAlign'))
      return
    }
    al.setPredictions(selectedDsId.value, ps)
    totalDetections.value = td
    unmatched.value = um
    outlierScores.value = new Map()
    useOutlier.value = false
    status.value = t('al.statusImported', { n: ps.predictions.size, u: um })
    if (um > 0) ElMessage.warning(t('al.msgUnmatched', { u: um }))
    else ElMessage.success(t('al.msgImported', { n: ps.predictions.size }))
    const dataset = selectedDs.value
    if (dataset) void al.persist(dataset)
  } catch (err: any) {
    ElMessage.error(t('al.msgParseFail', { err: String(err?.message || err) }))
  }
}

async function clearImport() {
  if (selectedDsId.value) al.clear(selectedDsId.value)
  outlierScores.value = new Map()
  useOutlier.value = false
  status.value = ''
  const ds = selectedDs.value
  if (ds) await al.persist(ds)
}

/* ---------- 嵌入离群（复用特征 + 离群检测） ---------- */
function fileToSample(ds: DataSet): Map<string, string> {
  const m = new Map<string, string>()
  const c = ds.canonical
  if (!c) return m
  for (const f of ds.fileList) {
    const s = c.samples.find((x) => normSlash(x.sourcePath) === normSlash(f.path))
    if (s) m.set(f.id, s.id)
  }
  return m
}

async function ensureOutlier() {
  const ds = selectedDs.value
  const c = canonical(ds)
  if (!ds || !c) return
  computingOutlier.value = true
  status.value = t('al.statusOutlier')
  try {
    if (embed.count.value === 0) {
      await embed.compute(ds.fileList)
    }
    const pts = await embed.analysisPoints()
    if (pts.length < 2) {
      ElMessage.warning(t('al.msgFewFeat'))
      useOutlier.value = false
      return
    }
    const { scores: sc } = await runAnalysisCached(
      `${ds.id}|pca|${embed.version.value}`,
      pts.map((p) => p.vec),
      'pca',
      5,
    )
    const f2s = fileToSample(ds)
    const map = new Map<string, number>()
    pts.forEach((p, i) => {
      const sid = f2s.get(p.fileId)
      if (sid) map.set(sid, sc[i])
    })
    outlierScores.value = map
    status.value = t('al.statusOutlierDone', { n: map.size })
    ElMessage.success(t('al.msgOutlierDone'))
  } catch (err: any) {
    ElMessage.error(t('al.msgOutlierFail', { err: String(err?.message || err) }))
    useOutlier.value = false
  } finally {
    computingOutlier.value = false
  }
}

function onOutlierToggle(val: boolean | string | number) {
  if (val && outlierScores.value.size === 0) void ensureOutlier()
}

/* ---------- 缩略图 ---------- */
const thumbs = ref<Map<string, string>>(new Map())
function imageFileOf(sampleId: string) {
  const ds = selectedDs.value
  const c = ds?.canonical
  if (!ds || !c) return undefined
  const s = c.samples.find((x) => x.id === sampleId)
  if (!s) return undefined
  return ds.fileList.find((f) => normSlash(f.path) === normSlash(s.sourcePath))
}
async function ensureThumb(sampleId: string) {
  if (thumbs.value.has(sampleId)) return
  const f = imageFileOf(sampleId)
  if (!f) return
  try {
    const bytes = await getFileBytes(f)
    const url = URL.createObjectURL(new Blob([bytes]))
    const next = new Map(thumbs.value)
    next.set(sampleId, url)
    thumbs.value = next
  } catch {
    /* 忽略单图失败 */
  }
}
function thumbUrl(sampleId: string): string | undefined {
  return thumbs.value.get(sampleId)
}

const previewId = ref<string>('')
const previewName = computed(() => {
  const s = flagged.value.find((x) => x.sampleId === previewId.value)
  return s ? s.imagePath : ''
})
async function selectPreview(sampleId: string) {
  previewId.value = sampleId
  await ensureThumb(sampleId)
}

/* ---------- 导出待标注队列 ---------- */
function buildQueue(): Record<string, unknown>[] {
  return flagged.value.map((s) => ({
    imagePath: s.imagePath,
    sampleId: s.sampleId,
    confMin: s.confMin,
    confMean: s.confMean,
    confMax: s.confMax,
    hardScore: Number(s.hardScore.toFixed(4)),
    lowConfidence: s.lowConfidence,
    hard: s.hard,
  }))
}
function exportJson() {
  const dsName = selectedDs.value?.name ?? 'dataset'
  const safe = (dsName || 'dataset').replace(/[^\\w一-龥.-]+/g, '_')
  // 回写复核状态：导出的难样本标记为「已导出」
  const dsId = selectedDsId.value
  al.markExported(
    dsId,
    flagged.value.map((s) => s.sampleId),
  )
  const ds = selectedDs.value
  if (ds) void al.persist(ds)
  void downloadJSON(`active-learning-${safe}-${Date.now()}.json`, {
    dataset: dsName,
    generatedAt: new Date().toISOString(),
    confThreshold: confThreshold.value,
    hardThreshold: hardThreshold.value,
    count: flagged.value.length,
    queue: buildQueue(),
  })
}
function exportCsv() {
  const header = 'imagePath,sampleId,confMin,confMean,confMax,hardScore,lowConfidence,hard'
  const rows = buildQueue().map((r) =>
    [r.imagePath, r.sampleId, r.confMin, r.confMean, r.confMax, r.hardScore, r.lowConfidence, r.hard].join(','),
  )
  // 回写复核状态：导出的难样本标记为「已导出」
  const dsId = selectedDsId.value
  al.markExported(
    dsId,
    flagged.value.map((s) => s.sampleId),
  )
  const ds = selectedDs.value
  if (ds) void al.persist(ds)
  const dsName = selectedDs.value?.name ?? 'dataset'
  const safe = (dsName || 'dataset').replace(/[^\\w一-龥.-]+/g, '_')
  void downloadText(`active-learning-${safe}-${Date.now()}.csv`, [header, ...rows].join('\n'), 'text/csv')
}

/* ---------- 浏览器端冷备份：下载 AL 状态快照（与 Tauri 侧车同构） ---------- */
function backupAlState() {
  const ds = selectedDs.value
  const set = al.getPredictions(selectedDsId.value)
  if (!ds || !set || set.predictions.size === 0) {
    ElMessage.warning(t('al.msgNoBackup'))
    return
  }
  const rs =
    al.reviewStatus.value.get(selectedDsId.value) ?? new Map<string, ReviewStatus>()
  const state = serializeAlState(set, ds, rs, {
    confThreshold: confThreshold.value,
    hardThreshold: hardThreshold.value,
  })
  downloadAlState(state)
  ElMessage.success(t('al.msgBackup'))
}

/* 切换数据集：清空缩略图与预览，并尝试恢复该数据集的持久化预测覆盖层 */
watch(selectedDsId, () => {
  for (const url of thumbs.value.values()) URL.revokeObjectURL(url)
  thumbs.value = new Map()
  previewId.value = ''
  status.value = ''
  void restoreAl()
})
</script>

<style scoped>
.al-view {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 4px 18px 14px;
  overflow: auto;
  box-sizing: border-box;
}
.al-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
.thr-slider {
  width: 140px;
}
.thr-val {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  min-width: 34px;
}
.export-group {
  margin-left: 8px;
}
.al-progress {
  max-width: 520px;
}
.al-status {
  margin: 0;
  font-size: 12px;
  color: var(--el-color-primary);
}
.al-hint {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  padding: 6px 10px;
  border-radius: 6px;
}
.tool-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.al-persist {
  color: var(--el-color-success);
}
.al-processed {
  margin-left: 4px;
  color: var(--el-color-primary);
}
.rs-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.rs-pending {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}
.rs-reviewed {
  background: var(--el-color-info-light-9);
  color: var(--el-color-info);
}
.rs-accepted {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.rs-rejected {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.rs-labeled {
  background: #f3e8ff;
  color: #8e44ad;
}
.rs-exported {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}
.al-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.al-summary {
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.al-summary b {
  color: var(--el-color-danger);
}
.al-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}
.al-cell {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  cursor: pointer;
}
.al-cell.active,
.al-cell:hover {
  border-color: var(--el-color-primary);
}
.al-cell .thumb {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--el-border-color);
  background: #000;
}
.thumb-empty {
  background: var(--el-fill-color-light);
}
.al-meta {
  min-width: 0;
}
.al-name {
  font-size: 12px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 6px;
}
.al-scores {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
}
.tag.ok {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.tag.warn {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.al-preview {
  margin-top: 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 8px;
  text-align: center;
  width: 320px;
}
.preview-img {
  width: 100%;
  max-height: 280px;
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
</style>
