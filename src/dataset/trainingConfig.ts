/**
 * 训练框架配置导出（工程脚手架生成）
 *
 * 根据当前 canonical 数据集（类别表 + 子集数量 + 数据集名）自动生成三种主流
 * 目标检测框架的「可直接开训」工程配置 + class yaml：
 *
 *  - YOLOv8   (Ultralytics)  ：data.yaml + train.py + README.md
 *  - MMDetection             ：configs/<name>_faster_rcnn_r50_fpn_1x.py + classes.txt + README.md
 *  - Detectron2              ：train_net.py + classes.txt + README.md
 *
 * 说明：
 *  - 数据本身（图片 + 标注）由 exportBrowser 按框架匹配格式（yolov8→YOLO / 其余→COCO）生成，
 *    本模块只负责生成「工程配置 + 类别名」文件，二者拼接为一个可直接训练的 ZIP。
 *  - 所有超参提供合理默认，用户在导出对话框可调（模型规模 / epochs / imgsz / batch 等）。
 */

import type { ExportFile } from './exporters/types'
import type { SplitKey } from './types'

const enc = (s: string) => new TextEncoder().encode(s)

export type TrainingFramework = 'yolov8' | 'mmdetection' | 'detectron2'

export interface TrainingHyper {
  /** YOLOv8 模型规模：n / s / m / l / x（默认 n） */
  model?: string
  epochs?: number
  imgsz?: number
  batch?: number
  /** YOLOv8 device：'0' / 'cpu' / '[0,1]'（默认 0） */
  device?: string
  lr?: number
  workers?: number
  /** MMDetection / Detectron2 预训练基础配置（默认 Faster R-CNN R50 FPN） */
  baseConfig?: string
  /** Detectron2 训练迭代步数（默认 9000） */
  maxIter?: number
  numGpus?: number
}

export interface TrainingConfigOptions {
  framework: TrainingFramework
  datasetName: string
  /** 规范类别名（顺序即 class id） */
  classes: string[]
  /** 各子集图片数量（用于 data.yaml 提示与校验） */
  splitCounts: Record<SplitKey, number>
  hyper?: TrainingHyper
}

const FRAMEWORK_LABELS: Record<TrainingFramework, string> = {
  yolov8: 'YOLOv8 (Ultralytics)',
  mmdetection: 'MMDetection',
  detectron2: 'Detectron2',
}

export function frameworkLabel(f: TrainingFramework): string {
  return FRAMEWORK_LABELS[f]
}

/** 各框架推荐的标注格式（yolov8→YOLO；mmdetection/detectron2→COCO） */
export function datasetFormatForFramework(f: TrainingFramework): 'yolo' | 'coco' {
  return f === 'yolov8' ? 'yolo' : 'coco'
}

