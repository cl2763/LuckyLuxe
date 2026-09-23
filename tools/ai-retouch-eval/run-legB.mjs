/* 腿 B 驱动(12e §二 腿B)—— 腿A出图 → LM-YC(亮度回贴全) → 皮肤层 轻/中 */
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { skinLayer, PARAMS, 羽化px, 说明 } from './skin-layer.mjs'
const [, , IN_DIR, ROOT] = process.argv
const PY = '/opt/anaconda3/bin/python3'
const DIR_A = join(ROOT, 'A_口令重组'), DIR_B = join(ROOT, 'B_皮肤层'), DIR_OV = join(ROOT, '叠图_皮肤掩膜')
mkdirSync(DIR_B, { recursive: true }); mkdirSync(DIR_OV, { recursive: true })
const gens = readdirSync(DIR_A).filter((f) => f.endsWith('.jpg')).sort()
const log = []
for (const g of gens) {
  const num = g.slice(0, 2)
  const orig = readdirSync(IN_DIR).find((f) => f.startsWith(num + '_'))
  /* ① LM-YC 基底:Y/Cb/Cr 三通道直方图都贴回原图 */
  const base = join(DIR_B, `${num}_模型四块口令+亮度回贴全.jpg`)
  execFileSync(PY, ['-c', `
import sys
import numpy as np
from PIL import Image
def match_hist(s_ch, r_ch):
    s_vals, s_idx, s_cnt = np.unique(s_ch.ravel(), return_inverse=True, return_counts=True)
    r_vals, r_cnt = np.unique(r_ch.ravel(), return_counts=True)
    s_q = np.cumsum(s_cnt)/s_ch.size; r_q = np.cumsum(r_cnt)/r_ch.size
    return np.interp(s_q, r_q, r_vals)[s_idx].reshape(s_ch.shape)
gen = Image.open(sys.argv[1]).convert('RGB')
org = Image.open(sys.argv[2]).convert('RGB').resize(gen.size, Image.LANCZOS)
g = np.asarray(gen.convert('YCbCr')).astype(np.float64); o = np.asarray(org.convert('YCbCr')).astype(np.float64)
out = g.copy()
for c in range(3): out[:,:,c] = match_hist(g[:,:,c], o[:,:,c])
Image.fromarray(np.clip(out,0,255).astype(np.uint8),'YCbCr').convert('RGB').save(sys.argv[3],'JPEG',quality=94)
`, join(DIR_A, g), join(IN_DIR, orig), base])
  /* ② 皮肤层 轻/中 */
  const r = {}
  for (const 档 of ['轻', '中']) r[档] = skinLayer({ base, orig: join(IN_DIR, orig), outDir: DIR_B, 序号: num, 档 })
  /* 叠图挪到专用夹(§六) */
  const ov = join(DIR_B, `${num}_皮肤掩膜叠图.jpg`)
  if (existsSync(ov)) execFileSync('/bin/mv', [ov, join(DIR_OV, `${num}_皮肤掩膜叠图.jpg`)])
  log.push({ 序号: num, 基底: `${num}_模型四块口令+亮度回贴全.jpg`, 轻: r.轻.产出, 中: r.中.产出, 掩膜占比: r.轻.掩膜占比 })
  console.log(`  ${num} ✅ 掩膜占比 ${r.轻.掩膜占比}%`)
}
writeFileSync(join(ROOT, '_腿B记录.json'), JSON.stringify({ 参数: PARAMS, 羽化px, 参数说明: 说明, 明细: log }, null, 2))
console.log(`\n  腿B 完成 ${log.length} 张 × (基底 + 轻 + 中) · ¥0`)
