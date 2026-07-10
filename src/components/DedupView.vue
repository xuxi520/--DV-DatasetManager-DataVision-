<template>
  <div class="dedup-view">
    <!-- 顶部标题栏 -->
    <header class="dedup-header">
      <div class="header-left">
        <h2 class="dedup-title">
          <el-icon :size="20"><Cpu /></el-icon>
          重复分析
        </h2>
        <el-tag size="small" :type="env === 'tauri' ? 'success' : 'info'">
          {{ envLabel }}
        </el-tag>
      </div>
      <div class="header-right">
        <el-button size="small" @click="loadDataset" :loading="loadingDataset" type="primary">
          <el-icon><FolderAdd /></el-icon> 加载数据集
        </el-button>
        <el-button size="small" @click="exportIndex" :disabled="!index" v-if="dataset">
          <el-icon><Upload /></el-icon> 导出索引
        </el-button>
        <el-button size="small" @click="triggerImportIndex" v-if="dataset">
          <el-icon><Download /></el-icon> 导入索引
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

    <!-- 未加载数据集 -->
    <div v-if="!dataset && !analyzing" class="empty-state">
      <el-empty description="请先加载数据集，再进行重复 / 脏数据检测">
        <el-button type="primary" @click="loadDataset" :loading="loadingDataset">
          <el-icon><FolderAdd /></el-icon> 加载数据集
        </el-button>
      </el-empty>
    </div>

    <template v-else>
      <!-- 配置卡片 -->
      <div class="config-card" v-if="!analyzing && !result">
        <div class="config-row">
          <span class="config-label">去重强度</span>
          <el-radio-group v-model="options.strength" size="default">
            <el-radio-button
              v-for="s in strengthList"
              :key="s.key"
              :value="s.key"
              :title="s.description"
            >
              {{ s.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <p class="config-desc">{{ currentPreset.description }}</p>

        <div class="config-row">
          <span class="config-label">选项</span>
          <div class="config-options">
            <el-switch v-model="options.separateSplits" active-text="train/val/test 不交叉" />
            <el-switch v-model="options.detectDirty" active-text="脏数据同步检测" />
            <el-switch v-model="options.incremental" active-text="增量模式" :disabled="!baseIndex" />
          </div>
        </div>

        <div class="config-row" v-if="options.detectDirty">
          <span class="config-label">离群阈值</span>
          <el-slider
            v-model="options.outlierThreshold"
            :min="20"
            :max="48"
            :step="1"
            show-input
            style="width: 320px"
          />
          <span class="config-hint">与最近邻的最小汉明距离 &gt; 该值视为离群（异常/卡通/无关）</span>
        </div>

        <div class="config-row" v-if="options.incremental && baseIndex">
          <el-alert type="success" :closable="false" show-icon>
            已载入索引（{{ Object.keys(baseIndex).length }} 条），仅计算新增文件并与之比对。
          </el-alert>
        </div>

        <div class="action-row">
          <el-button type="primary" size="large" @click="startAnalysis" :disabled="!dataset">
            <el-icon><Cpu /></el-icon> 开始分析
          </el-button>
          <span class="config-hint">
            文件数：{{ dataset?.fileList.length || 0 }}
          </span>
        </div>
      </div>

      <!-- 进度 -->
      <div class="progress-card" v-if="analyzing">
        <h3>正在分析：{{ status }}</h3>
        <el-progress :percentage="progress" :stroke-width="14" />
        <el-button class="mt-2" size="small" @click="cancel = true">取消</el-button>
      </div>

      <!-- 结果 -->
      <div class="result-area" v-if="result && !analyzing">
        <!-- 统计 -->
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-num">{{ result.total }}</div>
            <div class="stat-label">总文件</div>
          </div>
          <div class="stat-item danger">
            <div class="stat-num">{{ result.stats.exactDuplicates }}</div>
            <div class="stat-label">精确重复组</div>
          </div>
          <div class="stat-item warn">
            <div class="stat-num">{{ result.stats.nearDuplicates }}</div>
            <div class="stat-label">近似重复组</div>
          </div>
          <div class="stat-item purple">
            <div class="stat-num">{{ result.stats.dirtyInvalid + result.stats.dirtyOutlier }}</div>
            <div class="stat-label">脏数据</div>
          </div>
          <div class="stat-item danger">
            <div class="stat-num">{{ removablePathsComputed.length }}</div>
            <div class="stat-label">可移除（当前选择）</div>
          </div>
          <div class="stat-item">
            <div class="stat-num">{{ (result.stats.reducedRatio * 100).toFixed(1) }}%</div>
            <div class="stat-label">默认缩减比</div>
          </div>
        </div>

        <el-alert
          v-if="result.failed.length"
          type="warning"
          :closable="false"
          class="mt-2"
          :title="`${result.failed.length} 个文件解码失败（已计入脏数据）`"
        />

        <!-- Tab -->
        <el-tabs v-model="activeTab" class="result-tabs">
          <el-tab-pane name="groups">
            <template #label>
              重复分组 <el-badge :value="result.groups.length" :max="999" type="danger" />
            </template>

            <div v-if="result.groups.length === 0" class="empty-hint">
              <el-empty description="未发现重复文件 🎉" />
            </div>

            <div v-for="g in result.groups" :key="g.id" class="group-card">
              <div class="group-head">
                <el-tag size="small" v-if="g.split !== 'unknown'">{{ g.split }}</el-tag>
                <el-tag size="small" type="info" v-if="g.category">{{ g.category }}</el-tag>
                <el-tag size="small" type="danger" v-if="g.exact">精确重复</el-tag>
                <el-tag size="small" type="warning" v-else>近似 (距离 {{ g.minDistance }})</el-tag>
                <el-tag size="small" type="warning" v-if="g.duplicateOfExternal">与已有索引重复</el-tag>
                <span class="group-meta">{{ g.files.length }} 张</span>
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
                    <el-tag size="small" type="success" v-if="keepIdFor(g) === f.id">保留</el-tag>
                    <el-tag size="small" type="danger" v-else>移除</el-tag>
                  </div>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane name="dirty">
            <template #label>
              脏数据 <el-badge :value="result.dirty.length" :max="999" type="warning" />
            </template>

            <div v-if="result.dirty.length === 0" class="empty-hint">
              <el-empty description="未检测到明显脏数据" />
            </div>

            <div class="dirty-grid">
              <div v-for="(d, i) in result.dirty" :key="i" class="dirty-card">
                <div class="dirty-info">
                  <el-tag size="small" :type="d.kind === 'invalid' ? 'danger' : 'warning'">
                    {{ d.kind === 'invalid' ? '无效图' : '异常/离群' }}
                  </el-tag>
                  <div class="dirty-name">{{ d.file.name }}</div>
                  <div class="dirty-reason">{{ d.reason }}</div>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane name="overview">
            <template #label>保留 / 移除概览</template>
            <div class="overview">
              <el-alert type="info" :closable="false">
                当前选择下将移除 <b>{{ removablePathsComputed.length }}</b> 个文件，保留
                <b>{{ keepPathsComputed.length }}</b> 个。
              </el-alert>
              <h4 class="mt-2">将移除的文件（{{ removablePathsComputed.length }}）</h4>
              <div class="path-list">
                <div v-for="p in removablePathsComputed" :key="p" class="path-item remove">
                  <el-icon><Close /></el-icon> {{ p }}
                </div>
                <div v-if="removablePathsComputed.length === 0" class="empty-hint">无</div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>

        <!-- 操作栏 -->
        <div class="action-bar">
          <el-button type="danger" @click="onDelete" :disabled="removablePathsComputed.length === 0">
            <el-icon><Delete /></el-icon>
            {{ env === 'tauri' ? '执行删除（移至回收站）' : '下载删除清单' }}
          </el-button>
          <el-button @click="downloadManifest" :disabled="removablePathsComputed.length === 0">
            <el-icon><DocumentCopy /></el-icon> 下载清单
          </el-button>
          <el-button @click="resetAnalysis">
            <el-icon><RefreshLeft /></el-icon> 重新分析
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
  Close, RefreshLeft,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { env } from '../env'
import { loadDatasetCanonical } from '../dataset/loadCanonical'
import { runDedup } from '../dedup/analyze'
import { STRENGTH_LIST } from '../dedup/strength'
import { destroyHashWorker } from '../dedup/hashEngine'
import { deleteFiles } from '../dedup/fileOps'
import {
  buildManifest, buildDeleteScript, downloadJSON, downloadText, downloadHashIndex,
} from '../dedup/report'
import type { DataSet, ImageFile } from '../types'
import type { DedupOptions, DedupResult, HashIndex, DuplicateGroup, SplitKey } from '../dedup/types'

const dataset = ref<DataSet | null>(null)
const loadingDataset = ref(false)
const analyzing = ref(false)
const progress = ref(0)
const status = ref('')
const cancel = ref(false)

const result = ref<DedupResult | null>(null)
const index = ref<HashIndex | null>(null)
const baseIndex = ref<HashIndex | null>(null)
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
const envLabel = computed(() => (env === 'tauri' ? '桌面端 (Tauri)' : '浏览器'))
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
  if (!dataset.value) return []
  const all = dataset.value.fileList.map((f) => f.path)
  return all.filter((p) => !removablePathsComputed.value.includes(p))
})