function q(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`
}

function presentSplits(c: Record<SplitKey, number>): SplitKey[] {
  return (['train', 'val', 'test'] as SplitKey[]).filter((s) => (c[s] ?? 0) > 0)
}

// ---------------------------------------------------------------------------
// YOLOv8 (Ultralytics)
// ---------------------------------------------------------------------------

function buildYoloV8(opts: TrainingConfigOptions): ExportFile[] {
  const { datasetName, classes, splitCounts, hyper } = opts
  const model = hyper?.model ?? 'n'
  const epochs = hyper?.epochs ?? 100
  const imgsz = hyper?.imgsz ?? 640
  const batch = hyper?.batch ?? 16
  const device = hyper?.device ?? '0'
  const workers = hyper?.workers ?? 8
  const names = classes.map(q).join(', ')

  // data.yaml（Ultralytics 约定：path 为本配置所在目录，train/val 相对 path）
  const splits = presentSplits(splitCounts)
  const dataLines: string[] = [
    '# 由 dataset-manager 生成 — YOLOv8 / Ultralytics 数据集配置',
    `path: .            # 数据集根目录（即本 data.yaml 所在目录）`,
    `train: ${splits.includes('train') ? 'train/images' : 'train/images   # 无训练集'}`,
    `val: ${splits.includes('val') ? 'val/images' : 'val/images     # 无验证集'}`,
  ]
  if (splits.includes('test')) dataLines.push(`test: test/images`)
  dataLines.push(`nc: ${classes.length}`)
  dataLines.push(`names: [${names}]`)
  const dataYaml = dataLines.join('\n') + '\n'

  const trainPy =
    `# 由 dataset-manager 生成 — YOLOv8 / Ultralytics 训练脚本\n` +
    `# 安装：  pip install ultralytics\n` +
    `# 运行：  python train.py\n` +
    `# 数据集配置见同目录 data.yaml\n\n` +
    `from ultralytics import YOLO\n\n` +
    `def main():\n` +
    `    # 可选模型规模：yolov8n / yolov8s / yolov8m / yolov8l / yolov8x\n` +
    `    model = YOLO('yolov8${model}.pt')\n\n` +
    `    model.train(\n` +
    `        data='data.yaml',\n` +
    `        epochs=${epochs},\n` +
    `        imgsz=${imgsz},\n` +
    `        batch=${batch},\n` +
    `        device=${device},        # 0=GPU0, 'cpu'=CPU, [0,1]=多卡\n` +
    `        workers=${workers},\n` +
    `        name='${datasetName}_exp',\n` +
    `        patience=50,           # 早停耐心（连续无提升轮数）\n` +
    `        pretrained=True,\n` +
    `    )\n\n` +
    `if __name__ == '__main__':\n` +
    `    main()\n`

  const readme =
    `# ${datasetName} — YOLOv8 训练工程（由 dataset-manager 生成）\n\n` +
    `## 目录结构\n` +
    `类别与数量：${classes.length} 类（见 data.yaml 的 names）\n` +
    `- data.yaml       数据集配置（nc / names / 子集路径）\n` +
    `- train.py        训练入口\n` +
    `- train/images|labels/  训练集（YOLO 格式 .txt）\n` +
    (splits.includes('val') ? `- val/images|labels/      验证集\n` : '') +
    (splits.includes('test') ? `- test/images|labels/    测试集\n` : '') +
    `\n## 使用\n` +
    `1. 安装依赖：\n` +
    `   pip install ultralytics\n` +
    `2. 训练：\n` +
    `   python train.py\n` +
    `3. 校验/推理：\n` +
    `   yolo detect val data=data.yaml model=runs/detect/${datasetName}_exp/weights/best.pt\n` +
    `   yolo detect predict source=<图片或目录> model=runs/detect/${datasetName}_exp/weights/best.pt\n` +
    `\n## 超参速查（修改 train.py 或 data.yaml）\n` +
    `- epochs / imgsz / batch / device 见 train.py 顶部\n` +
    `- 类别增减：编辑 data.yaml 的 nc 与 names（顺序即 class id）\n`

  return [
    { path: 'data.yaml', bytes: enc(dataYaml) },
    { path: 'train.py', bytes: enc(trainPy) },
    { path: 'README.md', bytes: enc(readme) },
  ]
}

// ---------------------------------------------------------------------------
// MMDetection
// ---------------------------------------------------------------------------

