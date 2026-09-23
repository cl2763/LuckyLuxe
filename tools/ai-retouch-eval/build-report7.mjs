/* 第七轮对比包(12i补二 §三)
 * 每行 5 格:原图 | 腿A | 腿A′ | 腿A+回贴全 | 腿A′+回贴全
 * 行按**人眼档**四组分组;每个数带 [全图]/[手框] 标签;不标 ✅、不下结论。
 * 用法:node build-report7.mjs <产出夹根> <round7 夹名> <输出 html>
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure } from './metrics.mjs'
const [, , D, RNAME, OUT] = process.argv
const R = join(D, RNAME)
const PY = '/opt/anaconda3/bin/python3'
const ANN = join(dirname(fileURLToPath(import.meta.url)), '..', 'segment', 'annotations')
const PICKS = ['60', '61', '42', '57', '14', '49', '53', '78', '18', '28', '71', '02', '46', '74', '38']
const 组序 = ['浅', '深·鲜明', '深·不鲜明', '纯黑']

const th = (f, w = 300) => { try { return execFileSync(PY, ['-c', `
import sys, io, base64
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB'); im.thumbnail((${w},${w * 3}), Image.LANCZOS)
b=io.BytesIO(); im.save(b,'JPEG',quality=80); print(base64.b64encode(b.getvalue()).decode())`, f], { encoding: 'utf8', maxBuffer: 64e6 }).trim() } catch { return '' } }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const findIn = (sub, n, kw) => {
  try { const f = readdirSync(join(R, sub)).find((x) => x.startsWith(n) && (!kw || x.includes(kw)) && (kw || !x.includes('回贴'))) ; return f ? `${RNAME}/${sub}/${f}` : null } catch { return null }
}
const origOf = (n) => { const f = readdirSync(join(D, '_input')).find((x) => x.startsWith(n + '_')); return f ? `_input/${f}` : null }

/* 曝光桶复核(12i补二 后续 §二):把真实 p95 换进去看本该是哪个桶。
   本该进桶 C 的行,在它自己那一行加一句小字;一张都没有就在抬头说清楚。 */
let 桶复核 = null
try { 桶复核 = JSON.parse(readFileSync(join(R, '_曝光桶复核.json'), 'utf8')) } catch {}
const 复核Of = (n) => 桶复核?.行?.find((x) => x.序号 === n)

const rows = PICKS.map((n) => {
  const a = JSON.parse(readFileSync(join(ANN, `${n}.json`), 'utf8'))
  const 档 = (a.甲色档_人眼 || '').split('(')[0].trim()
  return {
    n, 档, 文件: a.文件,
    cols: [
      ['原图', origOf(n), ''],
      ['腿A 四块口令', findIn('A_四块口令', n), '含冷白+磨皮句'],
      ["腿A′ 只去瑕疵", findIn('A2_只去瑕疵', n), '冷白/磨皮全删'],
      ['腿A+亮度回贴全', findIn('回贴全', n, '四块口令'), '构造:光与色回原图'],
      ["腿A′+亮度回贴全", findIn('回贴全', n, '只去瑕疵'), '构造:光与色回原图'],
    ],
  }
})

/* 🔴 格数对账:应有 15 行 × 5 格 = 75 格,少一格就红 */
const 有的格 = rows.reduce((s, r) => s + r.cols.filter((c) => c[1] && existsSync(join(D, c[1]))).length, 0)
console.log(`行数 ${rows.length}(应 15)· 格数 ${有的格}(应 75)`)
if (rows.length !== 15) { console.error('🔴 行数不是 15'); process.exit(1) }
if (有的格 !== 75) { console.error(`🔴 格数 ${有的格} ≠ 75 —— 缺格的行:` +
  rows.filter((r) => r.cols.filter((c) => c[1] && existsSync(join(D, c[1]))).length !== 5).map((r) => r.n).join(',')); process.exit(1) }

const all = [...new Set(rows.flatMap((r) => r.cols.map((c) => c[1])).filter(Boolean))]
const mm = measure(all.map((p) => join(D, p))); const M = new Map(all.map((p, i) => [p, mm[i]]))

const cell = (label, rel, note) => {
  const m = M.get(rel)
  const ctor = /回贴全/.test(rel || '')
  return `<td><a href="${esc('../' + rel)}" target="_blank"><img src="data:image/jpeg;base64,${th(join(D, rel))}"></a>
  <div class="meta"><b>${esc(label)}</b>${note ? '<br>' + esc(note) : ''}
  <br><span class="tag">[手框]</span> R:B ${m?.手框?.RB ?? '—'} · 死白 ${m?.手框?.死白 ?? '—'}%
  <br><span class="tag">[全图]</span> R:B ${m?.全图.RB} · 死白 ${m?.全图.死白}%
  ${ctor ? '<br><span class="note">这两列的光与色是<b>回贴的定义</b>,不是模型的功劳</span>' : ''}</div></td>`
}

