/* 第四轮对比包(12d补 §三-5,口径按补三/补四)
 * 三区:手部 · 背景 · 比例。缩略图点开原文件。
 * 🔴 每个数带 [全图]/[手框] 标签(补三 §四);LM-YC 那列**不标 ✅**,标「回贴所致」(补四 §一)。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { measure, texture } from './metrics.mjs'
const [, , D, OUT] = process.argv
const PY = '/opt/anaconda3/bin/python3'
const thumb = (f, w = 300) => { try { return execFileSync(PY, ['-c', `
import sys, io, base64
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB'); im.thumbnail((${w}, ${w*3}), Image.LANCZOS)
b=io.BytesIO(); im.save(b,'JPEG',quality=80); print(base64.b64encode(b.getvalue()).decode())`, f], { encoding: 'utf8', maxBuffer: 64e6 }).trim() } catch { return '' } }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const has = (p) => existsSync(join(D, p))

/* 手部区:六张 × 六列 */
const HB = readdirSync(join(D, 'round4_handb')).filter((f) => f.startsWith('Hb_') && f.endsWith('.jpg')).sort()
const ORIGS = HB.map((f) => f.split('_').slice(2).join('_'))
const P1 = readdirSync(join(D, 'round4_hand')).filter((f) => f.startsWith('H_') && f.endsWith('.jpg'))
const cols = (o, i) => ([
  ['原图', `_input/${o}`, ''],
  ['第三轮', ['round3/B3A_' + o, 'round3/B3B_' + o].find(has) || '', '无手部句'],
  ['P1', 'round4_hand/' + (P1.find((f) => f.endsWith(o)) || ''), '手部句(口令自相矛盾)'],
  ['P1b', `round4_handb/${HB[i]}`, '矛盾已拆'],
  ['P1b+LM-50', `round4_handb_lm/LM50_${o}`, '回贴一半'],
  ['P1b+LM-YC', `round4_handb_lm/LMYC_${o}`, '色与光全回贴'],
])
const allPaths = [...new Set(ORIGS.flatMap((o, i) => cols(o, i).map((c) => c[1]).filter((p) => p && has(p))))]
const M = new Map(), T = new Map()
for (const p of allPaths) { /* 分批量,避免命令行过长 */ }
const mm = measure(allPaths.map((p) => join(D, p))); allPaths.forEach((p, k) => M.set(p, mm[k]))
const tt = texture(allPaths.map((p) => join(D, p))); allPaths.forEach((p, k) => T.set(p, tt[k]))

const cell = (label, rel, note, baseRel) => {
  if (!rel || !has(rel)) return `<td class="miss">没有</td>`
  const m = M.get(rel), t = T.get(rel), b = baseRel ? T.get(baseRel) : null
  const hi = b && t.手框肌理 != null && b.手框肌理 != null && t.手框肌理 > b.手框肌理
  const isLM = /LMYC/.test(rel)
  return `<td><a href="${esc(rel)}" target="_blank"><img src="data:image/jpeg;base64,${thumb(join(D, rel))}"></a>
  <div class="meta"><b>${esc(label)}</b>${note ? '<br>' + esc(note) : ''}
  <br><span class="tag">[手框]</span> R:B ${m.手框?.RB ?? '—'} · 死白 ${m.手框?.死白 ?? '—'}%
  <br><span class="tag">[全图]</span> R:B ${m.全图.RB} · 死白 ${m.全图.死白}%
  <br><span class="tag">[手框]</span> 肌理 <b class="${hi ? 'red' : ''}">${t.手框肌理 ?? '—'}</b>${hi ? ' 🔴比原图高' : ''}
  ${isLM ? '<br><span class="note">这两行数是<b>回贴所致</b>,不是模型的功劳 —— 不当通过项</span>' : ''}</div></td>`
}

/* 背景区 */
const BGF = has('round4_bg') ? readdirSync(join(D, 'round4_bg')).filter((f) => f.startsWith('BG_') && f.endsWith('.jpg')).sort() : []
const bgBy = {}
for (const f of BGF) { const o = f.split('_').slice(2).join('_'); (bgBy[o] ||= []).push(f) }
const bgDiff = (o, f) => JSON.parse(execFileSync(PY, ['-c', `
import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage
a=Image.open(sys.argv[1]).convert("RGB"); b=Image.open(sys.argv[2]).convert("RGB").resize(a.size, Image.LANCZOS)
A=np.asarray(a).astype(float); B=np.asarray(b).astype(float)
s=a.copy(); s.thumbnail((600,600), Image.LANCZOS)
y=np.asarray(s.convert("YCbCr")).astype(float)
sk=(y[:,:,1]>=77)&(y[:,:,1]<=127)&(y[:,:,2]>=133)&(y[:,:,2]<=173)
sk=ndimage.binary_closing(ndimage.binary_opening(sk,np.ones((3,3))),np.ones((7,7)))
m=np.asarray(Image.fromarray((sk*255).astype(np.uint8)).resize((A.shape[1],A.shape[0]),Image.NEAREST))>127
d=np.abs(A-B).mean(axis=2)
print(json.dumps({"手框":round(float(d[m].mean()),1),"背景":round(float(d[~m].mean()),1)}))
`, join(D, '_input', o), join(D, 'round4_bg', f)], { encoding: 'utf8' }))

