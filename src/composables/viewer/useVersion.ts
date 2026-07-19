/**
 * 数据集版本 / 迭代间 diff 状态与动作（从 useViewerState 抽取）
 * 仅依赖共享的 datasets；其余版本状态/计算/动作自包含，由 useViewerState 组合复用。
 */
import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { env } from '../../env'
import type { DataSet } from '../../types'
import type { CanonicalDataset } from '../../dataset/types'
import {
  buildManifest, diffManifests,
  type DatasetVersionManifest, type VersionDiff,
} from '../../dataset/versioning'
import {
  saveVersion, listVersions, removeVersion as removeStoredVersion,
  detectMarker, downloadManifest, importManifestFile,
} from '../../dataset/versionStore'

export function useVersion(datasets: Ref<DataSet[]>) {
  const showVersion = ref(false)
  const versionBusy = ref(false)
  const versionList = ref<DatasetVersionManifest[]>([])
  const versionLabel = ref('')
  /** diff 基准版本（before）id；当前工作区为特殊值 'current' */
  const diffBeforeId = ref<string>('')
  /** diff 对比版本（after）：'current' 或某已存版本 id */
  const diffAfterId = ref<string>('current')
  const versionDiff = ref<VersionDiff | null>(null)

  /** 版本操作源：优先焦点窗格数据集，否则取首个含 canonical 的数据集 */
  const versionSource = computed<{ ds: DataSet; canonical: CanonicalDataset } | null>(() => {
    const ds = datasets.value.find((d) => d.canonical) || null
    return ds && ds.canonical ? { ds, canonical: ds.canonical } : null
  })

  async function refreshVersions() {
    const src = versionSource.value
    if (!src) { versionList.value = []; return }
    // Tauri：首次打开目录时把磁盘上的自标识文件并入历史
    if (env === 'tauri' && src.ds.rootAbsPath) {
      const marker = await detectMarker(src.ds.rootAbsPath)
      if (marker) await saveVersion(src.ds, marker)
    }
    versionList.value = await listVersions(src.ds)
    if (!versionList.value.some((v) => v.id === diffBeforeId.value)) {
      diffBeforeId.value = versionList.value.length ? versionList.value[0].id : ''
    }
  }

  function openVersion() {
    if (!versionSource.value) {
      ElMessage.warning('请先加载含规范模型的数据集再管理版本')
      return
    }
    showVersion.value = true
    void refreshVersions()
  }

  async function saveCurrentVersion() {
    const src = versionSource.value
    if (!src) return
    versionBusy.value = true
    try {
      const n = versionList.value.length + 1
      const label = versionLabel.value.trim() || `v${n}`
      const manifest = buildManifest(src.canonical, {
        label,
        datasetName: src.ds.name,
      })
      await saveVersion(src.ds, manifest)
      versionLabel.value = ''
      await refreshVersions()
      ElMessage.success(`已保存版本「${label}」`)
    } catch (e: any) {
      ElMessage.error('保存版本失败：' + (e?.message || e))
    } finally {
      versionBusy.value = false
    }
  }

  async function runVersionDiff() {
    const src = versionSource.value
    if (!src) return
    const beforeId = diffBeforeId.value
    const before = beforeId && beforeId !== 'current'
      ? versionList.value.find((v) => v.id === beforeId)
      : undefined
    const afterId = diffAfterId.value
    let after: DatasetVersionManifest | undefined
    if (afterId === 'current' || !afterId) {
      after = buildManifest(src.canonical, { label: '当前工作区', datasetName: src.ds.name })
    } else {
      after = versionList.value.find((v) => v.id === afterId)
    }
    if (!before || !after) {
      ElMessage.warning('请选择有效的对比基准与对比版本')
      return
    }
    versionDiff.value = diffManifests(after, before)
  }

  async function removeVersion(id: string) {
    const src = versionSource.value
    if (!src) return
    await removeStoredVersion(src.ds, id)
    await refreshVersions()
    if (versionDiff.value && diffBeforeId.value === id) versionDiff.value = null
  }

  async function downloadVersion(manifest: DatasetVersionManifest) {
    await downloadManifest(manifest)
  }

  async function importVersion(file: File) {
    const src = versionSource.value
    if (!src) return
    try {
      await importManifestFile(src.ds, file)
      await refreshVersions()
      ElMessage.success('已导入版本清单')
    } catch (e: any) {
      ElMessage.error('导入失败：' + (e?.message || e))
    }
  }

  return {
    showVersion, versionBusy, versionList, versionLabel,
    diffBeforeId, diffAfterId, versionDiff, versionSource,
    openVersion, saveCurrentVersion, runVersionDiff, removeVersion,
    downloadVersion, importVersion,
  }
}
