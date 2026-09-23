/* 第七轮「亮度回贴全」(= LM-YC:Y/Cb/Cr 三通道都按原图直方图回贴)
 *
 * 🔴 **不重写数学**(12i补二 §二「其余一字不动」)。
 *    `match_hist` 与 LM-YC 那两行逐字取自 `luma-match.mjs`(12d §二 原样那段)。
 *    为什么不直接调 luma-match.mjs:它的 CLI 绑死了「前缀 + 目录」那套命名约定,
 *    第七轮的人话文件名喂不进去;而改它会动到第三轮/第四轮/第五轮的可复现性。
 *    **代价是同一段数学出现在两个文件里** —— 所以下面加了一条**漂移护栏**:
 *    运行时把 luma-match.mjs 里的 match_hist 源码抠出来,与本文件这份逐字比,
 *    **不一致就红、停**。这样「两处真相」至少不会悄悄分叉。
 *
 * 用法:node paste-back-full.mjs <_input 目录> <round7 产出夹>
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const PY = '/opt/anaconda3/bin/python3'
const [, , IN_DIR, ROOT] = process.argv

const MATCH_HIST = `def match_hist(s_ch, r_ch):   # 12d §二 原样
    s_vals, s_idx, s_cnt = np.unique(s_ch.ravel(), return_inverse=True, return_counts=True)
    r_vals, r_cnt = np.unique(r_ch.ravel(), return_counts=True)
    s_q = np.cumsum(s_cnt) / s_ch.size; r_q = np.cumsum(r_cnt) / r_ch.size
    return np.interp(s_q, r_q, r_vals)[s_idx].reshape(s_ch.shape)`

/* ── 漂移护栏:与 luma-match.mjs 里那份逐字比 ── */
{
  const lm = readFileSync(join(HERE, 'luma-match.mjs'), 'utf8')
  const i = lm.indexOf('def match_hist(')
  const j = lm.indexOf('\n\ngen = Image.open', i)
  const theirs = lm.slice(i, j).trimEnd()
  if (theirs !== MATCH_HIST) {
    console.error('🔴 match_hist 与 luma-match.mjs 里的那份不一致 —— 两处真相已经分叉,停。')
    console.error('--- luma-match.mjs ---\n' + theirs + '\n--- 本文件 ---\n' + MATCH_HIST)
    process.exit(3)
  }
  console.log('  漂移护栏:match_hist 与 luma-match.mjs 逐字一致 ✅')
}

const OUT = join(ROOT, '回贴全')
mkdirSync(OUT, { recursive: true })
const origOf = (n) => readdirSync(IN_DIR).find((f) => f.startsWith(n + '_') && f.endsWith('.jpg'))

const rows = []
for (const dir of ['A_四块口令', 'A2_只去瑕疵']) {
  const d = join(ROOT, dir)
  if (!existsSync(d)) continue
  for (const g of readdirSync(d).filter((f) => f.endsWith('.jpg')).sort()) {
    const n = g.slice(0, 2)
    const o = origOf(n)
    if (!o) { console.log(`  ⚠️ ${n} 找不到原图,跳过`); continue }
    const name = g.replace(/\.jpg$/, '') + '+亮度回贴全.jpg'
    if (existsSync(join(OUT, name))) { console.log(`  ${n} ${dir} 已存在跳过`); continue }
    const out = execFileSync(PY, ['-c', `
import sys, json
import numpy as np
from PIL import Image
orig_p, gen_p, out_p = sys.argv[1], sys.argv[2], sys.argv[3]
${MATCH_HIST}
gen = Image.open(gen_p).convert('RGB')
orig = Image.open(orig_p).convert('RGB').resize(gen.size, Image.LANCZOS)
g = np.asarray(gen.convert('YCbCr')).astype(np.float64)
o = np.asarray(orig.convert('YCbCr')).astype(np.float64)
b = g.copy()
for c in range(3): b[:,:,c] = match_hist(g[:,:,c], o[:,:,c])
im = Image.fromarray(np.clip(b,0,255).astype(np.uint8), 'YCbCr').convert('RGB')
im.save(out_p, 'JPEG', quality=94)
def stat(x):
    full = np.asarray(x.convert('YCbCr')).astype(float)
    t = x.copy(); t.thumbnail((400,400), Image.LANCZOS)
    a = np.asarray(t).astype(float); l = 0.299*a[:,:,0]+0.587*a[:,:,1]+0.114*a[:,:,2]
    return {'mean':round(float(l.mean()),1),'RB':round(float(a[:,:,0].mean()/max(a[:,:,2].mean(),1e-6)),3),
            'Yp50':round(float(np.percentile(full[:,:,0],50)),1)}
print(json.dumps({'原图':stat(orig),'模型':stat(gen),'回贴全':stat(im)}, ensure_ascii=False))
`, join(IN_DIR, o), join(d, g), join(OUT, name)], { encoding: 'utf8' })
    const r = { 序号: n, 来源: `${dir}/${g}`, 产出: name, ...JSON.parse(out) }
    rows.push(r)
    process.stdout.write(`\r  回贴 ${rows.length} 张   `)
  }
}
console.log('')
writeFileSync(join(ROOT, '_回贴量_第七轮.json'), JSON.stringify(rows, null, 1))

/* 判据:回贴是**构造保证** —— 回贴全之后 R:B 与 Y-p50 必须回到原图 */
let bad = 0
for (const r of rows) {
  const dRB = Math.abs(r.回贴全.RB - r.原图.RB), dY = Math.abs(r.回贴全.Yp50 - r.原图.Yp50)
  if (dRB > 0.05 || dY > 2) { bad++; console.log(`  🔴 ${r.序号} ${r.来源}  R:B 差 ${dRB.toFixed(3)}  Y-p50 差 ${dY.toFixed(1)}`) }
}
/* 🔴 0 张时不许打 ✅ —— 空集上「全过」是废判据(静默失败器族) */
if (!rows.length) { console.error('🔴 一张都没回贴(产出夹里没有出图?)—— 不算通过'); process.exit(4) }
console.log(bad ? `🔴 ${bad}/${rows.length} 张没回到原图` : `✅ ${rows.length} 张全部回到原图(R:B 差 ≤0.05 且 Y-p50 差 ≤2)`)
