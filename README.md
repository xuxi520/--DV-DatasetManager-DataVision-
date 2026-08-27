# DV-DatasetManager（DataVision）

> 本地优先的 AI 数据集管理与清洗工具 —— 开文件夹即用，离线可用，无需上传云端，无需配置 Python 环境。

**English version below.** ↓

---

## 这是什么 / What is this

一个面向计算机视觉数据集的**本地优先**桌面工具，把"浏览 → 清洗 → 转换 → 统计 → 标注"整合在一个开文件夹即用的客户端里。它对标 CVAT / Label Studio 的轻量版，但**不依赖服务端、不上传数据**。

A **local-first** desktop tool for computer-vision datasets that combines *browse → clean → convert → stats → annotate* in one open-folder-and-go app. A lightweight alternative to CVAT / Label Studio that **needs no server and never uploads your data**.

### 解决的痛点 / Why it exists

- **Roboflow 类云端工具**：数据必须上传，存在隐私 / 合规 / 离线不可用风险，大库付费。
  *Cloud tools force you to upload data — privacy, compliance and offline risks, plus paid tiers for large datasets.*
- **CVAT / Label Studio**：重、需服务端部署，偏向"造数据"而非"管 / 洗已有数据"，浏览体验弱。
  *Heavy, server-based, built for creating rather than managing/cleaning existing data, weak browsing.*
- **LabelImg / VoTT**：已停更或仅标注，无统计 / 去重 / 质量 / 格式转换。
  *Unmaintained or annotation-only, no stats / dedup / quality / format conversion.*<img width="429" height="506" alt="image" src="https://github.com/user-attachments/assets/dcb99416-99b4-47e3-a00a-7f85aa7341e6" />


本工具补的空白：**本地优先、开文件夹即用、浏览 + 清洗 + 转换 + 质量一体化**的轻量原生桌面工具。
*The gap it fills: a lightweight native desktop app that is local-first, open-folder-and-go, and unifies browsing + cleaning + conversion + quality.*
<img width="1069" height="466" alt="image" src="https://github.com/user-attachments/assets/bb4770ac-d703-473e-abac-3d1cb8306fe8" />

---

## 核心功能 / Features

- **开文件夹即用** / **Open-folder-and-go**: 本地目录直接加载，无需上传、无需 Python 环境。
- **数据集结构自动识别** / **Auto structure detection**: YOLO / COCO / VOC / LabelMe / 分类文件夹自动识别，`train/val/test` 子集权威识别。
- **多窗格对照浏览** / **Multi-pane compare**: 最多 6 个独立窗格，各自筛选 / 排序 / 选中，适合对照清洗。
- **全类型标注可视化** / **All annotation types**: `bbox` / 旋转框 `OBB` / 关键点 `keypoints` / 分割掩码 `mask(RLE)` / `polygon`。
- **轻量标注编辑（清洗台）** / **Light annotation editing**: 移动 / 缩放 / 旋转框 / 拖拽关键点 / 删除 / 改类别 / 补画框；polygon 逐点绘制；撤销重做 + 脏文件标记，直接写回原格式。
- **去重与泄漏检测** / **Dedup & leakage**: MD5 完全重复 + pHash / dHash / aHash 近重复；`train/val/test` 不交叉；跨子集泄漏检测。
- **质量检查** / **Quality check**: 模糊 / 过暗 / 过亮 / 低分辨率 / 单色检测 + 0–100 评分 + HTML / PDF 报告导出。
- **统计可视化** / **Stats**: 类别分布、子集 / 类型 / 宽高比 / 目标尺寸、分辨率 / 文件大小（ECharts）。
- **一键导出** / **Export**: YOLO / COCO / VOC / DOTA / LabelMe + 训练框架工程配置（YOLOv8 / MMDetection / Detectron2）+ 按比例重划分。
- **规模化算力** / **Scales**: Web Worker 池并行 + IndexedDB 缓存，万级图片无碍。
- **隐私优先** / **Privacy-first**: 纯本地运行，**无任何联网 / 遥测**。

---<img width="602" height="452" alt="image" src="https://github.com/user-attachments/assets/951dfbb8-39e0-48eb-999f-ad9c7340338e" />


## 支持的格式 / Supported formats

| 方向 / Direction | 格式 / Formats |
|------|------|
| 导入 / Import | YOLO（含 OBB / pose 变体）、COCO、VOC、LabelMe、DOTA（OBB）、分类文件夹 |
| 导出 / Export | YOLO、COCO、VOC、DOTA、LabelMe |
| 标注类型 / Annotation | bbox、旋转框 OBB、关键点、分割掩码（RLE / polygon）、polygon |

---<img width="1720" height="684" alt="image" src="https://github.com/user-attachments/assets/5be982cf-2d5d-4e02-905f-f6e782dc9740" />

<img width="1720" height="684" alt="image" src="https://github.com/user-attachments/assets/1c90c71d-d457-4355-a956-009e859903d4" />

## 下载与安装 / Download & Install

