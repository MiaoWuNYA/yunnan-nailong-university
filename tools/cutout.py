#!/usr/bin/env python3
"""白底照片抠图：亮度阈值 + 低饱和扩展 → 软 alpha → 去白边反混合 → 裁剪缩放。

用法: python3 tools/cutout.py [亮度阈值] [输出高度] [输出前缀] [扩展迭代]
默认: 阈值 215/255, 输出高 700px, 前缀 daishu, 迭代 24

为什么不用 cv2.floodFill 的 loDiff/upDiff：那是"与相邻像素比"，JPEG 软边会提供
连续的渐变链，容差一大就顺着绒毛爬进主体内部（实测容差 14 时主体只剩 0.4%）。

为什么是两级：照片底部有一层地面浅灰（mn 208~250 连续渐变，无硬边），单靠亮度
阈值切不干净。但它是低饱和的中性色，主体是蓝/黄高饱和，于是先用高阈值圈出确定
背景，再在"低饱和且不太暗"的像素上向外扩展，地面被吃掉而主体边缘保住。

产出 <前缀>.png / <前缀>.webp（透明底），并在 /tmp 留两张诊断合成图。
"""
import sys

import cv2
import numpy as np
from PIL import Image

SRC = 'daishu.jpg'
TH = int(sys.argv[1]) if len(sys.argv) > 1 else 215
OUT_H = int(sys.argv[2]) if len(sys.argv) > 2 else 700
PREFIX = sys.argv[3] if len(sys.argv) > 3 else 'daishu'
ITER = int(sys.argv[4]) if len(sys.argv) > 4 else 24

rgb = np.asarray(Image.open(SRC).convert('RGB'))
h, w = rgb.shape[:2]
mn = rgb.min(axis=2).astype(np.float32)
sat = (rgb.max(axis=2).astype(np.float32) - mn)

# --- 1. 确定背景：亮度高于阈值，且与画面边界连通 ---
white = (mn >= TH).astype(np.uint8)
n, lab, _, _ = cv2.connectedComponentsWithStats(white, 8)
lut = np.zeros(n, bool)
for lb in set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1]):
    if lb:
        lut[lb] = True
bg = lut[lab]

# --- 2. 低饱和扩展：把贴着背景的中性浅灰（地面/接触阴影）也并入背景 ---
# 迭代 24 是实测拐点：底部地面残渣从 2822px 降到 302px，而米白腹部保留量恒定不变
# （腹部被高饱和的蓝/黄身体围住，扩展根本走不进去），再往上加迭代也几乎不再变化。
passable = ((mn >= 185) & (sat <= 30)).astype(np.uint8)
k3 = np.ones((3, 3), np.uint8)
for _ in range(ITER):
    grown = (cv2.dilate(bg.astype(np.uint8), k3) & passable).astype(bool)
    if (grown == bg).all():
        break
    bg = bg | grown

# --- 3. 主体 = 非背景，滤掉零散噪点 ---
solid = (~bg).astype(np.uint8)
n2, lab2, stats2, _ = cv2.connectedComponentsWithStats(solid, 8)
min_area = solid.size * 0.0005
keep = np.zeros_like(solid)
for i in range(1, n2):
    if stats2[i, cv2.CC_STAT_AREA] >= min_area:
        keep[lab2 == i] = 1
solid = keep

# --- 4. alpha：几何抗锯齿。不再叠白度软阈值——那会把主体内部的白（徽标白底、
#     眼白、高光）误伤成透明洞，实测能抠出 989px 的假洞 ---
alpha = cv2.GaussianBlur(solid.astype(np.float32), (0, 0), 1.0)

# --- 5. 去白边：按 alpha 反混合，减掉边缘像素里混进去的白色 ---
af = alpha[..., None]
unmixed = (rgb.astype(np.float32) - (1.0 - af) * 255.0) / np.maximum(af, 0.15)
out_rgb = np.clip(unmixed, 0, 255).astype(np.uint8)

# --- 6. 裁到主体 bbox 再等比缩到目标高度 ---
ys, xs = np.where(alpha > 0.5)
pad = 4
y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + 1 + pad)
x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + 1 + pad)
rgba = np.dstack([out_rgb, np.round(alpha * 255).astype(np.uint8)])[y0:y1, x0:x1]
out = Image.fromarray(rgba, 'RGBA')
sc = OUT_H / out.height
out = out.resize((max(1, round(out.width * sc)), OUT_H), Image.LANCZOS)

# --- 7. 体积：WebP 走主路径，PNG 量化到 96 色做兜底（现代浏览器全走 WebP）---
out.save(PREFIX + '.webp', quality=82, method=6)
out.quantize(colors=96, method=Image.FASTOCTREE).save(PREFIX + '.png', optimize=True)

# --- 诊断：黑底看白边/残留，棋盘底看透明度 ---
a = np.asarray(out).astype(np.float32)
ov = a[..., 3:4] / 255.0
Image.fromarray((a[..., :3] * ov).astype(np.uint8)).save('/tmp/cut_black_%s.png' % PREFIX)
yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
chk = np.where((((yy // 24) + (xx // 24)) % 2)[..., None] == 0, 205, 235).astype(np.float32)
Image.fromarray((chk * (1 - ov) + a[..., :3] * ov).astype(np.uint8)).save('/tmp/cut_checker_%s.png' % PREFIX)

al = np.asarray(out)[..., 3]
print('[%s] 阈值 %d → 背景 %.1f%% / 主体 %.1f%%' % (PREFIX, TH, bg.mean() * 100, solid.mean() * 100))
print('    输出 %dx%d  透明 %.1f%%  半透明边缘 %.1f%%'
      % (out.width, out.height, (al < 8).mean() * 100, ((al > 8) & (al < 248)).mean() * 100))
print('    底部(y>1050)残留 solid %.1f%%' % (solid[1050:].mean() * 100))