let html = `<meta charset="utf-8">
<title>12a 第七轮对比包</title>
<style>
:root{--ink:#2b2622;--sub:#7a6f62;--line:#e6e0d8;--bad:#b3413a;--paper:#faf8f3}
body{font:14px/1.6 -apple-system,"PingFang SC",sans-serif;background:var(--paper);color:var(--ink);margin:0;padding:24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:26px 0 10px;border-bottom:2px solid var(--line);padding-bottom:6px}
.sub{color:var(--sub);margin-bottom:16px}
.box{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:16px}.box b{color:var(--bad)}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:10px}
th,td{border-bottom:1px solid var(--line);padding:9px;vertical-align:top;text-align:left;font-size:12.5px}
th{background:#f4f0e9;font-weight:600}
img{max-width:300px;border-radius:6px;display:block;border:1px solid var(--line)}
a img:hover{outline:2px solid #8a7a66}
.meta{font-size:11px;color:var(--sub);margin-top:5px;line-height:1.5}
.tag{display:inline-block;padding:0 5px;border-radius:3px;background:#efeae2;color:#6f6255;font-size:10px}
.note{color:var(--bad);font-size:10.5px}.pin{color:var(--bad);font-size:11px;display:block;margin-top:6px}
</style>
<h1>12a 第七轮对比包 · 口令按甲色分档</h1>
<div class="sub">生成于 ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'short' }).format(new Date())} 多伦多 · 模型 doubao-seedream-5-0-pro-260628 · 15 张 × 两腿</div>
<div class="box">
<b>🔴 这份 html 在 <code>${esc(RNAME)}/</code> 夹里,图走 <code>../</code> 指回产出夹根 —— 别单独拷走。</b><br><br>
分组用的是<b>人眼档</b>(标注里的 <code>甲色档_人眼</code>),<b>不是机器判的档</b> —— 这一轮没跑机器分类。<br>
口令里只有「深甲 / 浅甲」两种说法:人眼档「浅」用浅甲句,其余三档用深甲句。<br>
每个数带范围标签:<span class="tag">[全图]</span> 整张 · <span class="tag">[手框]</span> 只算皮肤。<br>
<b>后两列的光与色回到原图,是回贴的定义,不是模型的功劳。</b>
${桶复核 ? `<br><br><b>曝光桶的一处已知毛病(本轮没改,照前几轮原样跑)</b>:调用处把整张平均亮度填进了「最亮值(p95)」那一格,
而桶 C 的条件是 <code>p95 &gt; 240 且 全图均亮 &gt; 140</code> —— 平均亮度不可能大于 240,<b>桶 C 从第五轮起就没被触发过</b>。<br>
用<b>真实最亮值</b>把这 15 张重算了一遍(不重跑、不花钱):<b>桶判 ${桶复核.行.filter((x) => x.差了吗).length} 张会变</b>
${桶复核.行.filter((x) => x.差了吗).length === 0 ? '—— 也就是说<b>这一轮的图不受这个毛病影响</b>。最接近的是 78 号(真实最亮值 236,离 240 差 4)。' : ''}` : ''}
</div>`

for (const g of 组序) {
  const rs = rows.filter((r) => r.档 === g)
  if (!rs.length) continue
  html += `\n<h2>人眼档:${esc(g)}(${rs.length} 张)</h2>\n<table><tr><th style="width:130px">样片</th>${rows[0].cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr>\n`
  for (const r of rs) {
    html += `<tr><td><b>${esc(r.n)}</b><div class="meta">${esc(r.文件)}<br>人眼档:${esc(r.档)}` +
      (r.n === '18' ? `<span class="pin">店主已定:这类当黑处理走腿 A —— 请看 A 版能不能接受</span>` : '') +
      (复核Of(r.n)?.差了吗 ? `<span class="pin">本该走过曝桶 C,本轮按 ${esc(复核Of(r.n).本轮用的桶)} 跑</span>` : '') +
      `</div></td>${r.cols.map((c) => cell(c[0], c[1], c[2])).join('')}</tr>\n`
  }
  html += `</table>\n`
}
writeFileSync(OUT, html)
console.log(`  对比包7:${OUT}`)

/* 12k §三 —— 对比包没有反馈按钮和导出按钮的,视为未交付。
   统一从 feedback-embed.mjs 这一个出口嵌,不许每个 build-report 各写一套。 */
import { fbScript as __fbScript } from './feedback-embed.mjs'
import { appendFileSync as __fbAppend } from 'node:fs'
__fbAppend(OUT, __fbScript())
console.log('  已嵌入可点反馈组件(12k)')