/* 比例区 */
const RAT = has('round4_ratio') ? readdirSync(join(D, 'round4_ratio')).filter((f) => f.startsWith('C') && f.endsWith('.jpg')) : []
const ratBy = {}
for (const f of RAT) { const m = f.match(/^C(\d-\d+)_(.+)$/); if (m) (ratBy[m[2]] ||= {})[m[1]] = f }

const html = `<meta charset="utf-8">
<title>12a 第四轮对比包</title>
<style>
:root{--ink:#2b2622;--sub:#7a6f62;--line:#e6e0d8;--bad:#b3413a;--paper:#faf8f3}
body{font:14px/1.6 -apple-system,"PingFang SC",sans-serif;background:var(--paper);color:var(--ink);margin:0;padding:24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px;border-bottom:2px solid var(--line);padding-bottom:6px}
.sub{color:var(--sub);margin-bottom:16px}
.box{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:16px}
.box b{color:var(--bad)}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:10px}
th,td{border-bottom:1px solid var(--line);padding:9px;vertical-align:top;text-align:left;font-size:13px}
th{background:#f4f0e9;font-weight:600;position:sticky;top:0;z-index:2}
img{max-width:300px;border-radius:6px;display:block;border:1px solid var(--line)}
a img:hover{outline:2px solid #8a7a66}
.meta{font-size:11.5px;color:var(--sub);margin-top:5px;line-height:1.5}
.tag{display:inline-block;padding:0 5px;border-radius:3px;background:#efeae2;color:#6f6255;font-size:10px}
.red{color:var(--bad)}
.note{color:var(--bad);font-size:11px}
.miss{color:var(--bad);font-weight:600}
</style>
<h1>12a 第四轮对比包</h1>
<div class="sub">生成于 ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'short' }).format(new Date())} 多伦多 · 模型 doubao-seedream-5-0-pro-260628</div>

<div class="box">
<b>🔴 缩略图点开是原文件;这份 html 要留在产出夹里打开。</b><br><br>
<b>每个数都带范围标签</b>:<span class="tag">[全图]</span> 整张画面 · <span class="tag">[手框]</span> 只算皮肤。
「略白净」「磨皮」的宾语是皮肤,所以该看 [手框];[全图] 会把背景平均进去 ——
23 号就是例子:[全图]死白 6.83% 但 [手框] 只有 0.86%,<b>死白全在缎面背景上,皮肤没事</b>。<br><br>
<b>尺子统一了。</b> 我之前在 400px 缩略图上量死白,细小高光被平均掉,23 号少报了四倍。
现在全部走一个出口(全分辨率 / <code>convert('L')</code> / L&gt;225)。<br><br>
<b>🔴 LM-YC 那一列的 R:B 和死白回到原图,是「回贴」的定义,不是模型的功劳</b> ——
它把色度也贴回原图了,所以<b>你要的「略白净」在这一列按定义不存在</b>。
想要白净又不想拉冷,看 <b>LM-50</b>(只回一半)。
</div>

<h2>一、手部:六张 × 六档</h2>
<div class="box" style="margin-bottom:10px">
<b>肌理</b>那一行是「磨皮有没有效」第一次有尺(高斯 σ=4 残差 std,手框内)。
<b>比原图高 = 模型反而加了纹理</b>,与「轻度磨皮」相反,标红。<br>
脚注:<b>只有 18 号能干净归因</b> —— 02 和 23 在第三轮到 P1 之间<b>桶也变了</b>(从全图均亮改成手框均亮),两个变量同时动。
</div>
<table><tr><th style="width:130px">样片</th>${cols('x', 0).map((c) => `<th>${c[0]}</th>`).join('')}</tr>
${ORIGS.map((o, i) => {
  const cs = cols(o, i)
  return `<tr><td><b>${esc(o.slice(0, 2))}</b><div class="meta">${esc(o)}<br>${esc(HB[i].split('_')[1])}</div></td>
  ${cs.map((c) => cell(c[0], c[1], c[2], `_input/${o}`)).join('')}</tr>`
}).join('\n')}
</table>

<h2>二、背景:前三种(后两种等你确认)</h2>
<div class="box" style="margin-bottom:10px">
<b>🔴 「甲面框 diff」这个数报不了</b> —— 零依赖下做不出可靠的甲面分割(红甲会被当成皮肤、黑甲圈不上)。
替代:报 <span class="tag">[手框]</span> 与 <span class="tag">[背景]</span> 两个 diff,让「手动没动」和「背景真换了没」各有一个数。<br>
<b>44 号是「立体钻保不保得住」那道考题</b>:放大看过 —— <b>原图中指那枚「大椭圆钻+外圈碎钻+水滴珠」在虚化版里变成了带花边镶座的圆钻,右侧那枚的水滴钻变成两颗叠在一起</b>。
口令写着「只改背景,手与指甲的每一处细节、位置、形状、颜色都不变」,<b>没拦住</b>。
</div>
${Object.entries(bgBy).map(([o, list]) => `<table><tr><th style="width:130px">${esc(o.slice(0, 2))} 号</th><th>原图</th>${list.map((f) => `<th>${esc(f.split('_')[1])}</th>`).join('')}</tr>
<tr><td><div class="meta">${esc(o)}</div></td>
<td><a href="_input/${esc(o)}" target="_blank"><img src="data:image/jpeg;base64,${thumb(join(D, '_input', o))}"></a></td>
${list.map((f) => { const d = bgDiff(o, f); return `<td><a href="round4_bg/${esc(f)}" target="_blank"><img src="data:image/jpeg;base64,${thumb(join(D, 'round4_bg', f))}"></a>
<div class="meta"><span class="tag">[手框]</span> diff <b class="${d.手框 > 12 ? 'red' : ''}">${d.手框}</b>${d.手框 > 12 ? ' 🔴 手被动了' : ''}<br><span class="tag">[背景]</span> diff ${d.背景}</div></td>` }).join('')}
</tr></table>`).join('\n')}

<h2>三、比例</h2>
<div class="box" style="margin-bottom:10px">
三种竖比例是<b>非生成式裁切</b>(¥0,不经模型,甲面一个像素不动)。构图中心用「手部重心 + 指尖方向」推的,<b>不是甲面框</b>(做不出来)——框我逐张看过,指甲都在框内。<br>
<b>横 16:9 要扩图</b>,单探了一次 ¥0.32,结果在最后一行。
</div>
<table><tr><th style="width:130px">样片</th><th>原图</th><th>3:4</th><th>9:16</th><th>1:1</th></tr>
${Object.entries(ratBy).map(([o, r]) => `<tr><td><b>${esc(o.slice(0, 2))}</b></td>
<td><a href="_input/${esc(o)}" target="_blank"><img src="data:image/jpeg;base64,${thumb(join(D, '_input', o), 200)}"></a></td>
${['3-4', '9-16', '1-1'].map((k) => r[k] ? `<td><a href="round4_ratio/${esc(r[k])}" target="_blank"><img src="data:image/jpeg;base64,${thumb(join(D, 'round4_ratio', r[k]), 200)}"></a></td>` : '<td class="miss">—</td>').join('')}
</tr>`).join('\n')}
</table>
${has('round4_outpaint/OUT_16x9.jpg') ? `<div class="box">
<b>横 16:9 扩图探针(44 号,¥0.32)—— 这是本轮最好的一个结果。</b><br>
把竖图放进 16:9 画布正中、两侧留中性灰,请模型只补两侧。实测:
<b>中间原图区域 diff 4.4 · 手框 diff 4.4 · 两侧残留灰 0.2%</b>。<br>
对照:同一个模型<b>换背景</b>时手框 diff 是 15.7–93.6 —— <b>差一个数量级。扩图几乎没动原图,只补两侧。</b>
</div>
<table><tr><th>画布(两侧中性灰)</th><th>扩图结果 16:9</th></tr><tr>
<td><a href="round4_outpaint/_画布_16x9.jpg" target="_blank"><img style="max-width:420px" src="data:image/jpeg;base64,${thumb(join(D, 'round4_outpaint/_画布_16x9.jpg'), 420)}"></a></td>
<td><a href="round4_outpaint/OUT_16x9.jpg" target="_blank"><img style="max-width:420px" src="data:image/jpeg;base64,${thumb(join(D, 'round4_outpaint/OUT_16x9.jpg'), 420)}"></a></td>
</tr></table>` : ''}
`
writeFileSync(OUT, html)
console.log(`  对比包4:${OUT}\n  手部 ${ORIGS.length} 行 · 背景 ${BGF.length} 张 · 比例 ${Object.keys(ratBy).length} 行 · 扩图 ${has('round4_outpaint/OUT_16x9.jpg') ? '有' : '无'}`)

/* 12k §三 —— 对比包没有反馈按钮和导出按钮的,视为未交付。
   统一从 feedback-embed.mjs 这一个出口嵌,不许每个 build-report 各写一套。 */
import { fbScript as __fbScript } from './feedback-embed.mjs'
import { appendFileSync as __fbAppend } from 'node:fs'
__fbAppend(OUT, __fbScript())
console.log('  已嵌入可点反馈组件(12k)')
