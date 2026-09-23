#!/usr/bin/env python3
"""12n 定门槛用的一张图:23 张的 (甲面Y, 甲面C),按**人眼判**上色,现行门槛画成线。
判据律:门槛该定在哪,看数据长什么样比看一张表直观。这张图不下结论,只把点摆出来。"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(HERE, 'nail-tier.json')))
rows = json.load(open(sys.argv[1]))['行']

# 🔴 中文必须用中文字体,PIL 默认字体画中文是一串方块(第一版就是这样出的图)
def _font(sz):
    for f in ('/System/Library/Fonts/STHeiti Medium.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc'):
        try: return ImageFont.truetype(f, sz)
        except Exception: pass
    return ImageFont.load_default()
F, FS, FT = _font(20), _font(15), _font(24)

COLOR = {'浅': (70, 150, 230), '深·鲜明': (215, 60, 60), '深·不鲜明': (150, 110, 60),
         '纯黑': (30, 30, 30), '混': (150, 60, 180)}
def eye(r):
    e = (r.get('人眼档') or '').split('(')[0].strip()
    return e if e in COLOR else '混'

W, H, M = 1400, 900, 90
XMAX, YMAX = 200.0, 80.0     # Y 轴 = 甲面Y(0–200)· X 轴 = 甲面C(0–80)
im = Image.new('RGB', (W, H), (252, 250, 246))
d = ImageDraw.Draw(im)
def px(c, y): return (M + c / XMAX * (W - 2 * M), H - M - y / YMAX * (H - 2 * M))
# 这里 x=Y(亮度) y=C(色度) 更直观:横轴亮度、纵轴色度
def pt(Yv, Cv): return (M + Yv / XMAX * (W - 2 * M), H - M - Cv / YMAX * (H - 2 * M))

for v in range(0, 201, 20):
    x = M + v / XMAX * (W - 2 * M)
    d.line([(x, M), (x, H - M)], fill=(232, 228, 220))
    d.text((x - 8, H - M + 8), str(v), fill=(120, 110, 100), font=FS)
for v in range(0, 81, 10):
    y = H - M - v / YMAX * (H - 2 * M)
    d.line([(M, y), (W - M, y)], fill=(232, 228, 220))
    d.text((M - 34, y - 8), str(v), fill=(120, 110, 100), font=FS)

# 现行门槛
yt, ct, by = T['Y门槛'], T['C门槛'], T['纯黑_Y上限']
x = M + yt / XMAX * (W - 2 * M); d.line([(x, M), (x, H - M)], fill=(70, 150, 230), width=3)
d.text((x + 6, M + 6), f'浅 Y≥{yt}', fill=(70, 150, 230), font=F)
y = H - M - ct / YMAX * (H - 2 * M); d.line([(M, y), (W - M, y)], fill=(215, 60, 60), width=3)
d.text((W - M - 150, y - 26), f'鲜明 C≥{ct}', fill=(215, 60, 60), font=F)
x = M + by / XMAX * (W - 2 * M); d.line([(x, M), (x, H - M)], fill=(30, 30, 30), width=2)
d.text((x + 4, H - M - 30), f'纯黑 Y≤{by}', fill=(30, 30, 30), font=F)

for r in rows:
    if r['甲面Y'] is None: continue
    p = pt(min(r['甲面Y'], XMAX), min(r['甲面C'], YMAX))
    c = COLOR[eye(r)]
    ok = (r['甲色档'] == eye(r))
    d.ellipse([p[0] - 9, p[1] - 9, p[0] + 9, p[1] + 9], fill=c, outline=(255, 255, 255) if ok else (255, 0, 0), width=2 if ok else 4)
    d.text((p[0] + 12, p[1] - 9), r['f'][:2], fill=(60, 55, 50), font=F)

d.text((M, 22), '23 张真掩膜:横轴 = 甲面亮度 Y · 纵轴 = 甲面色度 C(去高光中位数口径)', fill=(50, 45, 40), font=FT)
d.text((M, 54), '点的颜色 = 人眼判的档;红圈 = 机器判与人眼判不一致。竖线横线 = 现行门槛(一个字没改)', fill=(120, 110, 100), font=F)
lx, ly = W - M - 200, M + 20
for k, c in COLOR.items():
    d.ellipse([lx, ly, lx + 14, ly + 14], fill=c); d.text((lx + 22, ly - 3), k, fill=(60, 55, 50), font=F); ly += 28
out = sys.argv[2]
im.save(out, 'PNG')
print('图:', out)
