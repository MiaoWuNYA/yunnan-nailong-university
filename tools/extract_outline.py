#!/usr/bin/env python3
"""从抠图 alpha 通道提取 220 顶点剪影轮廓，输出可直接粘进 shapes.js 的 JS 片段。

用法: python3 tools/extract_outline.py [抠图png] [顶点数]
默认: daishu.png, 220 点

为什么不用射线法：射线法要求剪影对质心是星形（每个方向只有一条边界）。原奶龙圆头
圆脑、手臂张开，接近星形，所以射线法能到 IoU 0.9918。袋鼠是坐姿 + 翘尾巴，尾巴与
身体之间、两耳之间有深凹口，射线法会把凹口全部拉直，实测 IoU 只有 0.56。

这里改成：findContours 取真实外轮廓 → 起点对齐到正上方 → 沿周长弧长均匀取 220 点 →
统一顺时针。顶点顺序、起点相位、旋转方向三者都与 shapes.js 的其它形状一致，补间时
逐点对应不打结，同时轮廓紧贴本体（IoU > 0.99）。
"""
import sys

import cv2
import numpy as np
from PIL import Image

PNG = sys.argv[1] if len(sys.argv) > 1 else 'daishu.png'
N = int(sys.argv[2]) if len(sys.argv) > 2 else 220

al = np.asarray(Image.open(PNG).convert('RGBA'))[:, :, 3]
H, W = al.shape
ys, xs = np.where(al > 128)
cx, cy = float(xs.mean()), float(ys.mean())

# --- 1. 真实外轮廓（最长的那条）---
cnts, _ = cv2.findContours((al > 128).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
c = max(cnts, key=cv2.contourArea).reshape(-1, 2).astype(np.float64)

# --- 2. 统一为屏幕坐标下的顺时针（signed area > 0 即视觉顺时针）---
area = 0.5 * np.sum(c[:, 0] * np.roll(c[:, 1], -1) - np.roll(c[:, 0], -1) * c[:, 1])
if area < 0:
    c = c[::-1]

# --- 3. 起点对齐到正上方：取 y 最小处 ---
i0 = int(np.argmin(c[:, 1]))
c = np.roll(c, -i0, axis=0)
c = np.vstack([c, c[:1]])                     # 闭合

# --- 4. 弧长均匀重采样 N 点 ---
seg = np.hypot(np.diff(c[:, 0]), np.diff(c[:, 1]))
acc = np.concatenate([[0.0], np.cumsum(seg)])
L = acc[-1]
target = np.linspace(0.0, L, N, endpoint=False)
pts = []
for s in target:
    k = int(np.searchsorted(acc, s, 'right') - 1)
    k = min(k, len(seg) - 1)
    t = (s - acc[k]) / seg[k] if seg[k] > 0 else 0.0
    pts.append(c[k] + (c[k + 1] - c[k]) * t)
pts = np.array(pts)

# --- 5. 归一化到最大半径 1 ---
rel = pts - np.array([cx, cy])
rmax = float(np.hypot(rel[:, 0], rel[:, 1]).max())
norm = rel / rmax

# --- 6. 自检：轮廓多边形与原剪影的 IoU ---
mask = np.zeros((H, W), np.uint8)
cv2.fillPoly(mask, [np.round(pts).astype(np.int32)], 1)
sil = (al > 128).astype(np.uint8)
iou = int((mask & sil).sum()) / int((mask | sil).sum())

# --- 7. 输出 JS 片段 ---
lines = []
for i in range(0, N, 8):
    chunk = ','.join('[%.4f,%.4f]' % (p[0], p[1]) for p in norm[i:i + 8])
    lines.append('    ' + chunk + (',' if i + 8 < N else ''))
js = '  const NAILONG = [\n' + '\n'.join(lines) + '\n  ];'

at = [round(cx / W, 4), round(cy / H, 4)]
k = round(2 * rmax / H, 4)
with open('tools/outline_out.js', 'w') as f:
    f.write(js + '\n')
    f.write('  // 源图 %dx%d  质心 (%.1f, %.1f)  最大半径 %.1f px  IoU %.4f\n'
            % (W, H, cx, cy, rmax, iou))
    f.write('  // main: { outer: NAILONG, inner: zeroPts(N), at: [%.4f, %.4f], k: %.4f },\n'
            % (at[0], at[1], k))

print('源图 %dx%d  质心 (%.1f, %.1f)  最大半径 %.1f px  周长 %.0f px' % (W, H, cx, cy, rmax, L))
print('at = [%.4f, %.4f]   k = %.4f' % (at[0], at[1], k))
print('轮廓 vs 剪影 IoU = %.4f   (原奶龙 0.9918)' % iou)
print('相邻顶点间距 %.1f px (周长/220)' % (L / N))
print('片段已写入 tools/outline_out.js')
