/* 亮度回贴(12d §二 · 补令 §二 加 LM-50)
 *
 * 想法(12d §一,Cowork 的零成本实验):模型只留它擅长的「清皮肤 / 去反光 / 去杂」,
 * **曝光与明暗分布逐像素还给原图**。三个变体让店主眼判:
 *   LM-Y   只回 Y 通道(Cb/Cr 不动)—— 12d §一 那版,18 号会过暖(R:B 跳到 1.80)
 *   LM-YC  Y/Cb/Cr 三通道都回 —— 看 18 号过暖是否消失、清皮肤是否还在
 *   LM-50  Y 回贴后与模型出图按 0.5 混合 —— 补令 §二:全量回贴会把店主要的那点白净抹平
 *
 * 🔴 回贴函数逐字用 12d §二 给的那段,不改写。
 */
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const [, , IN_DIR, GEN_DIR, OUT_DIR, PREFIX_ARG] = process.argv
const PFX = PREFIX_ARG || 'B3'   /* 第三轮是 B3_,P1b 是 Hb_ */
const PY = '/opt/anaconda3/bin/python3'
mkdirSync(OUT_DIR, { recursive: true })
const gens = readdirSync(GEN_DIR).filter((f) => f.startsWith(PFX) && f.endsWith('.jpg')).sort()
const rows = []
for (const g of gens) {
  /* B3A_xxx.jpg → xxx.jpg ; Hb_B浅_xxx.jpg → xxx.jpg */
  const orig = PFX === 'B3' ? g.slice(4) : g.split('_').slice(2).join('_')
  if (!existsSync(join(IN_DIR, orig))) { console.log(`  ⚠️ 找不到原图 ${orig},跳过`); continue }
  const out = execFileSync(PY, ['-c', `
import sys, json
import numpy as np
from PIL import Image

orig_p, gen_p, out_dir, tag = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

def match_hist(s_ch, r_ch):   # 12d §二 原样
    s_vals, s_idx, s_cnt = np.unique(s_ch.ravel(), return_inverse=True, return_counts=True)
    r_vals, r_cnt = np.unique(r_ch.ravel(), return_counts=True)
    s_q = np.cumsum(s_cnt) / s_ch.size; r_q = np.cumsum(r_cnt) / r_ch.size
    return np.interp(s_q, r_q, r_vals)[s_idx].reshape(s_ch.shape)

gen = Image.open(gen_p).convert('RGB')
orig = Image.open(orig_p).convert('RGB').resize(gen.size, Image.LANCZOS)
g = np.asarray(gen.convert('YCbCr')).astype(np.float64)
o = np.asarray(orig.convert('YCbCr')).astype(np.float64)

def save(arr, name):
    im = Image.fromarray(np.clip(arr,0,255).astype(np.uint8), 'YCbCr').convert('RGB')
    im.save(f'{out_dir}/{name}_{tag}', 'JPEG', quality=94); return im

y_matched = match_hist(g[:,:,0], o[:,:,0])

a = g.copy(); a[:,:,0] = y_matched;                    im_y  = save(a, 'LMY')
b = g.copy()
for c in range(3): b[:,:,c] = match_hist(g[:,:,c], o[:,:,c]);  im_yc = save(b, 'LMYC')
c50 = g.copy(); c50[:,:,0] = 0.5*y_matched + 0.5*g[:,:,0];     im_50 = save(c50, 'LM50')

def stat(im):
    # 🔴 Yp50 必须在**全分辨率**上量。这条判据验的是「直方图回贴对没对上」,
    #    在 400px 缩略图上量等于掺进缩放误差,会把方法本身的对错和量法的误差搅在一起。
    #    其余给人看的数仍用缩略图(与前几轮口径一致,便于横向比)。
    full = np.asarray(im.convert('YCbCr')).astype(float)
    x = im.copy(); x.thumbnail((400,400), Image.LANCZOS)
    arr = np.asarray(x).astype(float); l = 0.299*arr[:,:,0]+0.587*arr[:,:,1]+0.114*arr[:,:,2]
    return {'mean':round(float(l.mean()),1),'死白':round(float((l>225).mean()*100),2),
            'p95':round(float(np.percentile(l,95)),1),'RB':round(float(arr[:,:,0].mean()/max(arr[:,:,2].mean(),1e-6)),3),
            'Yp50':round(float(np.percentile(full[:,:,0],50)),1)}
print(json.dumps({'原图':stat(orig),'模型':stat(gen),'LM-Y':stat(im_y),'LM-YC':stat(im_yc),'LM-50':stat(im_50)}, ensure_ascii=False))
`, join(IN_DIR, orig), join(GEN_DIR, g), OUT_DIR, orig], { encoding: 'utf8' })
  rows.push({ 文件: orig, ...JSON.parse(out) })
  console.log(`  ${orig.slice(0, 2)} ✅`)
}
writeFileSync(join(OUT_DIR, '_回贴量.json'), JSON.stringify(rows, null, 1))
/* ── 12d §三 的两条判据 ── */
let fail = 0
console.log('\n  === 判据(12d §三)===')
for (const r of rows) {
  const dY = Math.abs(r['LM-Y'].Yp50 - r.原图.Yp50)
  const dRB = Math.abs(r['LM-YC'].RB - r.原图.RB)
  const okY = dY <= 2, okRB = dRB <= 0.05
  if (!okY || !okRB) fail++
  console.log(`  ${r.文件.slice(0, 2)}  LM-Y 的 Y-p50 差 ${dY.toFixed(1)} ${okY ? '✅' : '🔴 >2'}   ·   LM-YC 的 R:B 差 ${dRB.toFixed(3)} ${okRB ? '✅' : '🔴 >0.05'}`)
}
console.log(fail ? `\n  🔴 ${fail} 张不过判据` : '\n  ✅ 两条判据全过')