1. 前往仓库 **Releases** 页面，下载 Windows 安装包 **`DV-DatasetManager_1.0.0_x64-setup.exe`**。
   *Go to the **Releases** page and download **`DV-DatasetManager_1.0.0_x64-setup.exe`**.*
2. 系统要求 / Requirements: **Windows 10 / 11**，并安装 **Microsoft Edge WebView2 Runtime**（安装包会按需自动引导安装；若本机缺失可在 [微软官网](https://developer.microsoft.com/microsoft-edge/webview2/) 单独获取）。
3. 双击安装并启动。
   *Double-click to install and launch.*

> 本仓库**仅提供二进制安装包**，不含项目源代码。
> *This repository distributes **binary installers only**; project source code is not included.*

### Windows SmartScreen 拦截怎么办 / About Windows SmartScreen

本版本为**未签名发布版**（个人 / 早期项目暂无代码签名证书），首次运行时 Windows 可能弹出"Windows 已保护你的电脑 (SmartScreen)"。这是正常现象，并非病毒：
*This is an **unsigned** release (no code-signing certificate yet). On first run, Windows may show "Windows protected your PC" (SmartScreen). This is expected and not a virus:*

1. 在拦截对话框点击 **"更多信息"** / click **"More info"**;
2. 点击 **"仍要运行"** / click **"Run anyway"**.

若你希望彻底避免该提示，可自行对安装包进行代码签名（见下方"进阶说明"）。
*To remove the prompt entirely, you can code-sign the installer yourself (see "Notes for advanced users" below).*

---

## 快速上手（3 步）/ Quick start (3 steps)

1. **打开文件夹** / **Open a folder**: 点击顶部"加载"，选择含图片与标注的数据集目录。
   *Click "Load" on the top bar and pick a dataset directory containing images and annotations.*
2. **浏览与清洗** / **Browse & clean**: 左侧文件列表筛选（已标注 / 未标注 / 重叠 / 重复）；用画框 / 选择工具顺手修标；质量检查页一键找出模糊 / 过暗 / 极小图。
   *Use the left file list to filter (annotated / unannotated / overlapping / duplicate); fix labels with the box/select tools; use the Quality page to find blurry / dark / tiny images.*
3. **导出** / **Export**: 导出对话框选择目标格式与训练框架配置，或重划分 `train/val/test` 后导出。
   *In the Export dialog pick a target format and training-framework config, or re-split `train/val/test` before exporting.*

---

## 已知限制 / Known limitations

- **视频帧数据集** / **Video-frame datasets**: 未支持（涉及时序维度，规划中）。
- **自动更新** / **Auto-update**: 本版本未内置，新版本需重新下载安装包。
- **未签名** / **Unsigned**: 见上方 SmartScreen 说明。
- 标注编辑以 bbox / OBB / 关键点 / mask 为主，复杂交互仍在持续完善。
  *Annotation editing focuses on bbox / OBB / keypoints / mask; richer interactions are still improving.*

---

## 隐私与数据安全 / Privacy

- 本工具**完全本地运行**，不收集、不上传任何数据，不含任何遥测 / 联网请求。
  *Runs **fully locally** — no data collection, no uploads, no telemetry, no network calls.*
- 你打开的数据集始终留在你自己的机器上。
  *Your datasets always stay on your own machine.*

---

## 许可 / License

- 本软件以 **免费版** 形式分发，仅供**个人学习 / 非商业用途**免费使用。
  *Distributed as a **free** app for **personal / non-commercial** use.*
- **源码未公开**：本仓库当前仅包含发布说明与安装包，**不包含项目源代码**，未按开源许可证（如 MIT / Apache）授权。
  *Source code is **not public**: this repo contains release notes and installers only, and is **not** licensed under an open-source license (e.g. MIT / Apache).*
- 如需**商业用途**或获取**源代码**，请通过下方渠道联系作者。
  *For **commercial use** or to obtain **source code**, contact the author via the channels below.*
- 商标与著作权归作者所有。
  *Trademarks and copyright belong to the author.*

---

## 反馈与联系 / Feedback & contact

- 问题反馈 / 功能建议：在仓库 **Issues** 提出。
  *Bug reports / feature requests: open an **Issue** in this repo.*
- 商业合作 / 源码授权：通过 Issues 或发布帖联系方式私信作者。
  *Commercial / source-license inquiries: reach the author via Issues or the release post.*

欢迎试用，并告诉我们它是否真的帮到了你的数据集工作 🙌
*Thanks for trying it — let us know if it helps your dataset work!*

---

### 给进阶用户的说明（可选）/ Notes for advanced users (optional)

- **代码签名** / **Code signing**: 若你有代码签名证书，可用
  `signtool sign /fd SHA256 /td SHA256 /tr <timestamp-url> /f cert.pfx DV-DatasetManager_1.0.0_x64-setup.exe`
  对安装包签名，消除 SmartScreen 拦截。
  *If you hold a code-signing certificate, signing the installer removes the SmartScreen prompt.*
- **关于源码** / **On source code**: 本仓库不提供构建源码；需要等到开发完成才上传
  *Source for self-building is not provided here; 