async function loadDataset() {
  try {
    loadingDataset.value = true
    const { dataset: ds } = await loadDatasetCanonical((c, t, s) => {
      status.value = s
      progress.value = Math.round((c / t) * 100)
    })
    dataset.value = ds
    result.value = null
    for (const k in keepOverrides) delete keepOverrides[k]
    if (ds.fileList.length > 0) {
      ElMessage.success(`已加载 ${ds.fileList.length} 张图片`)
    }
  } catch (e: any) {
    if (e?.message !== '用户取消选择') ElMessage.error('加载失败：' + e?.message)
  } finally {
    loadingDataset.value = false
  }
}

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
  if (!dataset.value) return
  analyzing.value = true
  progress.value = 0
  cancel.value = false
  result.value = null
  for (const k in keepOverrides) delete keepOverrides[k]

  const ds = dataset.value
  // 从 canonical 取权威 split，使去重能精确回答「删的是哪个子集」
  const splitOf: ((file: ImageFile) => SplitKey) | undefined = ds.canonical
    ? (file: ImageFile): SplitKey => {
        const s = ds.canonical!.samples.find((x) => x.id === file.id)
        return (s?.split ?? 'unknown') as SplitKey
      }
    : undefined

  try {
    const { result: res, index: idx } = await runDedup(
      ds.fileList,
      { ...options, splitOf },
      {
        onHashProgress: (p, t) => {
          progress.value = Math.round((p / t) * 100)
        },
        onStatus: (s) => {
          status.value = s
        },
        shouldCancel: () => cancel.value,
        baseIndex: options.incremental ? baseIndex.value || undefined : undefined,
      }
    )
    index.value = idx
    result.value = res
    if (res.groups.length > 0 || res.dirty.length > 0) {
      ElMessage.success(
        `分析完成：重复组 ${res.groups.length}，脏数据 ${res.dirty.length}`
      )
    } else {
      ElMessage.success('分析完成，未发现重复或脏数据')
    }
  } catch (e: any) {
    ElMessage.error('分析失败：' + e?.message)
  } finally {
    analyzing.value = false
  }
}