function buildMMDetection(opts: TrainingConfigOptions): ExportFile[] {
  const { datasetName, classes, splitCounts, hyper } = opts
  const epochs = hyper?.epochs ?? 12
  const lr = hyper?.lr ?? 0.02
  const workers = hyper?.workers ?? 4
  const numGpus = hyper?.numGpus ?? 1
  const baseConfig = hyper?.baseConfig ?? 'configs/faster_rcnn/faster_rcnn_r50_fpn_1x_coco.py'
  const totalBatch = Math.max(1, (hyper?.batch ?? 2) * numGpus)
  const names = classes.map(q).join(', ')

  const samplesPerGpu = Math.max(1, Math.round(totalBatch / numGpus))
  const splits = presentSplits(splitCounts)

  const classesTxt = classes.join('\n') + '\n'

  const annFile = (sp: SplitKey) => `annotations/instances_${sp}.json`
  const imgPrefix = (sp: SplitKey) => `${sp}/`

  const datasetsBlock =
    `train_dataset = dict(\n` +
    `    type=dataset_type,\n` +
    `    data_root=data_root,\n` +
    `    ann_file=${q(annFile('train'))},\n` +
    `    img_prefix=${q(imgPrefix('train'))},\n` +
    `    classes=classes,\n` +
    `    pipeline=train_pipeline)\n` +
    `val_dataset = dict(\n` +
    `    type=dataset_type,\n` +
    `    data_root=data_root,\n` +
    `    ann_file=${q(annFile('val'))},\n` +
    `    img_prefix=${q(imgPrefix('val'))},\n` +
    `    classes=classes,\n` +
    `    pipeline=test_pipeline)\n` +
    `test_dataset = val_dataset\n` +
    `data = dict(\n` +
    `    samples_per_gpu=${samplesPerGpu},\n` +
    `    workers_per_gpu=${workers},\n` +
    `    train=train_dataset,\n` +
    `    val=val_dataset,\n` +
    `    test=test_dataset)\n`

  const configPy =
    `# 由 dataset-manager 生成 — MMDetection 训练配置 (Faster R-CNN R50-FPN)\n` +
    `# 安装：\n` +
    `#   pip install -U openmim\n` +
    `#   mim install mmengine mmcv mmdet\n` +
    `# 训练：\n` +
    `#   python tools/train.py configs/${datasetName}_faster_rcnn_r50_fpn_1x.py\n` +
    `# 说明：类别名见同目录 classes.txt，二者必须保持一致\n\n` +
    `classes = (${names})   # 与 classes.txt 一致；顺序即类别 id\n\n` +
    `_base_ = ${q(baseConfig)}\n\n` +
    `data_root = './'\n` +
    `dataset_type = 'CocoDataset'\n\n` +
    `train_pipeline = [\n` +
    `    dict(type='LoadImageFromFile'),\n` +
    `    dict(type='Resize', scale=(1333, 800), keep_ratio=True),\n` +
    `    dict(type='RandomFlip', prob=0.5),\n` +
    `    dict(type='PackDetInputs', meta_keys=('img_id', 'img_path', 'ori_shape', 'img_shape', 'scale_factor')),\n` +
    `]\n` +
    `test_pipeline = [\n` +
    `    dict(type='LoadImageFromFile'),\n` +
    `    dict(type='Resize', scale=(1333, 800), keep_ratio=True),\n` +
    `    dict(type='PackDetInputs', meta_keys=('img_id', 'img_path', 'ori_shape', 'img_shape', 'scale_factor')),\n` +
    `]\n\n` +
    datasetsBlock +
    `model = dict(\n` +
    `    roi_head=dict(\n` +
    `        bbox_head=dict(num_classes=len(classes))))\n\n` +
    `train_cfg = dict(\n` +
    `    max_epochs=${epochs},\n` +
    `    val_begin=1,\n` +
    `    val_interval=1)\n` +
    `optim_wrapper = dict(\n` +
    `    optimizer=dict(type='SGD', lr=${lr}, momentum=0.9, weight_decay=0.0001),\n` +
    `    paramwise_cfg=dict(norm_decay_mult=0.0))\n` +
    `default_hooks = dict(\n` +
    `    logger=dict(interval=50),\n` +
    `    checkpoint=dict(max_keep_ckpts=3, interval=1))\n` +
    `visualizer = dict(vis_backends=[dict(type='LocalVisBackend')])\n` +
    `log_processor = dict(window_size=50)\n` +
    `randomness = dict(seed=1)\n` +
    `runner = dict(type='EpochBasedTrainLoop', max_epochs=${epochs})\n`

  const readme =
    `# ${datasetName} — MMDetection 训练工程（由 dataset-manager 生成）\n\n` +
    `## 目录结构\n` +
    `类别数：${classes.length}（见 classes.txt 与配置内 classes 元组）\n` +
    `- configs/${datasetName}_faster_rcnn_r50_fpn_1x.py  训练配置\n` +
    `- classes.txt                                         类别名（每行一个，与配置一致）\n` +
    `- annotations/instances_*.json                        COCO 标注\n` +
    `- train/ val/ test/                                   图片\n\n` +
    `## 使用\n` +
    `1. 安装：\n` +
    `   pip install -U openmim\n` +
    `   mim install mmengine mmcv mmdet\n` +
    `2. 训练：\n` +
    `   python tools/train.py configs/${datasetName}_faster_rcnn_r50_fpn_1x.py\n` +
    `3. 推理 / 测试：\n` +
    `   python tools/test.py configs/${datasetName}_faster_rcnn_r50_fpn_1x.py <权重.pth> --show\n\n` +
    `## 说明\n` +
    `- 基础模型默认 ${baseConfig}；可改 _base_ 切换（如 yolox / retinanet）。\n` +
    `- 类别增减：同时修改 classes.txt 与配置内 classes 元组，并调整 model.roi_head.bbox_head.num_classes（本配置已用 len(classes) 自动对齐）。\n`

  return [
    { path: `configs/${datasetName}_faster_rcnn_r50_fpn_1x.py`, bytes: enc(configPy) },
    { path: 'classes.txt', bytes: enc(classesTxt) },
    { path: 'README.md', bytes: enc(readme) },
  ]
}

