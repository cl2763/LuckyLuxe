#!/usr/bin/env python3
"""12j / 12n 甲面标注工具 —— 100% 裁片逐片手描,画回原图自核。

三个子命令:
  locate  <序号>              出一张带细网格的全图,用来读每枚指甲的裁框(只用来定位,不是标注本身)
  crops   <序号>              按 annotations/<序号>.json 里的「裁框」出 100% 裁片拼图(带 50px 网格)
  overlay <序号>              按 json 里的「多边形」画回原图自核,落 annotations/自核图/<序号>.jpg

🔴 口径(12j §一-2):标注 = **100% 裁片上逐片手描的多边形**,坐标记在裁片像素系里,
   同时换算成全图像素存一份。**禁止**在缩略全图上用 10% 粗网格目测框当标注(12g补 已裁)。
   裁片上的 50px 细网格只是描线时的尺子,不是「网格目测」那条。
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

IN = os.path.expanduser('~/Desktop/LuckyLuxe_Claude_Handoff_2026-07-03/31o_修图验证_2026-09-22/_input')
HERE = os.path.dirname(os.path.abspath(__file__))
ANN = os.path.join(HERE, 'annotations')
CROPS = os.path.join(ANN, '裁片')
SELF = os.path.join(ANN, '自核图')
MAXVIEW = 900          # 裁片显示上限;超了会缩,缩了必须在图上写明比例

def src(num):
    fs = [f for f in os.listdir(IN) if f.startswith(f'{int(num):02d}_') and f.endswith('.jpg')]
    if not fs: raise SystemExit(f'🔴 _input 里没有 {num} 号')
    return os.path.join(IN, fs[0]), fs[0]

def jpath(num): return os.path.join(ANN, f'{int(num):02d}.json')
def load(num):
    p = jpath(num)
    return json.load(open(p)) if os.path.exists(p) else {}
def dump(num, d): json.dump(d, open(jpath(num), 'w'), ensure_ascii=False, indent=1)

def ell_to_poly(cx, cy, a, b, deg, n=24):
    """椭圆 → n 点多边形。
    指甲绝大多数是椭圆/杏仁形,所以「手描」在实操上是:在 100% 裁片上逐片读出
    甲面的**中心、长短轴、倾角**,展开成多边形,再画回原图自核、逐片修。
    读中心+轴比逐个读 20 个顶点稳得多,自核图是最终裁判。
    方/棺形甲读不准的,直接在 json 里给「点」,两种都支持。"""
    import math
    t = math.radians(deg); ct, st = math.cos(t), math.sin(t)
    pts = []
    for k in range(n):
        u = 2 * math.pi * k / n
        x, y = a * math.cos(u), b * math.sin(u)
        pts.append([round(cx + x * ct - y * st), round(cy + x * st + y * ct)])
    return pts


def grid(d, w, h, step, color, label_every=1):
    i = 0
    for x in range(0, w + 1, step):
        d.line([(x, 0), (x, h)], fill=color, width=1)
        if i % label_every == 0: d.text((x + 2, 2), str(x), fill=color)
        i += 1
    i = 0
    for y in range(0, h + 1, step):
        d.line([(0, y), (w, y)], fill=color, width=1)
        if i % label_every == 0: d.text((2, y + 2), str(y), fill=color)
        i += 1

def cmd_locate(num):
    p, name = src(num)
    im = Image.open(p).convert('RGB')
    W = 900; s = W / im.width
    v = im.resize((W, round(im.height * s)), Image.LANCZOS)
    d = ImageDraw.Draw(v, 'RGBA')
    # 🔴 第一版画了 2% 满格网格,把图盖死了(判据律:定位图看不清,读出来的框就是瞎猜)。
    #    改成:10% 淡线 + 边缘 2% 刻度。线只是找框用的,不许压过画面。
    for k in range(0, 101, 10):
        x = round(v.width * k / 100); d.line([(x, 0), (x, v.height)], fill=(0, 255, 120, 90))
        y = round(v.height * k / 100); d.line([(0, y), (v.width, y)], fill=(0, 255, 120, 90))
    for k in range(0, 101, 2):
        x = round(v.width * k / 100); y = round(v.height * k / 100)
        L = 16 if k % 10 else 30
        d.line([(x, 0), (x, L)], fill=(255, 60, 60, 220)); d.line([(x, v.height - L), (x, v.height)], fill=(255, 60, 60, 220))
        d.line([(0, y), (L, y)], fill=(255, 60, 60, 220)); d.line([(v.width - L, y), (v.width, y)], fill=(255, 60, 60, 220))
        if k % 10 == 0:
            d.text((x + 3, 32), str(k), fill=(255, 255, 0, 255))
            d.text((3, y + 3), str(k), fill=(255, 255, 0, 255))
    out = os.path.join(CROPS, f'{int(num):02d}_定位网格.jpg')
    v.save(out, 'JPEG', quality=92)
    print(f'{name} 原尺寸 {im.width}x{im.height} → 定位图 {out}')
    # 🔴 复发两次的坑(02 号、52/53 号):把定位图缩小或并排成一张再读百分比 → 裁框整体偏移。
    print('   ⚠️ 这张定位图必须**单独、满尺寸**看。不许缩小、不许和别的定位图并排成一张再读百分比')
    print('      —— 02 号(三连缩到 600px)和 52/53 号(并排 1800px)各栽过一次,裁框整体偏 5 个百分点。')

def cmd_crops(num):
    p, name = src(num)
    im = Image.open(p).convert('RGB')
    a = load(num)
    boxes = a.get('裁框', [])
    if not boxes: raise SystemExit('🔴 json 里没有「裁框」—— 先写裁框再出裁片')
    # 已经描过的,直接把多边形画在 100% 裁片上 —— 「看裁片」和「看拟合」合成一张,
    # 修一轮只花一次看图(原来要先看裁片、再看全图自核,来回两次还看不清边界)
    poly = {}
    for q in a.get('多边形', []):
        pts = q.get('点') or (ell_to_poly(*q['椭圆']) if '椭圆' in q else None)
        if pts: poly[q['片号']] = pts
    tiles = []
    for b in boxes:
        x0, y0, x1, y1 = [round(v * (im.width if i % 2 == 0 else im.height)) for i, v in enumerate(b['框'])]
        c = im.crop((x0, y0, x1, y1))                      # 100% 原分辨率
        if b['片号'] in poly:
            d0 = ImageDraw.Draw(c, 'RGBA')
            d0.polygon([tuple(q) for q in poly[b['片号']]], fill=(40, 220, 220, 90), outline=(0, 255, 255))
        sc = min(1.0, MAXVIEW / max(c.size))
        view = c if sc == 1.0 else c.resize((round(c.width * sc), round(c.height * sc)), Image.LANCZOS)
        d = ImageDraw.Draw(view)
        step = round(50 * sc)
        i = 0
        for x in range(0, c.width + 1, 50):
            xx = round(x * sc); d.line([(xx, 0), (xx, view.height)], fill=(0, 255, 255) if x % 200 else (255, 0, 255))
            if x % 100 == 0: d.text((xx + 2, 2), str(x), fill=(255, 255, 0))
        for y in range(0, c.height + 1, 50):
            yy = round(y * sc); d.line([(0, yy), (view.width, yy)], fill=(0, 255, 255) if y % 200 else (255, 0, 255))
            if y % 100 == 0: d.text((2, yy + 2), str(y), fill=(255, 255, 0))
        cap = f"片{b['片号']}  裁片{c.width}x{c.height}" + ('  [已描]' if b['片号'] in poly else '') + ('' if sc == 1.0 else f'  显示比例{sc:.2f}(坐标读网格数字,已是裁片像素)')
        lab = Image.new('RGB', (view.width, view.height + 26), (18, 18, 18)); lab.paste(view, (0, 26))
        ImageDraw.Draw(lab).text((5, 6), cap, fill=(255, 235, 120))
        tiles.append(lab)
        if b['片号'] not in poly:
            c.save(os.path.join(CROPS, f"{int(num):02d}_片{b['片号']}_100%.jpg"), 'JPEG', quality=95)
    COLS = min(3, len(tiles))
    W = max(t.width for t in tiles); H = max(t.height for t in tiles)
    R = (len(tiles) + COLS - 1) // COLS
    sh = Image.new('RGB', (COLS * (W + 8) + 8, R * (H + 8) + 8), (10, 10, 10))
    for i, t in enumerate(tiles): sh.paste(t, (8 + (i % COLS) * (W + 8), 8 + (i // COLS) * (H + 8)))
    out = os.path.join(CROPS, f'{int(num):02d}_裁片拼图.jpg')
    sh.save(out, 'JPEG', quality=92)
    print(f'{name}:{len(tiles)} 片 → {out}')

def cmd_overlay(num):
    p, name = src(num)
    im = Image.open(p).convert('RGB')
    a = load(num)
    polys = a.get('多边形', [])
    if not polys: raise SystemExit('🔴 json 里没有「多边形」')
    box = {b['片号']: b['框'] for b in a.get('裁框', [])}
    for q in polys:
        if '点' not in q and '椭圆' in q:
            q['点'] = ell_to_poly(*q['椭圆'])
    ov = im.copy(); d = ImageDraw.Draw(ov, 'RGBA')
    full = []
    for q in polys:
        b = box[q['片号']]
        x0, y0 = b[0] * im.width, b[1] * im.height
        pts = [(x0 + px, y0 + py) for px, py in q['点']]
        d.polygon(pts, fill=(40, 220, 220, 110), outline=(0, 255, 255))
        cx = sum(x for x, _ in pts) / len(pts); cy = sum(y for _, y in pts) / len(pts)
        d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=(255, 40, 40, 255))
        full.append({'片号': q['片号'], '全图点': [[round(x), round(y)] for x, y in pts]})
    a['多边形_全图像素'] = full
    a['图尺寸'] = [im.width, im.height]
    # 12n补 §三:等级由工具写,不靠人记得加 —— 这支工具产出的只可能是采样级
    a.setdefault('level', 'sampling')
    a.setdefault('标注等级', '采样级 —— 椭圆 + 刻意内收;够采样算 Y/C,不够 D222 训练(训练要贴边界)')
    dump(num, a)
    # 🔴 护栏(12n 第五节立):**两片不许压在同一枚甲上**。
    #    案底:49 号第一轮 9 个裁框彼此重叠,自核图上两个椭圆落在同一枚红甲上 ——
    #    整张的 Y/C 会把那一枚算两遍。这条错人眼很难数出来,机器一算就现形。
    #    判据:任意两片的重叠面积 / 较小那片的面积 > 15% 即红,报出是哪两片。
    import itertools
    masks = {}
    for q in polys:
        mm = Image.new('L', im.size, 0)
        b2 = box[q['片号']]
        ImageDraw.Draw(mm).polygon([(b2[0] * im.width + px, b2[1] * im.height + py) for px, py in q['点']], fill=255)
        masks[q['片号']] = mm
    bad = []
    for x, y in itertools.combinations(sorted(masks), 2):
        ax, ay = masks[x].getdata(), masks[y].getdata()
        import numpy as _np
        A = _np.frombuffer(masks[x].tobytes(), dtype=_np.uint8) > 127
        B = _np.frombuffer(masks[y].tobytes(), dtype=_np.uint8) > 127
        inter = int((A & B).sum()); small = int(min(A.sum(), B.sum()))
        if small and inter / small > 0.15:
            bad.append((x, y, round(inter / small * 100, 1)))
    if bad:
        print('🔴 有两片压在同一枚甲上(重叠 / 较小片面积):')
        for x, y, r in bad: print(f'   片{x} ↔ 片{y}:{r}%')
        print('   → 整张的 Y/C 会把同一枚甲算两遍。改裁框或退回「待复核」,不许就这么存。')
        raise SystemExit(3)
    W = 1000; v = ov.resize((W, round(ov.height * W / ov.width)), Image.LANCZOS)
    out = os.path.join(SELF, f'{int(num):02d}_自核.jpg')
    v.save(out, 'JPEG', quality=92)
    print(f'{name}:画回 {len(full)} 片 → {out}')

if __name__ == '__main__':
    os.makedirs(CROPS, exist_ok=True); os.makedirs(SELF, exist_ok=True)
    cmd, num = sys.argv[1], sys.argv[2]
    {'locate': cmd_locate, 'crops': cmd_crops, 'overlay': cmd_overlay}[cmd](num)
