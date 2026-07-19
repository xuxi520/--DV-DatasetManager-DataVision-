/**
 * 导出状态与动作（从 useViewerState 抽取）
 * 仅依赖共享的 datasets；其余导出状态/计算/动作自包含，由 useViewerState 组合复用。
 */
import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { DataSet } from '../../types'
import type { CanonicalDataset } from '../../dataset/types'
import type { NamingPolicy } from '../../dataset/naming'
import {
  exportDatasetZip, previewRebalance, splitCounts,
  exportTrainingConfig, frameworkLabel, exportAnnotations,
  type ExportFormat, type TrainingFramework, type TrainingHyper,
  type AnnotationFormat,
} from '../../dataset/exportBrowser'
import { AUGMENTATIONS, type AugId } from '../../augment/transforms'
import { runAugmentExport, type AugPolicy } from '../../augment/export'

export function useExport(datasets: Ref<DataSet[]>) {
  const showExport = ref(false)
  const exporting = ref(false)
  const exportProgress = ref(0)
  const exportStatus = ref('')
  const exportFormat = ref<ExportFormat>('yolo')
  const exportPolicy = ref<NamingPolicy>('class_seq')
  // 标注 CSV / JSON 导出（IExportService 落地项）
  const exportAnnFormat = ref<AnnotationFormat>('csv')

  // 增强导出（P3 收官补充）：组合增强链生成增强扩增数据集
  const augSteps = ref<{ id: AugId; enabled: boolean; param: number }[]>(
    AUGMENTATIONS.map((a) => ({ id: a.id, enabled: false, param: a.param?.default ?? 0 })),
  )
  const augStrategy = ref<'fixed' | 'random'>('fixed')
  const augCopies = ref(2)
  const augOutFormat = ref<ExportFormat>('yolo')
  const augImageExt = ref<'jpg' | 'png'>('jpg')
  const augIncludeOriginals = ref(true)
  const exportEnableRebalance = ref(false)
  const exportRatio = ref({ train: 8, val: 1, test: 1 })
  const exportStratify = ref(true)
  const exportLockTest = ref(false)
  const exportSeed = ref(1)

  // 导出模式：数据集格式 / 标注 CSV·JSON / 训练框架工程配置
  const exportMode = ref<'dataset' | 'annotations' | 'training' | 'augment'>('dataset')
  const exportFramework = ref<TrainingFramework>('yolov8')
  const exportHyper = ref<{
    model: string; epochs: number; imgsz: number; batch: number
    device: string; lr: number; workers: number; maxIter: number; numGpus: number
  }>({
    model: 'n', epochs: 100, imgsz: 640, batch: 16,
    device: '0', lr: 0.00025, workers: 4, maxIter: 9000, numGpus: 1,
  })

  // 导出源与预览
  const exportSource = computed<{ ds: DataSet; canonical: CanonicalDataset } | null>(() => {
    const ds = datasets.value.find((d) => d.canonical)
    return ds && ds.canonical ? { ds, canonical: ds.canonical } : null
  })
  const currentSplitCounts = computed(() => {
    const src = exportSource.value
    if (!src) return null
    return splitCounts(src.canonical)
  })
  const rebalancePreview = computed(() => {
    const src = exportSource.value
    if (!src || !exportEnableRebalance.value) return null
    const { train, val, test } = exportRatio.value
    return previewRebalance(
      src.canonical,
      { train, val, test },
      { stratifyByClass: exportStratify.value, lockTest: exportLockTest.value, seed: exportSeed.value },
    )
  })

  function handleExport() {
    if (datasets.value.length === 0) {
      ElMessage.warning('请先加载数据集')
      return
    }
    if (!exportSource.value) {
      ElMessage.warning('当前数据集缺少规范中间模型（canonical），请通过「加载数据」重新导入后再导出')
      return
    }
    showExport.value = true
  }

  async function runAugmentExportFlow() {
    const src = exportSource.value
    if (!src) return
    exporting.value = true
    exportProgress.value = 0
    exportStatus.value = '准备中...'
    try {
      const policy: AugPolicy = {
        steps: augSteps.value,
        strategy: augStrategy.value,
        copies: augCopies.value,
        outFormat: augOutFormat.value,
        imageExt: augImageExt.value,
        includeOriginals: augIncludeOriginals.value,
      }
      const count = await runAugmentExport(src, policy, (pct, status) => {
        exportProgress.value = pct
        exportStatus.value = status
      })
      ElMessage.success(`增强数据集已生成：共 ${count} 个文件`)
      showExport.value = false
    } catch (e: any) {
      ElMessage.error('增强导出失败：' + (e?.message || e))
    } finally {
      exporting.value = false
    }
  }

  async function runExport() {
    const src = exportSource.value
    if (!src) return
    if (exportMode.value === 'augment') {
      await runAugmentExportFlow()
      return
    }
    exporting.value = true
    exportProgress.value = 0
    exportStatus.value = '准备中...'
    try {
      const { train, val, test } = exportRatio.value
      const progress = (pct: number, status: string) => {
        exportProgress.value = pct
        exportStatus.value = status
      }

      // 标注 CSV / JSON 导出（不打包图片，直接下载单文件）
      if (exportMode.value === 'annotations') {
        const count = await exportAnnotations(src.canonical, {
          format: exportAnnFormat.value,
          datasetName: src.ds.name,
          rebalance: exportEnableRebalance.value
            ? { targets: { train, val, test }, options: { stratifyByClass: exportStratify.value, lockTest: exportLockTest.value, seed: exportSeed.value } }
            : undefined,
        })
        ElMessage.success(
          `已导出标注（${exportAnnFormat.value.toUpperCase()}）：共 ${count} 条标注，已下载`,
        )
        showExport.value = false
        return
      }

      if (exportMode.value === 'training') {
        const h = exportHyper.value
        const hyper: TrainingHyper = {
          model: h.model,
          epochs: h.epochs,
          imgsz: h.imgsz,
          batch: h.batch,
          device: h.device,
          lr: h.lr,
          workers: h.workers,
          maxIter: h.maxIter,
          numGpus: h.numGpus,
        }
        const count = await exportTrainingConfig(
          src.canonical,
          {
            framework: exportFramework.value,
            datasetName: src.ds.name,
            policy: exportPolicy.value,
            imageRootAbs: src.ds.rootAbsPath,
            hyper,
            rebalance: exportEnableRebalance.value
              ? {
                  targets: { train, val, test },
                  options: {
                    stratifyByClass: exportStratify.value,
                    lockTest: exportLockTest.value,
                    seed: exportSeed.value,
                  },
                }
              : undefined,
          },
          progress,
        )
        ElMessage.success(
          `已生成 ${frameworkLabel(exportFramework.value)} 训练工程：共 ${count} 个文件，已打包下载`,
        )
        showExport.value = false
        return
      }

      const count = await exportDatasetZip(
        src.canonical,
        {
          format: exportFormat.value,
          policy: exportPolicy.value,
          datasetName: src.ds.name,
          imageRootAbs: src.ds.rootAbsPath,
          rebalance: exportEnableRebalance.value
            ? {
                targets: { train, val, test },
                options: {
                  stratifyByClass: exportStratify.value,
                  lockTest: exportLockTest.value,
                  seed: exportSeed.value,
                },
              }
            : undefined,
        },
        progress,
      )
      ElMessage.success(`导出成功：共 ${count} 个文件，已打包下载`)
      showExport.value = false
    } catch (e: any) {
      ElMessage.error('导出失败' + (e?.message || e))
    } finally {
      exporting.value = false
    }
  }

  return {
    showExport, exporting, exportProgress, exportStatus,
    exportFormat, exportPolicy, exportAnnFormat,
    augSteps, augStrategy, augCopies, augOutFormat, augImageExt, augIncludeOriginals,
    exportEnableRebalance, exportRatio, exportStratify, exportLockTest, exportSeed,
    exportMode, exportFramework, exportHyper, frameworkLabel,
    exportSource, currentSplitCounts, rebalancePreview,
    handleExport, runExport, runAugmentExportFlow,
  }
}
