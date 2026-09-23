/* 分区量(12d补 §七-1)—— 甲面框 / 手框 / 全图 各自的均亮
 *
 * 🔴 **没有用贴回 PoC 那套框。** 原因写死在这里,免得以后有人再捡起来:
 *    PoC 的 mask = 「原图与结果图差异最大的区域」,而 12a_四 的结论原文是
 *    「改得最多的恰恰是暗部的皮肤和背景,甲面反而改得少 —— 『模型改得多的地方』≠『甲面』」。
 *    拿它量甲面均亮,量到的是暗部皮肤和背景,而且**会出一个像模像样的数**,错得看不出来。
 *
 *    改用 PoC 结论自己指的方向:「要找甲面得用**原图自身的特征**」。
 *      · 手框 = 肤色掩膜(YCbCr 色度范围 —— 只看 Cb/Cr,**不看亮度**,
 *              所以暗光片的皮肤照样能认出来,这正是 02/18/28 那类片子需要的)
 *      · 甲面候选 = 手部区域(肤色掩膜膨胀后的连通范围)里的**非肤色**像素
 *    ⚠️ 这是启发式,不是分割模型。**所以必须把掩膜画出来看**(overlay),不许只信数字。
 */
import { readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const [, , IN_DIR, OUT_JSON, OVERLAY_DIR] = process.argv
const PY = '/opt/anaconda3/bin/python3'
/* 🔴 门槛与口径的唯一真相是 nail-tier.json(12n补二 §一:两支都读它,不许各写各的) */
const TIER = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'nail-tier.json'), 'utf8'))
if (TIER.metric !== 'median_after_p85_trim') {
  console.error(`🔴 不认识的口径 ${TIER.metric} —— 口径变了要先改代码,不许静默按老口径跑`); process.exit(2)
}
const files = readdirSync(IN_DIR).filter((f) => f.endsWith('.jpg')).sort()
const out = execFileSync(PY, ['-c', `
import sys, json, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

in_dir, overlay_dir = sys.argv[1], sys.argv[2]
YT, CT, BY, BC = float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
os.makedirs(overlay_dir, exist_ok=True)
rows = []
for f in sorted(os.listdir(in_dir)):
    if not f.endswith('.jpg'): continue
    im = Image.open(os.path.join(in_dir, f)).convert('RGB')
    im.thumbnail((600, 600), Image.LANCZOS)
    rgb = np.asarray(im).astype(np.float64)
    ycc = np.asarray(im.convert('YCbCr')).astype(np.float64)
    Y, Cb, Cr = ycc[:,:,0], ycc[:,:,1], ycc[:,:,2]

    # 肤色:经典 YCbCr 色度窗口。**只用 Cb/Cr,不用 Y** —— 暗光片的皮肤也能认出来
    skin = (Cb >= 77) & (Cb <= 127) & (Cr >= 133) & (Cr <= 173)
    skin = ndimage.binary_opening(skin, np.ones((3,3)))
    skin = ndimage.binary_closing(skin, np.ones((7,7)))

    # 手部区域 = 肤色掩膜大幅膨胀后填洞 —— 指甲被皮肤包着,填洞就把它圈进来
    hand = ndimage.binary_dilation(skin, np.ones((9,9)))
    hand = ndimage.binary_fill_holes(hand)
    nail = hand & (~skin)
    nail = ndimage.binary_opening(nail, np.ones((3,3)))
    # 去掉太小的碎块(噪点、指缝)
    lab, n = ndimage.label(nail)
    if n:
        sizes = ndimage.sum(nail, lab, range(1, n+1))
        keep = np.isin(lab, np.where(sizes >= max(30, nail.size*0.0004))[0] + 1)
        nail = keep

    def mean_of(m):
        return float(Y[m].mean()) if m.sum() > 50 else None

    # 12i §二 / 12n补 §二 / 12n补二 §一 —— 甲色四档 + 去高光中位数口径
    #   口径:每「片」(这里只能用连通块当片)去掉 Y > p85 的像素,再取中位数;整张 = 各片中位数的中位数
    #   🔴 这支用的是**肤色粗估**掩膜,已证在红/蓝粉/墨绿上失效;口径与门槛跟真掩膜那支保持一致,
    #      是为了两支能对比,不是说这支的数可信。
    C = np.sqrt((Cb-128.0)**2 + (Cr-128.0)**2)
    def trimmed(y, c):
        if y.size < 20: return None, None
        keep = y <= np.percentile(y, 85)
        if keep.sum() < 10: keep = np.ones_like(y, dtype=bool)
        return float(np.median(y[keep])), float(np.median(c[keep]))
    lab2, n2 = ndimage.label(nail)
    piece = []
    for i in range(1, n2+1):
        k = lab2 == i
        if k.sum() < 50: continue
        py, pc = trimmed(Y[k], C[k])
        if py is not None: piece.append((py, pc))
    if piece:
        nailY = float(np.median([p[0] for p in piece]))
        nailC = float(np.median([p[1] for p in piece]))
    else:
        nailY = nailC = None
    if nailY is None or nailC is None:
        档, 口令腿, 取不到 = '取不到', 'A', True
    else:
        取不到 = False
        if   nailY >= YT:                 档, 口令腿 = '浅', 'A'
        elif nailY <= BY and nailC < BC:  档, 口令腿 = '纯黑', 'A'
        elif nailC >= CT:                 档, 口令腿 = '深·鲜明', 'A'
        else:                             档, 口令腿 = '深·不鲜明', "A'"
    rows.append({
        'f': f,
        '全图均亮': round(float(Y.mean()),1),
        '手框均亮': (lambda v: round(v,1) if v is not None else None)(mean_of(skin)),
        '甲面均亮': (lambda v: round(v,1) if v is not None else None)(nailY),
        '甲面色度C': (lambda v: round(v,1) if v is not None else None)(nailC),
        '甲面均亮_旧均值': (lambda v: round(v,1) if v is not None else None)(mean_of(nail)),
        '片数_连通块': len(piece),
        '甲色档': 档,
        '口令腿': 口令腿,
        '甲面区取不到': 取不到,
        '手框占比': round(float(skin.mean()*100),1),
        '甲面占比': round(float(nail.mean()*100),1),
        '全图RB': round(float(rgb[:,:,0].mean()/max(rgb[:,:,2].mean(),1e-6)),3),
    })
    # overlay:皮肤描红、甲面候选描青 —— **画出来给人看的,这一步不许省**
    ov = rgb.copy()
    ov[skin] = ov[skin]*0.55 + np.array([200,60,60])*0.45
    ov[nail] = ov[nail]*0.35 + np.array([40,220,220])*0.65
    Image.fromarray(ov.astype(np.uint8)).save(os.path.join(overlay_dir, 'OV_'+f), 'JPEG', quality=85)
print(json.dumps(rows, ensure_ascii=False))
`, IN_DIR, OVERLAY_DIR, String(TIER.Y门槛), String(TIER.C门槛), String(TIER.纯黑_Y上限), String(TIER.纯黑_C上限)], { encoding: 'utf8', maxBuffer: 32e6 })
const rows = JSON.parse(out)
writeFileSync(OUT_JSON, JSON.stringify(rows, null, 1))
console.log(`  量了 ${rows.length} 张 · overlay 在 ${OVERLAY_DIR}`)
const bad = rows.filter((r) => r.甲面均亮 === null || r.手框均亮 === null)
if (bad.length) console.log(`  ⚠️ ${bad.length} 张取不到某个区(会在 overlay 里看得出来):${bad.map((r) => r.f.slice(0, 2)).join(',')}`)
/* 12i §二 分档分布 —— 三档各多少张,先报再谈挑样 */
const 分布 = {}
for (const r of rows) 分布[r.甲色档] = (分布[r.甲色档] || 0) + 1
console.log('  甲色四档分布:', Object.entries(分布).map(([k, v]) => `${k} ${v} 张`).join(' · '))
const 取不到 = rows.filter((r) => r.甲面区取不到)
if (取不到.length) console.log(`  ⚠️ 甲面区取不到 ${取不到.length} 张(已默认腿 A):${取不到.map((r) => r.f.slice(0, 2)).join(',')}`)
