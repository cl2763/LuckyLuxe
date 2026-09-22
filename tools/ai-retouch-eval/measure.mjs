/* 12a 第一轮 · 客观量(支撑主观初判,不替代它)
 *
 * 🔴 判据律:能按像素量的就别只凭感觉。
 *    但也别谎称量到了量不到的东西 —— 贴回 PoC 已经证明「用差异图找甲面」不成立,
 *    所以**甲面色相这里量不了**,这份只量全图统计量:
 *      ①白平衡偏移(R/B 比的变化)—— 支撑 ③ 与「整体偏冷」
 *      ②平均亮度变化      —— 支撑「暗光救回做到什么程度」
 *      ③背景区域色差      —— 只取四角,支撑 ①b「背景变了没有」
 *    甲面改没改仍然只能看,看的结论写明「看哪里、怎么变」。
 */
import { readdirSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const [, , IN_DIR, R1_DIR, OUT] = process.argv
const PY = '/opt/anaconda3/bin/python3'
const rows = []
for (const f of readdirSync(IN_DIR).filter((x) => x.endsWith('.jpg')).sort()) {
  for (const code of ['A', 'B']) {
    const gen = join(R1_DIR, `${code}_${f}`)
    if (!existsSync(gen)) continue
    const out = execFileSync(PY, ['-c', `
import sys, json
import numpy as np
from PIL import Image
def load(p, n=320):
    im = Image.open(p).convert('RGB'); im.thumbnail((n, n), Image.LANCZOS)
    return np.asarray(im).astype(np.float64)
a, b = load(sys.argv[1]), load(sys.argv[2])
def wb(x):  # R/B 比 —— >1 偏暖,<1 偏冷
    return float(x[:,:,0].mean() / max(x[:,:,2].mean(), 1e-6))
def lum(x):
    return float((0.299*x[:,:,0] + 0.587*x[:,:,1] + 0.114*x[:,:,2]).mean())
def corners(x):  # 四角 8% 见方 —— 近似"背景"
    h, w = x.shape[:2]; k = max(4, int(min(h, w) * 0.08))
    return np.concatenate([x[:k,:k].reshape(-1,3), x[:k,-k:].reshape(-1,3),
                           x[-k:,:k].reshape(-1,3), x[-k:,-k:].reshape(-1,3)]).mean(axis=0)
ca, cb = corners(a), corners(b)
print(json.dumps({
  'wb原': round(wb(a),3), 'wb出': round(wb(b),3), 'wb变化%': round((wb(b)/wb(a)-1)*100,1),
  '亮原': round(lum(a),1), '亮出': round(lum(b),1), '亮变化%': round((lum(b)/max(lum(a),1e-6)-1)*100,1),
  '四角色差': round(float(np.abs(cb-ca).mean()),1),
}))
`, join(IN_DIR, f), gen], { encoding: 'utf8' })
    rows.push({ 文件: f, 模型: code, ...JSON.parse(out) })
  }
}
writeFileSync(OUT, JSON.stringify(rows, null, 2))
const avg = (c, k) => { const v = rows.filter((r) => r.模型 === c).map((r) => r[k]); return v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(1) : '—' }
for (const c of ['A', 'B']) console.log(`  ${c}:白平衡变化均值 ${avg(c, 'wb变化%')}% · 亮度变化均值 ${avg(c, '亮变化%')}% · 四角色差均值 ${avg(c, '四角色差')}`)
console.log(`  → ${OUT}`)
