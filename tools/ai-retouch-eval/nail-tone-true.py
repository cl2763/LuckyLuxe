#!/usr/bin/env python3
"""12n §一-2 —— 用**手描的真甲面掩膜**重算 甲面 Y / C,出分档表。

与 region-metrics.mjs 的区别只有一个:掩膜来源。
  region-metrics.mjs : 肤色掩膜的「非肤色连通块」粗估 —— 已证在红/蓝粉/墨绿上失效
  本脚本             : tools/segment/annotations/<序号>.json 里逐片手描的多边形

门槛读 nail-tier.json(唯一真相),不在本文件里写死。
用法:python3 nail-tone-true.py <输出json>
"""
import json, os, sys, math
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ANN = os.path.join(ROOT, 'segment', 'annotations')
IN = os.path.expanduser('~/Desktop/LuckyLuxe_Claude_Handoff_2026-07-03/31o_修图验证_2026-09-22/_input')
TIER = json.load(open(os.path.join(HERE, 'nail-tier.json')))
YT, CT = TIER['Y门槛'], TIER['C门槛']
BY, BC = TIER['纯黑_Y上限'], TIER['纯黑_C上限']
MAP = TIER['映射表']
METRIC = TIER['metric']          # 12n补二 §一:口径也读同一份文件,不在这里写死
assert METRIC == 'median_after_p85_trim', f'不认识的口径 {METRIC} —— 口径变了要先改代码,不许静默按老口径跑'


def trimmed(vals_Y, vals_C):
    """12n补二 §一「去高光后的中位数」:
    先去掉 Y 高于本片 p85 的像素(那是亮面甲油的高光,不是甲油的颜色),
    再取剩余像素的 Y 中位数与 C 中位数。
    量的是「这块甲油本身是什么颜色」—— 均值会被高光拉亮(02 号黑甲 53.8),
    低分位会被甲缘阴影和甲沟拉暗,两头都错。"""
    if vals_Y.size < 20: return None, None
    keep = vals_Y <= np.percentile(vals_Y, 85)
    if keep.sum() < 10: keep = np.ones_like(vals_Y, dtype=bool)
    return float(np.median(vals_Y[keep])), float(np.median(vals_C[keep]))

def tier(Y, C):
    """12n补 §二 四档。判法顺序写在 nail-tier.json 里,这里照它实现,不另立一套。
    「纯黑」排在「深·鲜明」前面:黑甲的 C 天生就低,不先接住它就会被冲进「深·不鲜明」。"""
    if Y is None or C is None: t = '取不到'
    elif Y >= YT:              t = '浅'
    elif Y <= BY and C < BC:   t = '纯黑'
    elif C >= CT:              t = '深·鲜明'
    else:                      t = '深·不鲜明'
    return t, MAP[t]

rows = []
for f in sorted(x for x in os.listdir(ANN) if x[:2].isdigit() and x.endswith('.json')):
    a = json.load(open(os.path.join(ANN, f)))
    polys = a.get('多边形_全图像素')
    if not polys:
        print(f'  跳过 {f}:还没画回自核(没有 多边形_全图像素)'); continue
    src = os.path.join(IN, a['文件'])
    im = Image.open(src).convert('RGB')
    m = Image.new('L', im.size, 0); d = ImageDraw.Draw(m)
    for q in polys: d.polygon([tuple(p) for p in q['全图点']], fill=255)
    mask = np.asarray(m) > 127
    ycc = np.asarray(im.convert('YCbCr')).astype(np.float64)
    Y, Cb, Cr = ycc[:, :, 0], ycc[:, :, 1], ycc[:, :, 2]
    if mask.sum() < 50:
        rows.append({'f': a['文件'], '甲面Y': None, '甲面C': None, '甲色档': '取不到', '口令腿': 'A',
                     '片数': len(polys), '甲面占比': 0.0, '掩膜来源': '手描'}); continue
    Cmap = np.sqrt((Cb - 128.0) ** 2 + (Cr - 128.0) ** 2)
    # 🔴 旧口径(全掩膜均值)并排留着对照,12n补二 §一 明确「不删旧数」
    y_old = round(float(Y[mask].mean()), 1)
    c_old = round(float(Cmap[mask].mean()), 1)
    # 12n补 §二:纯黑的 Y 上限要「由黑甲的 Y 分布定」—— 那就得把**每一片**的 Y/C 摆出来,
    # 只给整张的均值定不了门槛(一张里深浅不一的片会被均值抹平)。
    per = []
    for q in polys:
        mm = Image.new('L', im.size, 0)
        ImageDraw.Draw(mm).polygon([tuple(pp) for pp in q['全图点']], fill=255)
        k = np.asarray(mm) > 127
        if k.sum() < 50: continue
        py, pc = trimmed(Y[k], Cmap[k])
        if py is None: continue
        per.append({'片号': q['片号'], 'Y': round(py, 1), 'C': round(pc, 1),
                    'Y_旧均值': round(float(Y[k].mean()), 1),
                    'C_旧均值': round(float(Cmap[k].mean()), 1)})
    if not per:
        rows.append({'f': a['文件'], '甲面Y': None, '甲面C': None, '甲色档': '取不到', '口令腿': 'A',
                     '片数': 0, '甲面占比': 0.0, '掩膜来源': '手描'}); continue
    # 整张 = 各片中位数的中位数(12n补二 §一)
    yv = float(np.median([x['Y'] for x in per]))
    cv = float(np.median([x['C'] for x in per]))
    t, leg = tier(yv, cv)
    rows.append({'f': a['文件'], '甲面Y': round(yv, 1), '甲面C': round(cv, 1),
                 '甲色档': t, '口令腿': leg, '片数': len(polys),
                 '甲面占比': round(float(mask.mean() * 100), 2),
                 '人眼档': a.get('甲色档_人眼'), '掩膜来源': '手描',
                 '口径': METRIC, '甲面Y_旧均值': y_old, '甲面C_旧均值': c_old,
                 'level': a.get('level', 'sampling'), '逐片': per})

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '_真掩膜分档表.json')
json.dump({'门槛': {'Y': YT, 'C': CT, '纯黑_Y上限': BY, '纯黑_C上限': BC},
           '口径': METRIC,
           '口径说明': '每片去掉 Y > p85 的像素(高光)后取中位数;整张 = 各片中位数的中位数。旧均值并排保留,不删(12n补二 §一)。',
           '同套甲判据': '见 同套甲对照表.json;红着就不算定案',
           '标注等级': 'sampling(采样级)—— 椭圆+内收,够算 Y/C,不够训练分割(12n补 §三)',
           '行': rows}, open(out, 'w'), ensure_ascii=False, indent=1)
