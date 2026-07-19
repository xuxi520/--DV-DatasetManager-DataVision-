// 标注访问 + 轻量标注编辑（清洗台）。
// 从 useViewerState 抽出：getFileAnnotations 及数据集查询、撤销栈/脏文件/增删改。
// 仅依赖共享的 datasets / datasetAnnotations / categoryColorMap / annotationsCache，
// 由 useViewerState 组合后展开，对外契约不变。
import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { sampleToAnnotations } from '../../dataset/loadCanonical'
import { saveAnnotations } from '../../dataset/annotationIO'
import type { DataSet, ImageFile, ParsedAnnotation } from '../../types'
import type { CanonicalDataset, CanonicalAnnotation, CanonicalSample } from '../../dataset/types'

export interface AnnotationDeps {
  datasets: Ref<DataSet[]>
  datasetAnnotations: Ref<Map<string, Map<string, ParsedAnnotation[]>>>
  categoryColorMap: Ref<Map<string, string>>
  annotationsCache: Map<string, ParsedAnnotation[]>
}

export function useAnnotations(deps: AnnotationDeps) {
  const { datasets, datasetAnnotations, categoryColorMap, annotationsCache } = deps

  // 触发 currentAnnotations 等 computed 重算（绕过标注缓存，使画布/面板实时反映编辑）
  const annVersion = ref(0)

  // ===== 轻量标注编辑（清洗台）：交互模式 / 新框类别 / 撤销栈 / 脏文件 =====
  const editingMode = ref<'select' | 'draw'>('select')
  const editClassId = ref<number>(0)
  interface EditCommand {
    label: string
    apply: () => void
    revert: () => void
  }
  const undoStack = ref<EditCommand[]>([])
  const redoStack = ref<EditCommand[]>([])
  const dirtyFiles = ref<Set<string>>(new Set())
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  // 操作历史（可视化）：过去（可撤销，最近在前）与将来（可重做，最近在前）的操作标签
  const undoLabels = computed(() => undoStack.value.map((c) => c.label).reverse())
  const redoLabels = computed(() => redoStack.value.map((c) => c.label).reverse())

  // ===== 按数据集作用域隔离的标注查询：先定位 file 所属数据集，再用 owner.id 作缓存前缀 =====
  function getFileAnnotations(file: ImageFile): ParsedAnnotation[] {
    const owner =
      datasets.value.find((ds) => ds.fileList.some((f) => f === file)) ||
      datasets.value[0]
    const cacheKey = owner ? `${owner.id}:${file.id}` : file.id
    const cached = annotationsCache.get(cacheKey)
    if (cached) return cached

    let result: ParsedAnnotation[] = []
    let fromCanonical = false

    // 1) canonical 规范模型为权威来源（统一管线导入，标注最全）。
    //    注意：只要 canonical 中能找到该文件就用它——即使标注被删光（空数组）也采用，
    //    绝不能回退到陈旧的 datasetAnnotations，否则删除后标注会从旧数据「复活」。
    if (owner && owner.canonical) {
      const s = owner.canonical.samples.find((x) => x.id === file.id)
      if (s) {
        result = sampleToAnnotations(s, owner.canonical, categoryColorMap.value)
        fromCanonical = true
      }
    }
    // 2) 仅在 canonical 缺失、或该文件不在 canonical 中时，才兜底 datasetAnnotations
    //    （历史/未规范化的数据集场景）。已规范化且匹配到的文件一律以 canonical 为准。
    if (!fromCanonical && owner) {
      const annMap = datasetAnnotations.value.get(owner.id)
      if (annMap) {
        const byId = annMap.get(file.id) || annMap.get(file.path)
        if (byId) result = byId
      }
    }

    annotationsCache.set(cacheKey, result)
    return result
  }

  function getDatasetAnnotations(datasetId: string, file: ImageFile): ParsedAnnotation[] {
    const annMap = datasetAnnotations.value.get(datasetId)
    if (!annMap) return []
    return annMap.get(file.path) || []
  }

  function getDatasetName(datasetId: string): string {
    const ds = datasets.value.find((d) => d.id === datasetId)
    return ds?.name || '未知'
  }

  function getDatasetFileCount(datasetId: string): number {
    const ds = datasets.value.find((d) => d.id === datasetId)
    return ds?.fileList.length || 0
  }

  function getDatasetAnnotationCount(datasetId: string): number {
    annVersion.value // 编辑信号
    const ds = datasets.value.find((d) => d.id === datasetId)
    if (ds?.canonical) {
      let count = 0
      for (const s of ds.canonical.samples) count += s.annotations.length
      return count
    }
    const annMap = datasetAnnotations.value.get(datasetId)
    if (!annMap) return 0
    let count = 0
    for (const anns of annMap.values()) {
      count += anns.length
    }
    return count
  }

  function getAnnotationTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      bbox: '矩形',
      polygon: '多边形',
      segmentation: '分割',
      obb: '旋转框',
      keypoints: '关键点',
      mask: '掩码',
    }
    return labels[type] || type
  }

  // ===== 轻量标注编辑：直接改 canonical（唯一数据源），并失效标注缓存 + 标脏 =====
  function findOwner(file: ImageFile) {
    return datasets.value.find((ds) => ds.fileList.some((f) => f === file)) || datasets.value[0] || null
  }
  function findSample(file: ImageFile): { ds: DataSet; sample: CanonicalSample } | null {
    const ds = findOwner(file)
    if (!ds || !ds.canonical) return null
    const sample = ds.canonical.samples.find((s) => s.id === file.id)
    return sample ? { ds, sample } : null
  }
  /** 失效该文件标注缓存并触发依赖 annVersion 的 computed 重算 */
  function touch(file: ImageFile) {
    const ds = findOwner(file)
    if (ds) annotationsCache.delete(`${ds.id}:${file.id}`)
    annVersion.value++
  }
  function cloneAnn(a: CanonicalAnnotation): CanonicalAnnotation {
    return JSON.parse(JSON.stringify(a))
  }
  function markDirty(file: ImageFile) {
    if (!dirtyFiles.value.has(file.id)) {
      dirtyFiles.value = new Set(dirtyFiles.value).add(file.id)
    }
  }
  function pushEdit(cmd: EditCommand, file: ImageFile) {
    undoStack.value = [...undoStack.value, cmd]
    redoStack.value = []
    markDirty(file)
  }

  /** 实时改坐标（拖动/缩放过程中高频调用，不单独入撤销栈） */
  function setAnnotationCoords(file: ImageFile, index: number, coords: number[]) {
    const f = findSample(file)
    if (!f) return
    const ann = f.sample.annotations[index]
    if (!ann) return
    ann.coords = coords
    touch(file)
  }
  /** 一次拖拽/缩放结束时提交一个撤销命令 */
  function commitCoordsEdit(file: ImageFile, index: number, prev: number[], next: number[]) {
    const prevC = [...prev]
    const nextC = [...next]
    const cmd: EditCommand = {
      label: '编辑标注',
      apply: () => { const f = findSample(file); if (f) { f.sample.annotations[index].coords = [...nextC]; touch(file); markDirty(file) } },
      revert: () => { const f = findSample(file); if (f) { f.sample.annotations[index].coords = [...prevC]; touch(file); markDirty(file) } },
    }
    pushEdit(cmd, file)
  }
  /** 新增 bbox 标注，返回新索引 */
  function addBBoxAnnotation(file: ImageFile, bbox: [number, number, number, number], classId: number): number {
    const f = findSample(file)
    if (!f) return -1
    const ann: CanonicalAnnotation = { type: 'bbox', classId, coords: [...bbox] }
    f.sample.annotations.push(ann)
    const index = f.sample.annotations.length - 1
    touch(file)
    const snapshot = cloneAnn(ann)
    const cmd: EditCommand = {
      label: '新增标注',
      apply: () => { const ff = findSample(file); if (ff) { ff.sample.annotations.push(cloneAnn(snapshot)); touch(file); markDirty(file) } },
      revert: () => { const ff = findSample(file); if (ff) { ff.sample.annotations.splice(ff.sample.annotations.length - 1, 1); touch(file); markDirty(file) } },
    }
    pushEdit(cmd, file)
    return index
  }
  /** 删除指定标注 */
  function deleteAnnotationAt(file: ImageFile, index: number) {
    const f = findSample(file)
    if (!f) return
    const removed = f.sample.annotations[index]
    if (!removed) return
    const snapshot = cloneAnn(removed)
    f.sample.annotations.splice(index, 1)
    touch(file)
    const cmd: EditCommand = {
      label: '删除标注',
      apply: () => { const ff = findSample(file); if (ff) { ff.sample.annotations.splice(index, 1); touch(file); markDirty(file) } },
      revert: () => { const ff = findSample(file); if (ff) { ff.sample.annotations.splice(index, 0, cloneAnn(snapshot)); touch(file); markDirty(file) } },
    }
    pushEdit(cmd, file)
  }
  /** 修改标注类别 */
  function changeAnnotationClass(file: ImageFile, index: number, classId: number) {
    const f = findSample(file)
    if (!f) return
    const ann = f.sample.annotations[index]
    if (!ann || ann.classId === classId) return
    const prev = ann.classId
    ann.classId = classId
    touch(file)
    const cmd: EditCommand = {
      label: '修改类别',
      apply: () => { const ff = findSample(file); if (ff) { ff.sample.annotations[index].classId = classId; touch(file); markDirty(file) } },
      revert: () => { const ff = findSample(file); if (ff) { ff.sample.annotations[index].classId = prev; touch(file); markDirty(file) } },
    }
    pushEdit(cmd, file)
  }
  /** 实时改旋转角（obb 拖拽旋转过程中高频调用） */
  function setAnnotationRotation(file: ImageFile, index: number, rotation: number) {
    const f = findSample(file)
    if (!f) return
    const ann = f.sample.annotations[index]
    if (!ann) return
    ann.rotation = rotation
    touch(file)
  }
  /** 提交一次旋转编辑（撤销栈） */
  function commitRotationEdit(file: ImageFile, index: number, prev: number, next: number) {
    const p = prev
    const n = next
    const cmd: EditCommand = {
      label: '旋转标注',
      apply: () => { const f = findSample(file); if (f) { f.sample.annotations[index].rotation = n; touch(file); markDirty(file) } },
      revert: () => { const f = findSample(file); if (f) { f.sample.annotations[index].rotation = p; touch(file); markDirty(file) } },
    }
    pushEdit(cmd, file)
  }
  /** 读取某标注当前的规范 coords（提交撤销时使用，避免从 ParsedAnnotation 反向推算） */
  function peekCoords(file: ImageFile, index: number): number[] {
    const f = findSample(file)
    if (!f) return []
    const a = f.sample.annotations[index]
    return a ? [...a.coords] : []
  }
  function undo() {
    const cmd = undoStack.value[undoStack.value.length - 1]
    if (!cmd) return
    cmd.revert()
    undoStack.value = undoStack.value.slice(0, -1)
    redoStack.value = [...redoStack.value, cmd]
  }
  function redo() {
    const cmd = redoStack.value[redoStack.value.length - 1]
    if (!cmd) return
    cmd.apply()
    redoStack.value = redoStack.value.slice(0, -1)
    undoStack.value = [...undoStack.value, cmd]
  }
  /** 保存全部脏文件编辑（Tauri 写回 / 浏览器 ZIP） */
  async function saveEditedAnnotations(): Promise<number> {
    const byDs = new Map<string, string[]>()
    for (const id of dirtyFiles.value) {
      const ds = datasets.value.find((d) => d.fileList.some((f) => f.id === id))
      if (ds) {
        const arr = byDs.get(ds.id) || []
        arr.push(id)
        byDs.set(ds.id, arr)
      }
    }
    let total = 0
    for (const [dsId, ids] of byDs) {
      const ds = datasets.value.find((d) => d.id === dsId)
      if (ds) total += await saveAnnotations(ds, ids)
    }
    // 保存后强制以 canonical 为准刷新显示：失效标注缓存并 bump annVersion，
    // 确保画布/面板立即反映磁盘已落盘的编辑结果（如删除后保存的场景）。
    for (const [dsId, ids] of byDs) {
      const ds = datasets.value.find((d) => d.id === dsId)
      if (ds) for (const id of ids) {
        const f = ds.fileList.find((x) => x.id === id)
        if (f) touch(f)
      }
    }
    dirtyFiles.value = new Set()
    return total
  }

  return {
    // 编辑信号（删除/新增/改类后 bump），供统计等消费以实现实时刷新
    annVersion,
    // 标注查询
    getFileAnnotations, getDatasetAnnotations, getDatasetName, getDatasetFileCount,
    getDatasetAnnotationCount, getAnnotationTypeLabel,
    // 编辑清洗台
    editingMode, editClassId, dirtyFiles, canUndo, canRedo, undoLabels, redoLabels,
    setAnnotationCoords, commitCoordsEdit, addBBoxAnnotation, deleteAnnotationAt,
    changeAnnotationClass, setAnnotationRotation, commitRotationEdit, peekCoords, undo, redo,
    saveEditedAnnotations,
  }
}
