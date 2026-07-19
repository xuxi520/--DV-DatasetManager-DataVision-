<template>
  <el-dialog
    v-model="showVersion"
    title="数据集版本 / 迭代间对比"
    width="720px"
    :close-on-click-modal="!versionBusy"
    :show-close="!versionBusy"
  >
    <div class="version-form">
      <!-- 保存当前版本 -->
      <div class="ver-section">
        <div class="ver-title">保存当前为版本</div>
        <div class="ver-save-row">
          <el-input
            v-model="versionLabel"
            placeholder="版本标签，如 v2-增类"
            size="small"
            style="width: 240px"
            :disabled="versionBusy"
            @keyup.enter="saveCurrentVersion"
          />
          <el-button
            type="primary"
            size="small"
            :loading="versionBusy"
            @click="saveCurrentVersion"
          >
            <el-icon><Plus /></el-icon> 保存版本
          </el-button>
          <el-upload
            v-if="env === 'browser'"
            action="#"
            :auto-upload="false"
            :show-file-list="false"
            accept=".json,application/json"
            :on-change="onImportFile"
            style="display: inline-block"
          >
            <el-button size="small">
              <el-icon><Upload /></el-icon> 导入标识文件
            </el-button>
          </el-upload>
        </div>
        <div class="export-hint">
          版本为一份额外清单（<code>dataset.dv.json</code>）：记录类表 / split / 每类标注数 /
          每样本的标注摘要（annHash），不内嵌全量标注。
          <template v-if="env === 'tauri'">
            Tauri 端会同时把最新版本写入数据集根目录作为自标识文件，下次打开即识别。
          </template>
          <template v-else>
            浏览器端版本存于本地 IndexedDB；可「下载标识文件」做便携传递，或「导入」他人/历史的标识文件。
          </template>
        </div>
      </div>

      <!-- 版本列表 -->
      <div class="ver-section">
        <div class="ver-title">已存版本（{{ versionList.length }}）</div>
        <el-table
          v-if="versionList.length"
          :data="versionList"
          size="small"
          max-height="200"
          empty-text="暂无版本"
        >
          <el-table-column prop="label" label="标签" min-width="120" />
          <el-table-column label="时间" min-width="150">
            <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="图 / 标注" min-width="110">
            <template #default="{ row }">
              {{ row.stats.totalSamples }} / {{ row.stats.totalAnnotations }}
            </template>
          </el-table-column>
          <el-table-column prop="sourceFormat" label="格式" min-width="80" />
          <el-table-column label="操作" min-width="130" align="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="onDownload(row)">
                <el-icon><Download /></el-icon>
              </el-button>
              <el-button link type="danger" size="small" @click="onRemove(row)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无版本，先保存一个快照" :image-size="60" />
      </div>

      <!-- 对比 -->
      <div class="ver-section" v-if="versionList.length">
        <div class="ver-title">迭代间 diff</div>
        <div class="ver-diff-row">
          <span class="ver-diff-label">基准（before）</span>
          <el-select v-model="diffBeforeId" size="small" style="width: 220px">
            <el-option
              v-for="v in versionList"
              :key="v.id"
              :label="v.label"
              :value="v.id"
            />
          </el-select>
        </div>
        <div class="ver-diff-row">
          <span class="ver-diff-label">对比（after）</span>
          <el-select v-model="diffAfterId" size="small" style="width: 220px">
            <el-option label="当前工作区" value="current" />
            <el-option
              v-for="v in versionList"
              :key="v.id"
              :label="v.label"
              :value="v.id"
            />
          </el-select>
          <el-button size="small" type="primary" @click="runVersionDiff">
            <el-icon><Sort /></el-icon> 对比
          </el-button>
        </div>
      </div>

      <!-- diff 结果 -->
      <div class="ver-section" v-if="versionDiff">
        <div class="ver-title">
          差异：{{ versionDiff.beforeLabel }} → {{ versionDiff.afterLabel }}
        </div>
        <div class="ver-summary">
          <span class="ver-badge added">新增 {{ versionDiff.summary.added }}</span>
          <span class="ver-badge removed">删除 {{ versionDiff.summary.removed }}</span>
          <span class="ver-badge modified">修改 {{ versionDiff.summary.modified }}</span>
          <span class="ver-badge">类变化 {{ versionDiff.summary.classesChanged }}</span>
          <span class="ver-badge">split 变化 {{ versionDiff.summary.splitsChanged }}</span>
        </div>

        <div class="ver-sub" v-if="versionDiff.classes.length">
          类变化：
          <span
            v-for="c in versionDiff.classes"
            :key="c.id + c.name"
            class="ver-chip"
            :class="c.kind"
          >
            <template v-if="c.kind === 'renamed'">{{ c.fromName }}→{{ c.name }}</template>
            <template v-else>{{ c.kind === 'added' ? '+' : '-' }}{{ c.name }}</template>
          </span>
        </div>

        <div class="ver-sub" v-if="versionDiff.splits.length">
          split 变化：
          <span
            v-for="s in versionDiff.splits"
            :key="s.split"
            class="ver-chip"
          >
            {{ s.split }}: {{ s.before }}→{{ s.after }}
          </span>
        </div>

        <div class="ver-sub">
          总量：样本 {{ versionDiff.stats.before.totalSamples }}→{{ versionDiff.stats.after.totalSamples }} ·
          标注 {{ versionDiff.stats.before.totalAnnotations }}→{{ versionDiff.stats.after.totalAnnotations }}
        </div>

        <el-table
          :data="versionDiff.samples"
          size="small"
          max-height="260"
          empty-text="无样本级变化"
          :default-sort="{ prop: 'kind', order: 'ascending' }"
        >
          <el-table-column label="变化" width="90">
            <template #default="{ row }">
              <span class="ver-badge" :class="row.kind">
                {{ kindLabel(row.kind) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="sourcePath" label="样本路径" min-width="260" show-overflow-tooltip />
          <el-table-column label="标注数" width="120">
            <template #default="{ row }">
              <template v-if="row.kind === 'modified'">
                {{ row.annCountBefore }} → {{ row.annCountAfter }}
              </template>
              <template v-else-if="row.kind === 'added'">{{ row.annCountAfter }}</template>
              <template v-else>{{ row.annCountBefore }}</template>
            </template>
          </el-table-column>
          <el-table-column label="split" width="100">
            <template #default="{ row }">
              {{ row.split }}<template v-if="row.splitChanged"> ⚠</template>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { Plus, Download, Delete, Upload, Sort } from '@element-plus/icons-vue'
import type { UploadFile } from 'element-plus'
import { env } from '../env'
import { useViewerState } from '../composables/useViewerState'
import type { DatasetVersionManifest } from '../dataset/versioning'

const {
  showVersion, versionBusy, versionList, versionLabel,
  diffBeforeId, diffAfterId, versionDiff,
  saveCurrentVersion, runVersionDiff, removeVersion,
  downloadVersion, importVersion,
} = useViewerState()

function onDownload(row: any) {
  downloadVersion(row as DatasetVersionManifest)
}
function onRemove(row: any) {
  removeVersion(row.id as string)
}

function fmt(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function kindLabel(k: string): string {
  return k === 'added' ? '新增' : k === 'removed' ? '删除' : '修改'
}

function onImportFile(u: UploadFile) {
  if (u.raw) void importVersion(u.raw)
}
</script>

<style scoped>
.ver-section { margin-bottom: 16px; }
.ver-title { font-weight: 600; margin-bottom: 8px; color: var(--el-text-color-primary); }
.ver-save-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ver-diff-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.ver-diff-label { width: 96px; color: var(--el-text-color-secondary); font-size: 13px; }
.ver-summary { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
.ver-badge {
  display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px;
  background: var(--el-fill-color-light); color: var(--el-text-color-regular);
}
.ver-badge.added { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.ver-badge.removed { background: var(--el-color-error-light-9); color: var(--el-color-error); }
.ver-badge.modified { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
.ver-sub { margin: 6px 0; font-size: 13px; color: var(--el-text-color-regular); }
.ver-chip {
  display: inline-block; margin: 2px 4px 2px 0; padding: 0 8px; border-radius: 10px;
  background: var(--el-fill-color); font-size: 12px;
}
.ver-chip.added { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.ver-chip.removed { background: var(--el-color-error-light-9); color: var(--el-color-error); }
.ver-chip.renamed { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
.export-hint { font-size: 12px; color: var(--el-text-color-secondary); margin: 6px 0; line-height: 1.6; }
.export-hint code { background: var(--el-fill-color); padding: 0 4px; border-radius: 3px; }
</style>