print(f'\n门槛(读自 nail-tier.json):浅 Y>={YT} · 深鲜明 C>={CT} · 纯黑 Y<={BY} 且 C<{BC}')
print(f'口径:{METRIC}(去掉每片最亮的 15% 再取中位数;整张 = 各片中位数的中位数)')
print(f'{"文件":26s} {"片":>3s} {"新Y":>6s} {"新C":>6s} | {"旧Y均值":>7s} {"旧C均值":>7s} {"机器档":>10s}   人眼档')
for r in rows:
    print(f'{r["f"]:26s} {r["片数"]:>3d} {str(r["甲面Y"]):>6s} {str(r["甲面C"]):>6s} | '
          f'{str(r.get("甲面Y_旧均值")):>7s} {str(r.get("甲面C_旧均值")):>7s} {r["甲色档"]:>10s}   {r.get("人眼档") or ""}')
from collections import Counter
print('\n分布:', dict(Counter(r['甲色档'] for r in rows)))

# 🔴 硬判据(店主 2026-09-24 立):同一套甲的远景与近景必须判成同一档。
#    判成两档 = 判法本身有毛病,不是某个门槛的问题。这条不随门槛变动而失效。
PAIRS = os.path.join(HERE, '同套甲对照表.json')
pair_fail = []
if os.path.exists(PAIRS):
    tiers = {r['f']: r['甲色档'] for r in rows}
    print('\n同套甲对照(远景 vs 近景必须同档):')
    for pr in json.load(open(PAIRS))['对']:
        got = [(m, tiers[m]) for m in pr['成员'] if m in tiers]
        if len(got) < 2:
            print(f"  ⏸ {pr['名']}:只标了 {len(got)}/{len(pr['成员'])} 张,还判不了"); continue
        ts = {t for _, t in got}
        if len(ts) == 1:
            print(f"  ✅ {pr['名']}:两张都判 {got[0][1]}")
        else:
            pair_fail.append(pr['名'])
            print(f"  🔴 {pr['名']}:" + ' / '.join(f'{m} → {t}' for m, t in got))
            print('     同一套甲判成两档 —— 判法有毛病,不是门槛的事。')
if pair_fail:
    print(f"\n🔴 同套甲判据未过:{len(pair_fail)} 对。（不中断出表,但这条红着就不算定案）")
# 黑甲逐片 Y —— 店主定「纯黑_Y上限」就看这一段
blk = [r for r in rows if (r.get('人眼档') or '').startswith('纯黑') or (r['甲面C'] is not None and r['甲面C'] < BC)]
if blk:
    print('\n低色度(C < %d)各片的 Y —— 「纯黑_Y上限」就按这堆数定:' % BC)
    for r in blk:
        ys = sorted(x['Y'] for x in r['逐片'])
        yo = sorted(x['Y_旧均值'] for x in r['逐片'])
        print(f"  {r['f']:24s} 整张Y {r['甲面Y']}(旧 {r['甲面Y_旧均值']})")
        print(f"      逐片新Y {ys}")
        print(f"      逐片旧Y {yo}")
print('表:', out)
