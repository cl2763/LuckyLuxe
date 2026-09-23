/* 12a 第三轮对比包(12c §三)
 * 四列:原图 | 第二轮(统一口令) | 第三轮(分桶口令) | 非生成式(不经模型)
 * 🔴 页顶先放**店主的 L5 偏好**当锚 —— 12c §一 定的:指标降级为参考,她的偏好是标准。
 * 🔴 缩略图点开原文件(11z §〇.1 的修复,这版继续守)。
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const [, , D, OUT] = process.argv
const PY = '/opt/anaconda3/bin/python3'
const q = (f, w = 340) => { try { return execFileSync(PY, ['-c', `
import sys, io, base64
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB'); im.thumbnail((${w}, ${w*3}), Image.LANCZOS)
b=io.BytesIO(); im.save(b,'JPEG',quality=82); print(base64.b64encode(b.getvalue()).decode())`, f], { encoding: 'utf8', maxBuffer: 64e6 }).trim() } catch { return '' } }
const M = (f) => { try { return JSON.parse(execFileSync(PY, ['-c', `
import sys, json
import numpy as np
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB'); im.thumbnail((400,400), Image.LANCZOS)
a=np.asarray(im).astype(float); l=0.299*a[:,:,0]+0.587*a[:,:,1]+0.114*a[:,:,2]
print(json.dumps({'均亮':round(float(l.mean()),1),'暗部':round(float((l<40).mean()*100),1),'死白':round(float((l>225).mean()*100),2),'p95':round(float(np.percentile(l,95)),1),'RB':round(float(a[:,:,0].mean()/max(a[:,:,2].mean(),1e-6)),3),'w':im.width,'h':im.height}))`, f], { encoding: 'utf8' })) } catch { return null } }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const L3 = JSON.parse(readFileSync(join(D, 'round3/_跑批日志.json'), 'utf8'))
/* 🔴 行从**磁盘上的实际出图**来,不从日志的状态字段来。
 *    上一版按 `r.状态 === '✅'` 过滤,而补跑日志里"已存在跳过"那几条用的是旧字段名(f/b),
 *    `r.文件` 是 undefined → 被**静默丢掉** → 页面只剩 2 行还渲染得好好的。
 *    是"探针 N 行"这个计数把它咬出来的(判据五:计数即证)。 */
const 选它的理由 = new Map(readdirSync(join(D, 'round3')).filter((f) => f.startsWith('B3'))
  .map((f) => [f.slice(4), (L3.明细.find((r) => (r.文件 || r.f) === f.slice(4)) || {}).选它的理由 || '']))
const rows = readdirSync(join(D, 'round3')).filter((f) => f.startsWith('B3') && f.endsWith('.jpg')).sort()
  .map((f) => ({ 桶: f[2], 文件: f.slice(4), 选它的理由: 选它的理由.get(f.slice(4)) || '' }))
/* 🔴 断言要跟**另一个来源**对账,不能拿 readdirSync 跟自己比(那是废判据,永远绿)。
 *    对账对象 = 跑批日志里「没红」的条数(成功 + 已存在跳过)。磁盘少一张就红。 */
const 日志应有 = L3.明细.filter((r) => !String(r.状态).startsWith('🔴')).length
if (rows.length !== 日志应有) {
  console.error(`🔴 磁盘出图 ${rows.length} 张 ≠ 日志里没红的 ${日志应有} 条 —— 有图丢了或日志不实`)
  process.exit(1)
}

const cell = (label, rel, note) => {
  const p = join(D, rel)
  if (!existsSync(p)) return `<td class="miss">没有<div class="meta">${esc(note || '')}</div></td>`
  const m = M(p)
  return `<td><a href="${esc(rel)}" target="_blank" title="点开看原文件 ${m.w}×${m.h}"><img src="data:image/jpeg;base64,${q(p)}"></a>
  <div class="meta"><b>${esc(label)}</b>${note ? ' · ' + esc(note) : ''}<br>
  均亮 ${m.均亮} · 暗部 ${m.暗部}% · 死白 ${m.死白}%<br>最亮 ${m.p95} · 冷暖 ${m.RB} · ${(statSync(p).size / 1048576).toFixed(2)} MB</div></td>`
}

/* ── 页顶的锚:店主的 L5 偏好 ── */
const anchors = [
  { f: '02_IMG_0555.jpg', picks: [['B2_L5r3_02_IMG_0555.jpg', 'r3', true], ['B2_L5r2_02_IMG_0555.jpg', 'r2', false]] },
  { f: '18_IMG_4239.jpg', picks: [['B2_L5r1_18_IMG_4239.jpg', 'r1', true], ['B2_L5r3_18_IMG_4239.jpg', 'r3', true], ['B2_L5r2_18_IMG_4239.jpg', 'r2', false]] },
]

