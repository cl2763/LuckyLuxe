/* L5 稳定性(11z §三):同一张图、同一条口令,跑 3 次差多少
 * 🔴 判据得能证伪「三次一样」。只看缩略图"感觉差不多"是废判据 —— 按像素量:
 *    ① 两两像素平均绝对差(0=完全一致)
 *    ② 各自的暗部占比/均亮,看色调稳不稳
 *    ③ 结构相似度的粗代理:下采样后的相关系数
 *    像素差量的是"像不像",量不了"甲面图案有没有换" —— 那个仍要看图,已在回执写明。
 */
import { existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const [, , R2_DIR, OUT] = process.argv
const PY = '/opt/anaconda3/bin/python3'
const PICKS = [
  { f: '02_IMG_0555.jpg', 说明: '黑短甲两手交叠(店主点名的稳定翻车样本)' },
  { f: '18_IMG_4239.jpg', 说明: '原图最暗的黑甲之一(亮度 32,对标参考03)' },
  { f: '35_IMG_9350.jpg', 说明: '原图曝光正常(亮度 120)' },
]
const rows = []
for (const p of PICKS) {
  const runs = [1, 2, 3].map((k) => join(R2_DIR, `B2_L5r${k}_${p.f}`)).filter(existsSync)
  if (runs.length < 2) { rows.push({ ...p, 可用次数: runs.length, 备注: '出图不足,无法比' }); continue }
  const out = execFileSync(PY, ['-c', `
import sys, json, itertools
import numpy as np
from PIL import Image
def load(p, n=512):
    im = Image.open(p).convert('RGB'); im.thumbnail((n,n), Image.LANCZOS)
    return np.asarray(im).astype(np.float64)
ims = [load(p) for p in sys.argv[1:]]
h = min(i.shape[0] for i in ims); w = min(i.shape[1] for i in ims)
ims = [i[:h,:w] for i in ims]
def lum(x): return 0.299*x[:,:,0]+0.587*x[:,:,1]+0.114*x[:,:,2]
pairs = []
for a,b in itertools.combinations(range(len(ims)),2):
    d = np.abs(ims[a]-ims[b]).mean()
    la, lb = lum(ims[a]).ravel(), lum(ims[b]).ravel()
    r = float(np.corrcoef(la,lb)[0,1])
    pairs.append({'对': f'{a+1}vs{b+1}', '像素平均差': round(float(d),1), '相关系数': round(r,4)})
tones = [{'暗部占比': round(float((lum(i)<64).mean()*100),1), '均亮': round(float(lum(i).mean()),1)} for i in ims]
print(json.dumps({'两两比': pairs, '各次色调': tones}, ensure_ascii=False))
`, ...runs], { encoding: 'utf8' })
  rows.push({ ...p, 可用次数: runs.length, ...JSON.parse(out) })
}
writeFileSync(OUT, JSON.stringify(rows, null, 2))
for (const r of rows) {
  console.log(`\n  ${r.f} —— ${r.说明}  (${r.可用次数} 次)`)
  if (r.备注) { console.log('    ' + r.备注); continue }
  for (const p of r.两两比) console.log(`    ${p.对}: 像素平均差 ${p.像素平均差} · 相关系数 ${p.相关系数}`)
  console.log('    各次 暗部占比/均亮: ' + r.各次色调.map((t) => `${t.暗部占比}%/${t.均亮}`).join('  '))
}
console.log(`\n  → ${OUT}`)
