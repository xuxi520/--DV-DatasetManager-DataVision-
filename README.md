# DV-DatasetManager（DataVision）

> 本地优先的 AI 数据集管理与清洗工具——开文件夹即用，离线可用，无需上传云端，无需配置 Python 环境。

![screenshot](docs/screenshot-main.png) <!-- 发布前替换为实际主界面截图 -->

---

## 这是什么

一个面向计算机视觉数据集的**本地优先**桌面工具，把"浏览 → 清洗 → 转换 → 统计 → 标注"整合在一个开文件夹即用的客户端里，对标 CVAT / Label Studio 的轻量版，但**不依赖服务端、不上传数据**。

### 解决的痛点

- **Roboflow 类云端工具**：数据必须上传，存在隐私 / 合规 / 离线不可用风险，大库付费。
- **CVAT / Label Studio**：重、需服务端部署，偏向"造数据"而非"管 / 洗已有数据"，浏览体验弱。
- **LabelImg / VoTT**：已停更或仅标注，无统计 / 去重 / 质量 / 格式转换。

本工具补的空白：**本地优先、开文件夹即用、浏览 + 清洗 + 转换 + 质量一体化**的轻量原生桌面工具。

---

## 核心功能

- **开文件夹即用**：本地目录直接加载，无需上传、无需 Python 环境；浏览器版（Chrome / Edge）也能直接打开使用。
- **数据集结构自动识别**：YOLO / COCO / VOC / LabelMe / 分类文件夹自动识别，`train/val/test` 子集权威识别。
- **多窗格对照浏览**：最多 6 个独立窗格，各自筛选 / 排序 / 选中，适合对照清洗。
- **全类型标注可视化**：`bbox` / 旋转框 `OBB` / 关键点 `keypoints` / 分割掩码 `mask(RLE)` / `polygon`。
- **轻量标注编辑（清洗台）**：移动 / 缩放 / 旋转框 / 拖拽关键点 / 删除 / 改类别 / 补画框；支持撤销重做与脏文件标记，直接写回原格式。
- **去重与泄漏检测**：MD5 完全重复 + pHash / dHash / aHash 近重复；`train/val/test` 不交叉；跨子集泄漏检测。
- **质量检查**：模糊 / 过暗 / 过亮 / 低分辨率 / 单色检测 + 0–100 评分 + HTML / PDF 报告导出。
- **统计可视化**（ECharts）：类别分布、子集 / 类型 / 宽高比 / 目标尺寸、分辨率 / 文件大小。
- **一键导出**：YOLO / COCO / VOC / DOTA / LabelMe + 训练框架工程配置（YOLOv8 / MMDetection / Detectron2）+ 按比例重划分。
- **规模化算力**：Web Worker 池并行 + IndexedDB 缓存，万级图片无碍。
- **隐私优先**：纯本地运行，**无任何联网 / 遥测**。

---

## 支持的格式

| 方向 | 格式 |
|------|------|
| 导入 | YOLO（含 OBB / pose 变体）、COCO、VOC、LabelMe、DOTA（OBB）、分类文件夹 |
| 导出 | YOLO、COCO、VOC、DOTA、LabelMe |
| 标注类型 | bbox、旋转框 OBB、关键点、分割掩码（RLE / polygon）、polygon |

---

## 安装与运行

1. 前往 **Releases** 页面，下载 Windows 安装包：
   - `DV-DatasetManager_x.y.z_x64-setup.exe`（NSIS 安装向导），或
   - `DV-DatasetManager_x.y.z_x64.msi`（Windows Installer）。
2. 系统要求：**Windows 10 / 11**，并安装 **Microsoft Edge WebView2 Runtime**（安装包会按需自动引导安装；若本机缺失可在 [微软官网](https://developer.microsoft.com/microsoft-edge/webview2/) 单独获取）。
3. 双击安装并启动。

### Windows SmartScreen 拦截怎么办

本版本为**未签名发布版**（个人 / 早期项目暂无代码签名证书），首次运行时 Windows 可能弹出"Windows 已保护你的电脑 (SmartScreen)"。这是正常现象，并非病毒：

1. 在拦截对话框点击 **"更多信息"**；
2. 点击 **"仍要运行"**。

若你希望彻底避免该提示，可自行对安装包进行代码签名（详见下方"给进阶用户的说明"）。

---

## 快速上手（3 步）

1. **打开文件夹**：点击顶部"加载"，选择含图片与标注的数据集目录（或在浏览器版用 `showDirectoryPicker`）。
2. **浏览与清洗**：左侧文件列表筛选（已标注 / 未标注 / 重叠 / 重复）；用画框 / 选择工具顺手修标；质量检查页一键找出模糊 / 过暗 / 极小图。
3. **导出**：导出对话框选择目标格式与训练框架配置，或重划分 `train/val/test` 后导出。

---

## 已知限制（诚实说明）

- **Polygon 绘制**：当前仅支持整体平移，复杂 polygon 的逐点绘制尚未支持（bbox / OBB / 关键点 / mask 编辑已可用）。
- **视频帧数据集**：未支持（涉及时序维度，属范式级重构，规划中）。
- **自动更新**：本版本未内置自动更新，新版本需重新下载安装包。
- **未签名**：见上方 SmartScreen 说明。
- 标注编辑以 bbox / OBB / 关键点 / mask 为主，复杂交互仍在持续完善。

---

## 隐私与数据安全

- 本工具**完全本地运行**，不收集、不上传任何数据，不含任何遥测 / 联网请求。
- 你打开的数据集始终留在你自己的机器上。

---

## 许可与源码

- 本软件以 **免费试用版** 形式分发，仅供**个人学习 / 非商业用途**免费使用。
- **源码未公开**：本仓库当前仅包含发布说明与安装包，**不包含项目源代码**，未按开源许可证（如 MIT / Apache）授权。
- 如需**商业用途**或获取**源代码**，请通过下方渠道联系作者。
- 商标与著作权归作者所有。

> 注：本README对应的产品名为 DV-DatasetManager（DataVision），版本见各 Release 标签。

---

## 反馈与联系

- 问题反馈 / 功能建议：在仓库 **Issues** 提出。
- 交流讨论：随发布帖（如 Hacker News Show HN / Reddit r/computervision / 中文社区）留言。
- 商业合作 / 源码授权：通过 Issues 或发布帖联系方式私信作者。

欢迎试用，并告诉我们它是否真的帮到了你的数据集工作 🙌

---

### 给进阶用户的说明（可选）

- **代码签名**：若你有代码签名证书，可用 `signtool sign /fd SHA256 /td SHA256 /tr <timestamp-url> /f cert.pfx DV-DatasetManager_x.y.z_x64.msi` 对安装包签名，消除 SmartScreen 拦截。
- **自行构建**：本仓库不含构建源码；如需自行从源码构建，请联系作者获取源码与构建指引（前置：Rust 工具链 + MSVC 构建工具 + Node.js + pnpm，执行 `pnpm install && pnpm tauri build`）。
