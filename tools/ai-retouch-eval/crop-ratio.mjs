/* 比例裁切(12d补 §三-4)—— 非生成式,¥0
 *
 * 令说「以甲面框中心为构图中心」。🔴 但零依赖下没有可靠的甲面框
 * (12a_四 的 PoC 否定 + 本批肤色掩膜取反在红甲/黑甲上失败,证据见 overlay)。
 * **所以我不假装用甲面框。** 改用一个能站住、且对客照成立的代理:
 *   **手部区域(肤色掩膜)的重心**,并**向上偏移** —— 美甲客照里指甲总在手的末端,
 *   而构图重心应落在指甲那头。偏移量取手部高度的 25%,朝手部长轴的"指尖方向"。
 *   指尖方向 = 手部掩膜在长轴上**较窄**的一端(手指比手掌窄)。
 * 这仍是启发式,**所以每张都把裁切框画出来看**,不只信数字。
 */
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const [, , IN_DIR, OUT_DIR, LIST] = process.argv
const PY = '/opt/anaconda3/bin/python3'
mkdirSync(OUT_DIR, { recursive: true })
const files = LIST.split(',').filter(Boolean)
const rows = []
for (const f of files) {
  const out = execFileSync(PY, ['-c', `
import sys, json, os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
src, out_dir = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB'); W, H = im.size
small = im.copy(); small.thumbnail((500,500), Image.LANCZOS)
ycc = np.asarray(small.convert('YCbCr')).astype(float)
Cb, Cr = ycc[:,:,1], ycc[:,:,2]
skin = (Cb>=77)&(Cb<=127)&(Cr>=133)&(Cr<=173)
skin = ndimage.binary_closing(ndimage.binary_opening(skin, np.ones((3,3))), np.ones((7,7)))
ys, xs = np.nonzero(skin)
if len(ys) < 100:
    cx, cy = 0.5, 0.45
    note = '肤色掩膜太小,退回画面中心偏上'
else:
    cy_s, cx_s = ys.mean()/skin.shape[0], xs.mean()/skin.shape[1]
    # 指尖方向:比较手部上下半的宽度,窄的一端是手指
    mid = int(ys.mean())
    top_w = skin[:mid].sum(axis=1).mean() if mid>0 else 0
    bot_w = skin[mid:].sum(axis=1).mean() if mid<skin.shape[0] else 0
    direction = -1 if top_w < bot_w else 1        # 上窄 → 指尖在上
    h_frac = (ys.max()-ys.min())/skin.shape[0]
    cy = float(np.clip(cy_s + direction*0.25*h_frac, 0.15, 0.85)); cx = float(np.clip(cx_s, 0.2, 0.8))
    note = f'手部重心({cx_s:.2f},{cy_s:.2f}),指尖朝{"上" if direction<0 else "下"},构图中心上移到 {cy:.2f}'
res = {'file': os.path.basename(src), 'cx': round(cx,3), 'cy': round(cy,3), 'note': note, 'crops': {}}
preview = im.copy(); dr = ImageDraw.Draw(preview)
for name, (rw, rh) in {'3-4':(3,4), '9-16':(9,16), '1-1':(1,1)}.items():
    target = rw/rh
    if W/H > target: cw, ch = int(H*target), H
    else: cw, ch = W, int(W/target)
    x0 = int(np.clip(cx*W - cw/2, 0, W-cw)); y0 = int(np.clip(cy*H - ch/2, 0, H-ch))
    im.crop((x0,y0,x0+cw,y0+ch)).save(f'{out_dir}/C{name}_{os.path.basename(src)}','JPEG',quality=92)
    dr.rectangle([x0,y0,x0+cw,y0+ch], outline=(255,80,80), width=max(4,W//300))
    dr.text((x0+10,y0+10), name, fill=(255,80,80))
    res['crops'][name] = f'{cw}x{ch}'
preview.thumbnail((700,700), Image.LANCZOS)
preview.save(f'{out_dir}/_框_{os.path.basename(src)}','JPEG',quality=86)
print(json.dumps(res, ensure_ascii=False))
`, join(IN_DIR, f), OUT_DIR], { encoding: 'utf8' })
  const r = JSON.parse(out); rows.push(r)
  console.log(`  ${r.file.slice(0, 2)}  中心(${r.cx},${r.cy})  ${r.note}`)
}
writeFileSync(join(OUT_DIR, '_裁切记录.json'), JSON.stringify(rows, null, 1))
console.log(`\n  🔴 横 16:9 没做 —— 从竖图裁 16:9 会把手切掉(§三-4),要扩图才成立,单独探。`)
