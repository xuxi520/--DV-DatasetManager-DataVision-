"""导出 EfficientNet-B0 特征提取变体为 ONNX（输出 1280 维，供相似检索 / 降维 / 离群）。

用法：
    pip install torch torchvision onnx
    python scripts/export-efficientnet.py
产出：public/models/efficientnet-b0.onnx

说明：
- 去掉分类头（1000 类 logits），保留全局平均池化后的 1280 维视觉特征，
  与 src/embed/embedModel.ts 的预处理（224×224 / RGB / ImageNet 归一化）一致。
- 该文件属「构建资产」，不进源码仓库；构建/分发时由 public/models/ 打包进产物。
"""
import os
import torch
import torchvision
from torchvision.models import efficientnet_b0, EfficientNet_B0_Weights

weights = EfficientNet_B0_Weights.IMAGENET1K_V1
m = efficientnet_b0(weights=weights).eval()

# 特征提取变体：features -> [B,1280,7,7] -> 全局平均池化 -> [B,1280,1,1] -> 展平 [B,1280]
extractor = torch.nn.Sequential(
    m.features,
    torch.nn.AdaptiveAvgPool2d(1),
    torch.nn.Flatten(1),
).eval()

dummy = torch.randn(1, 3, 224, 224)
out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public", "models"))
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "efficientnet-b0.onnx")

torch.onnx.export(
    extractor,
    dummy,
    out_path,
    input_names=["input"],
    output_names=["features"],
    opset_version=17,
    dynamo=False,
)

print(f"exported -> {out_path}")
