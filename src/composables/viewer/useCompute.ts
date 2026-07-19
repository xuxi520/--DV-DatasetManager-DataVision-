import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { hashService } from '../../hashService'
import { useQuality } from '../useQuality'
import type { Ref } from 'vue'
import type { DataSet, ImageFile } from '../../types'

type Quality = ReturnType<typeof useQuality>

/**
 * 计算簇：哈希计算 + 质量检查的目标数据集选择与运行。
 * 仅依赖注入的 datasets / quality / filesForTarget / defaultTargetId，对外契约不变。
 */
export interface ComputeDeps {
  datasets: Ref<DataSet[]>
  quality: Quality
  filesForTarget: (targetId: string | null) => ImageFile[]
  defaultTargetId: () => string | null
}

export function useCompute(deps: ComputeDeps) {
  const { datasets, quality, filesForTarget, defaultTargetId } = deps

  const computing = ref(false)
  const computeProgress = ref(0)
  const computeStatus = ref('')
  /** 哈希计算中命中缓存（跳过解码计算）的文件数，用于进度 UI 展示 */
  const computeCacheHits = ref(0)
  const cancelCompute = ref(false)

  // 质量检查 / 计算哈希 的目标数据集选择（'__all__' = 全部已加载数据集）。
  const qualityTargetDatasetId = ref<string | null>('__all__')
  const hashTargetDatasetId = ref<string | null>('__all__')
  const qualitySelectorVisible = ref(false)
  const hashSelectorVisible = ref(false)

  /** 打开哈希计算的数据集选择对话框（默认选中焦点窗格数据集） */
  function openComputeHashes() {
    if (datasets.value.length === 0) {
      ElMessage.warning('请先加载数据集')
      return
    }
    if (hashTargetDatasetId.value == null || !datasets.value.some((d) => d.id === hashTargetDatasetId.value)) {
      hashTargetDatasetId.value = defaultTargetId()
    }
    hashSelectorVisible.value = true
  }

  /** 确认：仅对所选数据集（或全部）计算哈希 */
  async function confirmComputeHashes() {
    hashSelectorVisible.value = false
    if (datasets.value.length === 0) return

    const target = hashTargetDatasetId.value
    const files = filesForTarget(target)
    if (files.length === 0) return

    computing.value = true
    computeProgress.value = 0
    computeCacheHits.value = 0
    cancelCompute.value = false

    try {
      await hashService.computeHashes(
        files,
        (fileId, hash, phash) => {
          const file = files.find((f) => f.id === fileId)
          if (file) {
            file.hash = hash
            file.phash = phash
          }
        },
        (processed, total, ch) => {
          computeProgress.value = Math.round((processed / total) * 100)
          computeStatus.value = `Computing ${processed}/${total}`
          computeCacheHits.value = ch
        },
        () => cancelCompute.value,
      )

      const isAll = !target || target === '__all__'
      const name = isAll ? '全部已加载数据集' : (datasets.value.find((d) => d.id === target)?.name ?? '')
      ElMessage.success(`哈希计算完成（${name}）`)
    } catch (e: any) {
      ElMessage.error('计算失败' + e.message)
    } finally {
      computing.value = false
    }
  }

  /**
   * 质量检查：打开数据集选择对话框（默认选中焦点窗格数据集），再对所选数据集的图片
   * 统一跑像素级质量指标（Worker 内降采样计算）。结果写入 quality 单例，供文件列表
   * 徽标、筛选与统计页质量 tab 共享。
   */
  function openQualityCheck() {
    if (datasets.value.length === 0) {
      ElMessage.warning('请先加载数据集')
      return
    }
    if (qualityTargetDatasetId.value == null || !datasets.value.some((d) => d.id === qualityTargetDatasetId.value)) {
      qualityTargetDatasetId.value = defaultTargetId()
    }
    qualitySelectorVisible.value = true
  }

  /** 确认：仅对所选数据集（或全部）运行质量检查 */
  async function confirmQualityCheck() {
    qualitySelectorVisible.value = false
    if (datasets.value.length === 0) return

    const target = qualityTargetDatasetId.value
    const files = filesForTarget(target)
    if (files.length === 0) return
    try {
      await quality.run(files)
      const s = quality.stats.value
      const isAll = !target || target === '__all__'
      const name = isAll ? '全部已加载数据集' : (datasets.value.find((d) => d.id === target)?.name ?? '')
      ElMessage.success(
        `质量检查完成（${name}）：${s.checked} 张 · 平均分 ${s.avgScore} · 模糊 ${s.blur} / 过暗 ${s.dark} / 过亮 ${s.bright} / 低分辨率 ${s.lowRes} / 单色 ${s.monochrome}`,
      )
    } catch (e: any) {
      ElMessage.error('质量检查失败：' + (e?.message || e))
    }
  }

  return {
    computing, computeProgress, computeStatus, computeCacheHits, cancelCompute,
    hashTargetDatasetId, hashSelectorVisible, openComputeHashes, confirmComputeHashes,
    qualityTargetDatasetId, qualitySelectorVisible, openQualityCheck, confirmQualityCheck,
  }
}