// ---------------------------------------------------------------------------
// Detectron2
// ---------------------------------------------------------------------------

function buildDetectron2(opts: TrainingConfigOptions): ExportFile[] {
  const { datasetName, classes, splitCounts, hyper } = opts
  const lr = hyper?.lr ?? 0.00025
  const maxIter = hyper?.maxIter ?? 9000
  const numGpus = hyper?.numGpus ?? 1
  const baseConfig =
    hyper?.baseConfig ?? 'COCO-Detection/faster_rcnn_R_50_FPN_3x.yaml'
  const imsPerBatch = Math.max(1, hyper?.batch ?? 2) * numGpus
  const namesList = classes.map(q).join(', ')
  const splits = presentSplits(splitCounts)

  const registerLines = splits
    .map(
      (sp) =>
        `    register_coco_instances(\n` +
        `        f'{DATASET_NAME}_${sp}',\n` +
        `        {}, f'{DATA_ROOT}annotations/instances_${sp}.json', f'{DATA_ROOT}${sp}/')\n` +
        `    MetadataCatalog.get(f'{DATASET_NAME}_${sp}').set(thing_classes=CLASSES)`,
    )
    .join('\n')

  const trainPy =
    `# 由 dataset-manager 生成 — Detectron2 训练脚本 (Faster R-CNN R50-FPN)\n` +
    `# 安装（按需选择匹配你 torch 版本的 wheel）：\n` +
    `#   pip install torch torchvision\n` +
    `#   pip install detectron2 -f https://dl.fbaipublicfiles.com/detectron2/wheels/index.html\n` +
    `# 运行：\n` +
    `#   python train_net.py\n` +
    `# 说明：类别名见同目录 classes.txt（与 CLASSES 一致）\n\n` +
    `import os\n` +
    `from detectron2.data import DatasetCatalog, MetadataCatalog, register_coco_instances\n` +
    `from detectron2.config import get_cfg\n` +
    `from detectron2.engine import DefaultTrainer, launch\n` +
    `from detectron2 import model_zoo\n\n` +
    `DATASET_NAME = ${q(datasetName)}\n` +
    `DATA_ROOT = './'\n` +
    `CLASSES = [${namesList}]\n\n` +
    `def register_datasets():\n` +
    `    for split in ['train', 'val', 'test']:\n` +
    `        name = f'{DATASET_NAME}_{split}'\n` +
    `        if DatasetCatalog.exists(name):\n` +
    `            continue\n` +
    registerLines +
    `\n\ndef main():\n` +
    `    cfg = get_cfg()\n` +
    `    cfg.merge_from_file(model_zoo.get_config_file(${q(baseConfig)}))\n` +
    `    cfg.DATASETS.TRAIN = (f'{DATASET_NAME}_train',)\n` +
    `    cfg.DATASETS.TEST = (f'{DATASET_NAME}_val',)\n` +
    `    cfg.MODEL.ROI_HEADS.NUM_CLASSES = len(CLASSES)\n` +
    `    cfg.MODEL.WEIGHTS = model_zoo.get_checkpoint_url(${q(baseConfig)})\n` +
    `    cfg.SOLVER.BASE_LR = ${lr}\n` +
    `    cfg.SOLVER.MAX_ITER = ${maxIter}\n` +
    `    cfg.SOLVER.IMS_PER_BATCH = ${imsPerBatch}\n` +
    `    cfg.DATALOADER.NUM_WORKERS = ${hyper?.workers ?? 4}\n` +
    `    cfg.OUTPUT_DIR = './output'\n` +
    `    os.makedirs(cfg.OUTPUT_DIR, exist_ok=True)\n` +
    `    trainer = DefaultTrainer(cfg)\n` +
    `    trainer.resume_or_train()\n` +
    `    trainer.test(cfg, trainer.model)\n\n` +
    `if __name__ == '__main__':\n` +
    `    register_datasets()\n` +
    `    launch(\n` +
    `        main,\n` +
    `        num_gpus=${numGpus},\n` +
    `        num_machines=1,\n` +
    `        machine_rank=0,\n` +
    `        dist_url='tcp://127.0.0.1:12345',\n` +
    `        args=(),\n` +
    `    )\n`

  const classesTxt = classes.join('\n') + '\n'

  const readme =
    `# ${datasetName} — Detectron2 训练工程（由 dataset-manager 生成）\n\n` +
    `## 目录结构\n` +
    `类别数：${classes.length}（见 classes.txt 与 train_net.py 内 CLASSES）\n` +
    `- train_net.py        训练入口\n` +
    `- classes.txt         类别名（每行一个，与 CLASSES 一致）\n` +
    `- annotations/instances_*.json   COCO 标注\n` +
    `- train/ val/ test/             图片\n\n` +
    `## 使用\n` +
    `1. 安装（匹配 torch 版本）：\n` +
    `   pip install torch torchvision\n` +
    `   pip install detectron2 -f https://dl.fbaipublicfiles.com/detectron2/wheels/index.html\n` +
    `2. 训练：\n` +
    `   python train_net.py\n` +
    `3. 测试：\n` +
    `   python train_net.py   # 含 trainer.test；或自行加载 output/model_final.pth 评估\n\n` +
    `## 说明\n` +
    `- 基础模型默认 ${baseConfig}；可在 main() 内改 model_zoo.get_config_file/get_checkpoint_url。\n` +
    `- 类别增减：同步修改 classes.txt 与 train_net.py 的 CLASSES 列表，并设置 MODEL.ROI_HEADS.NUM_CLASSES = len(CLASSES)（本脚本已自动）。\n`

  return [
    { path: 'train_net.py', bytes: enc(trainPy) },
    { path: 'classes.txt', bytes: enc(classesTxt) },
    { path: 'README.md', bytes: enc(readme) },
  ]
}

/**
 * 生成指定框架的训练工程配置文件（不含数据本身）。
 * 数据由 exportBrowser 按框架匹配格式生成后，与本结果合并进同一 ZIP。
 */
export function generateTrainingConfigFiles(opts: TrainingConfigOptions): ExportFile[] {
  switch (opts.framework) {
    case 'yolov8':
      return buildYoloV8(opts)
    case 'mmdetection':
      return buildMMDetection(opts)
    case 'detectron2':
      return buildDetectron2(opts)
  }
}
