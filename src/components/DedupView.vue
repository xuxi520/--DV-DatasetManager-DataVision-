<template>
  <div class="dedup-view">
    <!-- 顶部标题栏 -->
    <header class="dedup-header">
      <div class="header-left">
        <h2 class="dedup-title">
          <el-icon :size="20"><Cpu /></el-icon>
          {{ t('dedup.title') }}
        </h2>
        <el-tag size="small" :type="env === 'tauri' ? 'success' : 'info'">
          {{ envLabel }}
        </el-tag>
      </div>
      <div class="header-right">
        <!-- 复用浏览工作台已加载的数据集（与预览/统计/相似共享，不再独立加载） -->
        <el-select
          v-model="targetDatasetId"
          size="small"
          class="dedup-ds-select"
          :placeholder="t('dedup.dsPlaceholder')"
        >
          <el-option :label="t('dedup.allLoaded')" value="__all__" />
          <el-option v-for="ds in datasets" :key="ds.id" :label="ds.name" :value="ds.id" />
        </el-select>
        <el-button size="small" @click="exportIndex" :disabled="!index" v-if="targetFiles.length">
          <el-icon><Upload /></el-icon> {{ t('dedup.exportIndex') }}
        </el-button>
        <el-button size="small" @click="triggerImportIndex" v-if="targetFiles.length">
          <el-icon><Download /></el-icon> {{ t('dedup.importIndex') }}
        </el-button>
        <input
          ref="indexInput"
          type="file"
          accept="application/json"
          style="display: none"
          @change="onIndexFile"
        />
      </div>
    </header>

    <!-- 未加载任何数据集 -->
    <div v-if="datasets.length === 0" class="empty-state">
      <el-empty :description="t('dedup.emptyLoad')">
        <el-button type="primary" :disabled="!capabilities.canPickDirectory" @click="handleLoadDataset()">
          <el-icon><FolderAdd /></el-icon> {{ t('dedup.loadData') }}
        </el-button>
      </el-empty>
    </div>

    <template v-else>
      <!-- 配置卡片 -->
      <div class="config-card" v-if="!analyzing && !result">
        <div class="config-row">
          <span class="config-label">{{ t('dedup.strength') }}</span>
          <el-radio-group v-model="options.strength" size="default">
            <el-radio-button
              v-for="s in strengthList"
              :key="s.key"
              :value="s.key"
              :title="s.description"
            >
              {{ t(s.label) }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <p class="config-desc">{{ t(currentPreset.description) }}</p>

        <div class="config-row">
          <span class="config-label">{{ t('dedup.options') }}</span>
          <div class="config-options">
            <el-switch v-model="options.separateSplits" :active-text="t('dedup.sepSplits')" />
            <el-switch v-model="options.detectDirty" :active-text="t('dedup.detectDirty')" />
            <el-switch v-model="options.incremental" :active-text="t('dedup.incremental')" :disabled="!baseIndex" />
            <template v-if="baseIndex">
              <span class="idx-note">{{ t('dedup.idxRetained', { n: Object.keys(baseIndex).length }) }}</span>
              <el-button link type="info" size="small" @click="clearBaseIndex">{{ t('dedup.clearAll') }}</el-button>
            </template>
          </div>
        </div>

        <div class="config-row" v-if="options.detectDirty">
          <span class="config-label">{{ t('dedup.outlierThr') }}</span>
          <el-slider
            v-model="options.outlierThreshold"
            :min="20"
            :max="48"
            :step="1"
            show-input
            style="width: 320px"
          />
          <span class="config-hint">{{ t('dedup.outlierHint') }}</span>
        </div>

        <div class="config-row" v-if="options.incremental && baseIndex">
          <el-alert type="success" :closable="false" show-icon>
            {{ baseIndexSource === 'import' ? t('dedup.importedIdx') : t('dedup.retainedIdx') }}{{ t('dedup.idxCompare', { n: Object.keys(baseIndex).length }) }}
          </el-alert>
        </div>

        <div class="action-row">
          <el-button type="primary" size="large" @click="startAnalysis" :disabled="targetFiles.length === 0">
            <el-icon><Cpu /></el-icon> {{ t('dedup.start') }}
          </el-button>
          <span class="config-hint">
            {{ t('dedup.fileCount', { n: targetFiles.length }) }}
          </span>
        </div>
      </div>

      <!-- 进度 -->
      <div class="progress-card" v-if="analyzing">
        <h3>{{ t('dedup.analyzing', { s: status }) }}</h3>
        <el-progress :percentage="progress" :stroke-width="14" />
        <p class="progress-cache-hint" v-if="cacheHits > 0">{{ t('dedup.cacheHits', { n: cacheHits }) }}</p>
        <el-button class="mt-2" size="small" @click="cancel = true">{{ t('dedup.cancel') }}</el-button>
      </div>

      <!-- 结果 -->
      <div class="result-area" v-if="result && !analyzing">
        <!-- 统计 -->
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-num">{{ result.total }}</div>
            <div class="stat-label">{{ t('dedup.statTotal') }}</div>
          </div>
          <div class="stat-item danger">
            <div class="stat-num">{{ result.stats.exactDuplicates }}</div>
            <div class="stat-label">{{ t('dedup.statExact') }}</div>
          </div>
          <div class="stat-item warn">
            <div class="stat-num">{{ result.stats.nearDuplicates }}</div>
            <div class="stat-label">{{ t('dedup.statNear') }}</div>
          </div>
          <div class="stat-item purple">
            <div class="stat-num">{{ result.stats.dirtyInvalid + result.stats.dirtyOutlier }}</div>
            <div class="stat-label">{{ t('dedup.statDirty') }}</div>
          </div>
          <div class="stat-item danger">
            <div class="stat-num">{{ removablePathsComputed.length }}</div>
            <div class="stat-label">{{ t('dedup.statRemovable') }}</div>
          </div>
          <div class="stat-item">
            <div class="stat-num">{{ (result.stats.reducedRatio * 100).toFixed(1) }}%</div>
            <div class="stat-label">{{ t('dedup.statRatio') }}</div>
          </div>
        </div>

        <el-alert
          v-if="result.failed.length"
          type="warning"
          :closable="false"
          class="mt-2"
          :title="t('dedup.failedTitle', { n: result.failed.length })"
        />

        <!-- Tab -->
        <el-tabs v-model="activeTab" class="result-tabs">
          <el-tab-pane name="groups">
            <template #label>
              {{ t('dedup.tabGroups') }} <el-badge :value="result.groups.length" :max="999" type="danger" />
            </template>

            <div v-if="result.groups.length === 0" class="empty-hint">
              <el-empty :description="t('dedup.emptyGroups')" />
            </div>

            <div v-for="g in result.groups" :key="g.id" class="group-card">
              <div class="group-head">
                <el-tag size="small" v-if="g.split !== 'unknown'">{{ g.split }}</el-tag>
                <el-tag size="small" type="info" v-if="g.category">{{ g.category }}</el-tag>
                <el-tag size="small" type="danger" v-if="g.exact">{{ t('dedup.exactDup') }}</el-tag>
                <el-tag size="small" type="warning" v-else>{{ t('dedup.nearDup', { d: g.minDistance }) }}</el-tag>
                <el-tag size="small" type="warning" v-if="g.duplicateOfExternal">{{ t('dedup.dupExternal') }}</el-tag>
                <span class="group-meta">{{ t('dedup.zhang', { n: g.files.length }) }}</span>
              </div>
              <div class="group-files">
                <div
                  v-for="f in g.files"
                  :key="f.id"
                  class="group-file"
                  :class="{ keep: keepIdFor(g) === f.id, remove: keepIdFor(g) !== f.id }"
                  @click="toggleKeep(g, f.id)"
                >
                  <div class="gf-name">{{ f.name }}</div>
                  <div class="gf-badge">
                    <el-tag size="small" type="success" v-if="keepIdFor(g) === f.id">{{ t('dedup.keep') }}</el-tag>
                    <el-tag size="small" type="danger" v-else>{{ t('dedup.remove') }}</el-tag>
                  </div>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane name="dirty">
            <template #label>
              {{ t('dedup.tabDirty') }} <el-badge :value="result.dirty.length" :max="999" type="warning" />
            </template>

            <div v-if="result.dirty.length === 0" class="empty-hint">
              <el-empty :description="t('dedup.emptyDirty')" />
            </div>

            <div class="dirty-grid">
              <div v-for="(d, i) in result.dirty" :key="i" class="dirty-card">
                <div class="dirty-info">
                  <el-tag size="small" :type="d.kind === 'invalid' ? 'danger' : 'warning'">
                    {{ d.kind === 'invalid' ? t('dedup.invalidImg') : t('dedup.outlierImg') }}
                  </el-tag>
                  <div class="dirty-name">{{ d.file.name }}</div>
                  <div class="dirty-reason">{{ d.reason }}</div>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane name="overview">
            <template #label>{{ t('dedup.tabOverview') }}</template>
            <div class="overview">
              <el-alert type="info" :closable="false">
                {{ t('dedup.overviewAlert', { r: removablePathsComputed.length, k: keepPathsComputed.length }) }}
              </el-alert>
              <h4 class="mt-2">{{ t('dedup.removeTitle', { n: removablePathsComputed.length }) }}</h4>
              <div class="path-list">
                <div v-for="p in removablePathsComputed" :key="p" class="path-item remove">
                  <el-icon><Close /></el-icon> {{ p }}
                </div>
                <div v-if="removablePathsComputed.length === 0" class="empty-hint">{{ t('dedup.none') }}</div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>

        <!-- 操作栏 -->
        <div class="action-bar">
          <el-button type="danger" @click="onDelete" :disabled="removablePathsComputed.length === 0">
            <el-icon><Delete /></el-icon>
            {{ env === 'tauri' ? t('dedup.execDelete') : t('dedup.downloadList') }}
          </el-button>
          <el-button @click="downloadManifest" :disabled="removablePathsComputed.length === 0">
            <el-icon><DocumentCopy /></el-icon> {{ t('dedup.downloadManifest') }}
          </el-button>
          <el-button @click="exportReportHtml" :disabled="!result">
            <el-icon><Document /></el-icon> {{ t('dedup.exportReport', { fmt: 'HTML' }) }}
          </el-button>
          <el-button @click="exportReportPdf" :disabled="!result">
            <el-icon><Printer /></el-icon> {{ t('dedup.exportReport', { fmt: 'PDF' }) }}
          </el-button>
          <el-button @click="resetAnalysis">
            <el-icon><RefreshLeft /></el-icon> {{ t('dedup.reanalyze') }}
          </el-button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onUnmounted } from 'vue'
