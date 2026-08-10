#!/usr/bin/env python3
"""生成 RhythmScore 液态玻璃图标:1024px PNG → iconset → icns"""
import math
import os
import subprocess
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'build')
os.makedirs(OUT_DIR, exist_ok=True)
PNG = os.path.join(OUT_DIR, 'rhythmscore-icon.png')
ICNS = os.path.join(OUT_DIR, 'rhythmscore.icns')


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# 径向渐变(玻璃面板:中心亮蓝 → 边缘深蓝)
C_CENTER = (170, 208, 248)
C_MID = (74, 140, 215)
C_EDGE = (8, 42, 78)
cx, cy, r = SIZE * 0.34, SIZE * 0.22, SIZE * 0.95

grad = Image.new('RGB', (SIZE, SIZE))
px = grad.load()
for y in range(SIZE):
    for x in range(SIZE):
        d = math.hypot(x - cx, y - cy) / (r * SIZE)
        if d >= 1:
            col = C_EDGE
        elif d < 0.55:
            col = lerp(C_CENTER, C_MID, d / 0.55)
        else:
            col = lerp(C_MID, C_EDGE, (d - 0.55) / 0.45)
        px[x, y] = col
grad = grad.filter(ImageFilter.GaussianBlur(0.8))

# 圆角 mask
mask = Image.new('L', (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=256, fill=255)
icon = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
icon.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(icon, 'RGBA')

# 顶部月牙高光(窄弧,顶部 25% 内)
hl = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
ImageDraw.Draw(hl).ellipse([-SIZE * 0.15, -SIZE * 0.4, SIZE * 1.15, SIZE * 0.28], fill=(255, 255, 255, 105))
hl = hl.filter(ImageFilter.GaussianBlur(24))
icon.alpha_composite(hl)

# 玻璃描边(半透明白)
d.rounded_rectangle([6, 6, SIZE - 7, SIZE - 7], radius=250, outline=(255, 255, 255, 210), width=8)

# 光斑
def blob(x, y, rad, alpha):
    b = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(b).ellipse([x - rad, y - rad, x + rad, y + rad], fill=(255, 255, 255, alpha))
    icon.alpha_composite(b.filter(ImageFilter.GaussianBlur(rad * 0.4)))

blob(170, 880, 220, 32)
blob(900, 200, 150, 36)
blob(720, 780, 80, 22)

# 谱线(三条,居中偏下)
line_w = 28
line_y = [670, 760, 850]
for ly in line_y:
    d.line([170, ly, 854, ly], fill=(255, 255, 255, 240), width=line_w)

# 红色光标竖线(渐变,居中)
cy0, cy1 = 360, 930
CX = 512
for y in range(cy0, cy1 + 1):
    t = (y - cy0) / (cy1 - cy0)
    col = lerp((255, 138, 114), (217, 58, 38), t)
    d.line([CX - 22, y, CX + 22, y], fill=col + (255,))
d.line([CX + 28, cy0 + 6, CX + 28, cy1 - 6], fill=(255, 255, 255, 130), width=10)

# 光标顶部圆点(渐变红 + 高光)
d.ellipse([CX - 72, 286, CX + 72, 430], fill=(217, 58, 38, 255))
d.ellipse([CX - 40, 320, CX, 360], fill=(255, 255, 255, 175))

# 音符(右上,八分音符:椭圆头 + 竖杆 + 旗)
note = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
nd = ImageDraw.Draw(note)
nd.ellipse([680, 400, 770, 490], fill=(255, 255, 255, 235))
nd.rectangle([760, 410, 778, 600], fill=(255, 255, 255, 235))
nd.polygon([(778, 410), (842, 444), (842, 480), (778, 478)], fill=(255, 255, 255, 235))
icon.alpha_composite(note)

# 底部内阴影(玻璃厚度)
sh = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle([6, 6, SIZE - 7, SIZE - 7], radius=250, outline=(0, 18, 50, 130), width=36)
sh = sh.filter(ImageFilter.GaussianBlur(14))
icon.alpha_composite(sh)

# 白色玻璃描边
d.rounded_rectangle([6, 6, SIZE - 7, SIZE - 7], radius=250, outline=(255, 255, 255, 200), width=6)

icon.save(PNG)
print('PNG:', PNG, icon.size)

# --- iconset → icns ---
iconset = os.path.join(OUT_DIR, 'rhythmscore.iconset')
os.makedirs(iconset, exist_ok=True)
sizes = [(16, 'icon_16x16.png'), (32, 'icon_16x16@2x.png'), (32, 'icon_32x32.png'),
         (64, 'icon_32x32@2x.png'), (128, 'icon_128x128.png'), (256, 'icon_128x128@2x.png'),
         (256, 'icon_256x256.png'), (512, 'icon_256x256@2x.png'), (512, 'icon_512x512.png'),
         (1024, 'icon_512x512@2x.png')]
for s, name in sizes:
    icon.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, name))
r = subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', ICNS], capture_output=True, text=True)
print('icns:', ICNS, r.returncode)
if r.returncode != 0:
    print(r.stderr)