const html = `<meta charset="utf-8">
<title>12a 第三轮对比包 · 先分桶再修</title>
<style>
:root{--ink:#2b2622;--sub:#7a6f62;--line:#e6e0d8;--bad:#b3413a;--ok:#2d7a52;--paper:#faf8f3}
body{font:14px/1.6 -apple-system,"PingFang SC",sans-serif;background:var(--paper);color:var(--ink);margin:0;padding:24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:26px 0 10px}
.sub{color:var(--sub);margin-bottom:18px}
.box{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:16px}
.box b{color:var(--bad)}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:8px}
th,td{border-bottom:1px solid var(--line);padding:10px;vertical-align:top;text-align:left}
th{background:#f4f0e9;font-weight:600;position:sticky;top:0;z-index:2}
img{max-width:340px;border-radius:6px;display:block;border:1px solid var(--line)}
a img:hover{outline:2px solid #8a7a66}
.meta{font-size:12px;color:var(--sub);margin-top:6px;line-height:1.5}
.miss{color:var(--bad);font-weight:600}
.pick{outline:3px solid var(--ok)!important}
.tag{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11px;color:#fff;margin-left:5px}
.t-ok{background:var(--ok)}.t-no{background:#9a9088}.t-a{background:#6b5b8a}.t-b{background:#4a6fa5}
pre{white-space:pre-wrap;background:#fff;border:1px solid var(--line);padding:14px;border-radius:8px;font-size:12px}
</style>
<h1>12a 第三轮对比包 · 先分桶再修</h1>
<div class="sub">生成于 ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'short' }).format(new Date())} 多伦多 · 模型 doubao-seedream-5-0-pro-260628 · 探针 ${rows.length} 张</div>

<div class="box">
<b>🔴 缩略图点开就是原文件。这份 html 要留在产出夹里打开</b>(按相对路径找 <code>round2/ round3/ round3_plain/</code>)。<br><br>
<b>这一轮的标准是你的眼睛,不是我的数。</b> 12c §一 已经查明:我提的「死白区」指标跟你的选择对不上 ——
02 号你选的 r3 死白 <b>18.9%</b>,比你不要的 r2(10.1%)还多近一倍;18 号你不要的 r2 恰好是最亮值最高那张。<br>
我又自己核了一遍:<b>这五张里没有任何单一数字能把「喜欢」和「不喜欢」分开</b>,5 张也拟合不出判据。
所以每格的数只是**参考**,摆在那里方便你回头对照,<b>不代表我替你判了好坏</b>。
</div>

<h2>一、锚:你在 L5 里挑过的那几张(绿框=你喜欢的)</h2>
<div class="box" style="margin-bottom:10px">这两组是<b>同一张原图、同一条第二轮口令、连跑三次</b>的结果 —— 你挑了其中几张。
放在页顶是为了让下面第三轮的图有个参照:第三轮该往这个方向走。</div>
${anchors.map((a) => `<table><tr><th style="width:150px">${esc(a.f.slice(0, 2))} 号</th><th>原图</th>${a.picks.map(([, lab, ok]) => `<th>${lab}${ok ? '<span class="tag t-ok">你喜欢</span>' : '<span class="tag t-no">你不要</span>'}</th>`).join('')}</tr>
<tr><td><div class="meta">${esc(a.f)}</div></td>
${cell('原图', `_input/${a.f}`)}
${a.picks.map(([f, lab, ok]) => {
  const p = join(D, 'round2', f), m = M(p)
  return `<td><a href="${esc('round2/' + f)}" target="_blank"><img class="${ok ? 'pick' : ''}" src="data:image/jpeg;base64,${q(p)}"></a>
  <div class="meta"><b>${lab}</b> ${ok ? '★ 你喜欢' : '你不要'}<br>均亮 ${m.均亮} · 暗部 ${m.暗部}% · 死白 ${m.死白}%<br>最亮 ${m.p95} · 冷暖 ${m.RB}</div></td>`
}).join('')}
</tr></table>`).join('\n')}

<h2>二、第三轮探针:分桶口令 vs 第二轮统一口令 vs 不经模型</h2>
<div class="box" style="margin-bottom:10px">
<b>桶由「量」定,不让模型自己判</b> —— L5 已经证明模型同图同令三次都不一样,让它自己判「这张算不算欠曝」只会更不稳。<br>
<span class="tag t-a">桶 A 暗调</span>不许整体提亮,只把死黑抬一点点,景深靠背景虚化 &nbsp;
<span class="tag t-b">桶 B 正常</span>不动曝光,最亮处保留细节<br>
<b>第四列「不经模型」是零成本对照</b>:只做曲线和局部提亮,不碰甲面也不碰构图 —— 给「值不值得用 AI」一个底。
</div>
<table>
<tr><th style="width:170px">样片</th><th>原图</th><th>第二轮(统一口令)</th><th>第三轮(分桶口令)</th><th>不经模型</th></tr>
${rows.map((r) => `<tr>
<td><b>${esc(r.文件.slice(0, 2))}</b><span class="tag t-${r.桶.toLowerCase()}">桶 ${r.桶}</span>
<div class="meta">${esc(r.文件)}<br><br><b>选它的理由</b><br>${esc(r.选它的理由)}</div></td>
${cell('原图', `_input/${r.文件}`)}
${cell('第二轮', `round2/B2_${r.文件}`, '统一口令')}
${cell('第三轮', `round3/B3${r.桶}_${r.文件}`, `桶 ${r.桶} 口令`)}
${cell('不经模型', `round3_plain/P_${r.文件}`, '曲线+局部提亮')}
</tr>`).join('\n')}
</table>

<h2>三、三桶口令原文</h2>
${['A', 'B', 'C'].map((b) => `<details${b === 'C' ? '' : ' open'}><summary style="cursor:pointer"><b>桶 ${b}</b>${b === 'C' ? ' —— 🔴 本批 41 张零成员,没跑,口令先备着' : ''}</summary><pre>${esc(L3.口令[b])}</pre></details>`).join('\n')}
`
writeFileSync(OUT, html)
console.log(`  对比包3:${OUT}\n  探针 ${rows.length} 行`)

/* 12k §三 —— 对比包没有反馈按钮和导出按钮的,视为未交付。
   统一从 feedback-embed.mjs 这一个出口嵌,不许每个 build-report 各写一套。 */
import { fbScript as __fbScript } from './feedback-embed.mjs'
import { appendFileSync as __fbAppend } from 'node:fs'
__fbAppend(OUT, __fbScript())
console.log('  已嵌入可点反馈组件(12k)')