import {
  Cpu, FolderAdd, Upload, Download, Delete, DocumentCopy,
  Close, RefreshLeft, Document, Printer,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { env } from '../env'
import { capabilities } from '../capabilities'
import { runDedup } from '../dedup/analyze'
import { STRENGTH_LIST } from '../dedup/strength'
import { detectSplitAndCategory } from '../dedup/splitDetect'
import { destroyHashWorker } from '../dedup/hashEngine'
import { deleteFiles, deriveAnnotationPaths, absJoin } from '../dedup/fileOps'
import {
  buildManifest, buildDeleteScript, downloadJSON, downloadText, downloadHashIndex,
} from '../dedup/report'
import { generateReportHtml, downloadReportHtml, printReportHtml, escapeHtml } from '../report/reportHtml'
import { useViewerState } from '../composables/useViewerState'
import { useI18n } from 'vue-i18n'
import type { DataSet, ImageFile } from '../types'
import type { DedupOptions, DedupResult, HashIndex, DuplicateGroup, SplitKey } from '../dedup/types'

const { datasets, filesForTarget, handleLoadDataset } = useViewerState()
const { t } = useI18n()

/** 目标数据集：'__all__' = 全部已加载数据集（总揽全局）；否则具体数据集 id */
const targetDatasetId = ref<string | null>('__all__')
const selectedDataset = computed<DataSet | undefined>(() =>
  targetDatasetId.value && targetDatasetId.value !== '__all__'
    ? datasets.value.find((d) => d.id === targetDatasetId.value)
    : undefined,
)
const targetFiles = computed<ImageFile[]>(() => filesForTarget(targetDatasetId.value))
const targetName = computed(() =>
  selectedDataset.value ? selectedDataset.value.name : (datasets.value.length ? t('dedup.allLoaded') : ''),
)

const analyzing = ref(false)
const progress = ref(0)
const status = ref('')
/** 去重过程中命中缓存（跳过哈希计算）的文件数 */
const cacheHits = ref(0)
const cancel = ref(false)

const result = ref<DedupResult | null>(null)
const index = ref<HashIndex | null>(null)
const baseIndex = ref<HashIndex | null>(null)
/** 索引来源：'run' = 本次会话运行产出自动留存；'import' = 用户导入文件 */
const baseIndexSource = ref<'none' | 'run' | 'import'>('none')
const indexInput = ref<HTMLInputElement | null>(null)

const options = reactive<DedupOptions>({
  strength: 'standard',
  separateSplits: true,
  detectDirty: true,
  incremental: false,
  outlierThreshold: 30,
  keepOnePerGroup: true,
})

const activeTab = ref<'groups' | 'dirty' | 'overview'>('groups')
const keepOverrides = reactive<Record<string, string>>({})

const strengthList = STRENGTH_LIST
const envLabel = computed(() => (env === 'tauri' ? t('dedup.envTauri') : t('dedup.envBrowser')))
const currentPreset = computed(() => STRENGTH_LIST.find((s) => s.key === options.strength)!)

function keepIdFor(g: DuplicateGroup): string {
  return keepOverrides[g.id] ?? g.keepId
}

function toggleKeep(g: DuplicateGroup, id: string) {
  if (keepIdFor(g) === id) return
  keepOverrides[g.id] = id
}

const removablePathsComputed = computed<string[]>(() => {
  if (!result.value) return []
  const set = new Set<string>()
  for (const g of result.value.groups) {
    const keep = keepIdFor(g)
    for (const f of g.files) {
      if (f.id !== keep) set.add(f.path)
    }
  }
  return Array.from(set)
})

const keepPathsComputed = computed<string[]>(() => {
  const all = targetFiles.value.map((f) => f.path)
  return all.filter((p) => !removablePathsComputed.value.includes(p))
})

function collectResultFiles(): ImageFile[] {
  if (!result.value) return []
  const map = new Map<string, ImageFile>()
  for (const g of result.value.groups) {
    for (const f of g.files) map.set(f.id, f)
  }
  for (const d of result.value.dirty) map.set(d.file.id, d.file)
  return Array.from(map.values())
}

async function startAnalysis() {
  if (targetFiles.value.length === 0) return
  analyzing.value = true
  progress.value = 0
  cacheHits.value = 0
  cancel.value = false
  result.value = null
  for (const k in keepOverrides) delete keepOverrides[k]

  // 跨数据集的权威 split 来源（覆盖从 path 推断），使「全部已加载」也能正确按子集去重
  const splitMap = new Map<string, SplitKey>()
  for (const ds of datasets.value) {
    for (const s of ds.canonical?.samples ?? []) splitMap.set(s.id, s.split)
  }
  const splitOf = (file: ImageFile): SplitKey =>
    splitMap.get(file.id) ?? detectSplitAndCategory(file.path).split

  try {
    const { result: res, index: idx } = await runDedup(
      targetFiles.value,
      { ...options, splitOf },
      {
        onHashProgress: (p, t, c) => {
          progress.value = Math.round((p / t) * 100)
          cacheHits.value = c
        },
        onStatus: (s) => {
          status.value = s
        },
        shouldCancel: () => cancel.value,
        baseIndex: options.incremental ? baseIndex.value || undefined : undefined,
      },
    )
    index.value = idx
    // 自动留存本次索引，使下一次运行可一键「增量模式」（无需手动导出/导入）
    if (idx && Object.keys(idx).length > 0) {
      baseIndex.value = idx
      baseIndexSource.value = 'run'
    }
    result.value = res
    if (res.groups.length > 0 || res.dirty.length > 0) {
      ElMessage.success(
        t('dedup.msgDone', { g: res.groups.length, d: res.dirty.length }),
      )
    } else {
      ElMessage.success(t('dedup.msgDoneNone'))
    }
  } catch (e: any) {
    ElMessage.error(t('dedup.msgFail', { err: e?.message }))
  } finally {
    analyzing.value = false
  }
}

function resetAnalysis() {
  result.value = null
  for (const k in keepOverrides) delete keepOverrides[k]
}

function buildDedupReportHtml(): string {
  const r = result.value
  if (!r) return ''
  const name = targetName.value || t('dedup.defaultName')
  const cards = [
    { n: r.total, l: t('dedup.statTotal') },
    { n: r.stats.exactDuplicates, l: t('dedup.statExact'), warn: true },
    { n: r.stats.nearDuplicates, l: t('dedup.statNear'), warn: true },
    { n: r.stats.dirtyInvalid + r.stats.dirtyOutlier, l: t('dedup.statDirty'), warn: true },
    { n: r.removablePaths.length, l: t('dedup.statRemovableShort'), warn: true },
    { n: (r.stats.reducedRatio * 100).toFixed(1) + '%', l: t('dedup.statRatioShort') },
  ]
  const groupRows = r.groups.map((g, i) => {
    const removeNames = g.files.filter((f) => f.id !== keepIdFor(g)).map((f) => f.name)
    return `<tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(g.split)}</td>
      <td>${escapeHtml(g.category || '—')}</td>
      <td>${g.exact ? t('dedup.exactDup') : t('dedup.nearDup', { d: g.minDistance })}</td>
      <td class="num">${g.files.length}</td>
      <td>${escapeHtml(removeNames.join('、') || '—')}</td>
    </tr>`
  })
  const dirtyRows = r.dirty.map((d) => `<tr>
    <td>${escapeHtml(d.file.name)}</td>
    <td>${d.kind === 'invalid' ? t('dedup.invalidImg') : t('dedup.outlierImg')}</td>
    <td>${escapeHtml(d.reason)}</td>
    <td class="num">${d.minDistance ?? '—'}</td>
  </tr>`)
  return generateReportHtml({
    title: t('dedup.reportTitle'),
    subtitle: t('dedup.reportSubtitle', { name }),
    summaryCards: cards,
    sections: [
      {
        caption: t('dedup.tabGroups'),
        headers: [t('dedup.hNum'), t('dedup.hSplit'), t('dedup.hCategory'), t('dedup.hType'), t('dedup.hFileCount'), t('dedup.hWillRemove')],
        rows: groupRows,
        emptyHint: t('dedup.emptyGroups'),
      },
      {
        caption: t('dedup.tabDirty'),
        headers: [t('dedup.hFileName'), t('dedup.hType'), t('dedup.hReason'), t('dedup.hMinDist')],
        rows: dirtyRows,
        emptyHint: t('dedup.emptyDirty'),
      },
    ],
  })
}

function exportReportHtml() {
  if (!result.value) {
    ElMessage.warning(t('dedup.msgRunFirst'))
    return
  }
  const html = buildDedupReportHtml()
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  void downloadReportHtml(`dedup-report-${ts}.html`, html)
}

function exportReportPdf() {
  if (!result.value) {
    ElMessage.warning(t('dedup.msgRunFirst'))
    return
  }
  printReportHtml(buildDedupReportHtml())
}

function downloadManifest() {
  if (!result.value) return
  const manifest = buildManifest(result.value, targetName.value, envLabel.value)
  void downloadJSON(`dedup-manifest-${Date.now()}.json`, manifest)
  // 同步把标注路径也写进删除脚本，确保手动执行时一并清理
  const ds0 = selectedDataset.value
  const format = ds0?.canonical?.sourceFormat
  const root = ds0?.rootAbsPath
  const relPaths =
    format && format !== 'unknown'
      ? [
          ...removablePathsComputed.value,
          ...removablePathsComputed.value.flatMap((p) => deriveAnnotationPaths(p, format)),
        ]
      : removablePathsComputed.value
  // Tauri 端手动脚本需绝对路径才能定位文件；「全部已加载」无单一 root 时用相对路径
  const paths = root ? relPaths.map((p) => absJoin(root, p)) : relPaths
  void downloadText(`dedup-delete-${Date.now()}.bat`, buildDeleteScript(paths, 'win'))
  void downloadText(`dedup-delete-${Date.now()}.sh`, buildDeleteScript(paths, 'unix'))
  ElMessage.success(t('dedup.msgManifest'))
}

/** 按路径反查所属数据集（「全部已加载」模式下删除需按各自 root 分组处理） */
function datasetForPath(p: string): DataSet | undefined {
  return datasets.value.find((d) => d.fileList.some((f) => f.path === p))
}

async function onDelete() {
  const paths = removablePathsComputed.value
  if (paths.length === 0) {
    ElMessage.info(t('dedup.msgNoDelete'))
    return
  }

  if (env === 'browser') {
    downloadManifest()
    ElMessage.warning(t('dedup.msgBrowserDelete'))
    return
  }

  // 单个数据集：沿用既有逻辑
  if (selectedDataset.value) {
    const ds = selectedDataset.value
    const format = ds.canonical?.sourceFormat
    const root = ds.rootAbsPath
    const labelRoot = ds.labelRootAbsPath
    const annotationFiles = ds.canonical?.annotationFiles
    const cocoHint =
      format === 'coco'
        ? t('dedup.cocoHint', { n: paths.length })
        : t('dedup.genericHint', { n: paths.length })
    try {
      await ElMessageBox.confirm(cocoHint, t('dedup.confirmDelete'), {
        type: 'warning',
        confirmButtonText: t('dedup.confirmBtn'),
        cancelButtonText: t('dedup.cancelBtn'),
      })
    } catch {
      return
    }
    const res = await deleteFiles(paths, format, root, labelRoot, annotationFiles)
    if (res.error) {
      ElMessage.error(t('dedup.msgDeleteFail', { err: res.error }))
      return
    }
    const removed = new Set(res.removed)
    ds.fileList = ds.fileList.filter(
      (f) => !removed.has(f.path) && !(f.absPath && removed.has(f.absPath)),
    )
    afterDelete(res.removed.length, format === 'coco')
    return
  }

  // 「全部已加载」：按各文件所属数据集分组，逐数据集删除（各自 root）
  try {
    await ElMessageBox.confirm(
      t('dedup.allHint', { n: paths.length }),
      t('dedup.confirmDelete'),
      { type: 'warning', confirmButtonText: t('dedup.confirmBtn'), cancelButtonText: t('dedup.cancelBtn') },
    )
  } catch {
    return
  }
  let removedTotal = 0
  const errors: string[] = []
  for (const p of paths) {
    const ds = datasetForPath(p)
    if (!ds) continue
    const format = ds.canonical?.sourceFormat
    const res = await deleteFiles([p], format, ds.rootAbsPath, ds.labelRootAbsPath, ds.canonical?.annotationFiles)
    if (res.error) {
      errors.push(`${p}: ${res.error}`)
      continue
    }
    if (res.removed.length) {
      removedTotal += res.removed.length
      const removed = new Set(res.removed)
      ds.fileList = ds.fileList.filter(
        (f) => !removed.has(f.path) && !(f.absPath && removed.has(f.absPath)),
      )
    }
  }
  if (errors.length) {
    ElMessage.error(t('dedup.msgPartialFail', { err: errors.join('；') }))
    return
  }
  afterDelete(removedTotal, false)
}

function afterDelete(removedCount: number, isCoco: boolean) {
  result.value = null
  for (const k in keepOverrides) delete keepOverrides[k]
  ElMessage.success(
    isCoco
      ? t('dedup.afterCoco', { n: removedCount })
      : t('dedup.afterGeneric', { n: removedCount }),
  )
}

function exportIndex() {
  if (index.value && targetName.value) {
    void downloadHashIndex(index.value, targetName.value)
    ElMessage.success(t('dedup.msgIdxExported'))
  }
}

function triggerImportIndex() {
  indexInput.value?.click()
}

function clearBaseIndex() {
  baseIndex.value = null
  baseIndexSource.value = 'none'
  options.incremental = false
  ElMessage.info(t('dedup.msgCleared'))
}

function onIndexFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result)) as HashIndex
      baseIndex.value = parsed
      baseIndexSource.value = 'import'
      options.incremental = true
      ElMessage.success(t('dedup.msgIdxImported', { n: Object.keys(parsed).length }))
    } catch {
      ElMessage.error(t('dedup.msgIdxParseFail'))
    }
  }
  reader.readAsText(file)
  input.value = ''
}

onUnmounted(() => {
  destroyHashWorker()
})
</script>

<style scoped>
.progress-cache-hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--el-color-success);
}
.idx-note {
  font-size: 13px;
  color: var(--el-color-info);
}
.dedup-ds-select {
  width: 220px;
}
</style>
