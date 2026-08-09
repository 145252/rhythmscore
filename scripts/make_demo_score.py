#!/usr/bin/env python3
"""生成一张示例鼓谱 PNG,用于测试动态曲谱软件的画线/分小节功能。"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1600, 1100
bg = (255, 255, 255)
ink = (35, 35, 40)
line = (120, 120, 130)
accent = (55, 138, 221)

img = Image.new("RGB", (W, H), bg)
d = ImageDraw.Draw(img)

try:
    font_title = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 40)
except Exception:
    font_title = ImageFont.load_default()

# 标题
d.text((60, 36), "示例鼓谱 · Demo Rock Groove", fill=ink, font=font_title)
d.text((60, 96), "用于测试:先画横线确定每一行,再画竖线划分小节", fill=(150, 150, 160), font=ImageFont.load_default())

rows = 3
row_h = 260
top0 = 180
margin_x = 70

# 每行的谱线(鼓谱符号简化:两条横线)
for r in range(rows):
    y0 = top0 + r * row_h
    # 谱线(浅灰)
    for ly in (y0 + 60, y0 + 100):
        d.line([(margin_x, ly), (W - margin_x, ly)], fill=line, width=3)
    # 拍号
    d.text((margin_x + 8, y0 + 20), f"行 {r + 1}   4/4", fill=(160, 160, 170), font=ImageFont.load_default())

# 音符符号(圆点 = 鼓点)
import random
random.seed(42)
for r in range(rows):
    y0 = top0 + r * row_h
    n = random.randint(11, 13)
    xs = sorted(random.sample(range(margin_x + 40, W - margin_x - 40), n))
    for x in xs:
        cy = y0 + 60 + random.choice([0, 20, 40, 60])
        d.ellipse([x - 14, cy - 8, x + 14, cy + 8], fill=ink)
        d.line([(x + 14, cy), (x + 30, cy - 46)], fill=ink, width=4)

# 底部说明(竖线只在行内显示)
d.text((margin_x, H - 60), "注:横线 = 行边界;竖线 = 小节线,仅显示在所属行的上下边界之间", fill=(150, 150, 160), font=ImageFont.load_default())

out = "/Users/liuji/Desktop/动态爱马仕/examples/demo-score.png"
import os
os.makedirs(os.path.dirname(out), exist_ok=True)
img.save(out, "PNG")
print(f"saved: {out} ({W}x{H})")