function resetAnalysis() {
  result.value = null
  for (const k in keepOverrides) delete keepOverrides[k]
}

function downloadManifest() {
  if (!result.value || !dataset.value) return
  const manifest = buildManifest(result.value, dataset.value.name, envLabel.value)
  downloadJSON(`dedup-manifest-${Date.now()}.json`, manifest)
  const paths = removablePathsComputed.value
  downloadText(`dedup-delete-${Date.now()}.bat`, buildDeleteScript(paths, 'win'))
  downloadText(`dedup-delete-${Date.now()}.sh`, buildDeleteScript(paths, 'unix'))
  ElMessage.success('已下载删除清单与脚本')
}

async function onDelete() {
  const paths = removablePathsComputed.value
  if (paths.length === 0) {
    ElMessage.info('没有可删除的文件')
    return
  }

  if (env === 'browser') {
    downloadManifest()
    ElMessage.warning('浏览器环境无法真正删除文件，已下载清单与脚本，请手动执行')
    return
  }

  try {
    await ElMessageBox.confirm(
      `将把 ${paths.length} 个文件移入各自目录下的 .dedup_trash 回收站（可逆），确定继续？`,
      '执行删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  const res = await deleteFiles(paths)
  if (res.error) {
    ElMessage.error('删除失败：' + res.error)
    return
  }
  if (dataset.value) {
    const removed = new Set(res.removed)
    dataset.value.fileList = dataset.value.fileList.filter((f) => !removed.has(f.path))
  }
  result.value = null
  for (const k in keepOverrides) delete keepOverrides[k]
  ElMessage.success(`已删除 ${res.removed.length} 个文件（可在 .dedup_trash 目录找回）`)
}

function exportIndex() {
  if (index.value && dataset.value) {
    downloadHashIndex(index.value, dataset.value.name)
    ElMessage.success('哈希索引已导出（可用于下次增量分析）')
  }
}

function triggerImportIndex() {
  indexInput.value?.click()
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
      options.incremental = true
      ElMessage.success(`已导入索引（${Object.keys(parsed).length} 条），已开启增量模式`)
    } catch {
      ElMessage.error('索引文件解析失败')
    }
  }
  reader.readAsText(file)
  input.value = ''
}

onUnmounted(() => {
  destroyHashWorker()
})
</script>
