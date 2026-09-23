/* 第五轮对比包(12e §三-5 · 12f §五-1)
 * 三区:手部分层(腿A/腿A′/腿B)· 分割验准叠图 · 无效件打标
 * 🔴 每个数带 [全图]/[手框] 标签;回贴/构造性指标不标 ✅,标「构造保证」。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { measure, texture } from './metrics.mjs'
const [, , D, R, OUT] = process.argv
const PY = '/opt/anaconda3/bin/python3'
const th = (f, w = 280) => { try { return execFileSync(PY, ['-c', `
import sys, io, base64
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB'); im.thumbnail((${w},${w*3}), Image.LANCZOS)
b=io.BytesIO(); im.save(b,'JPEG',quality=80); print(base64.b64encode(b.getvalue()).decode())`, f], { encoding: 'utf8', maxBuffer: 64e6 }).trim() } catch { return '' } }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const B2 = JSON.parse(readFileSync(join(R, '_腿B2记录.json'), 'utf8'))
const A1 = readdirSync(join(R, 'A_口令重组')).filter((f) => f.endsWith('.jpg')).sort()
const nums = A1.map((f) => f.slice(0, 2))
const origOf = (n) => readdirSync(join(D, '_input')).find((f) => f.startsWith(n + '_'))
const RNAME = R.split('/').pop()
/* 🔴 rel 一律**相对产出夹根 D**。上一版子夹 rel 相对 R、却拿 D 去 existsSync ——
   48 格里 40 格被静默判成"不存在"丢掉,页面照样渲染(第四轮"只出 2 行"的同一类错)。
   所以这里把夹名拼进 rel,并在下面加一条**格数对账断言**。 */
const find = (dir, n, kw) => {
  let f = null
  try { f = readdirSync(join(R, dir)).find((x) => x.startsWith(n) && (!kw || x.includes(kw))) } catch {}
  return f ? `${RNAME}/${dir}/${f}` : null
}

const rows = nums.map((n) => ({
  n, orig: `_input/${origOf(n)}`,
  cols: [
    ['原图', `_input/${origOf(n)}`, ''],
    ['腿A 四块口令', find('A_口令重组', n), '含冷白+磨皮句'],
    ['腿A′ 只去瑕疵', find('A2_只去瑕疵', n), '冷白/磨皮全删'],
    ['腿A′+亮度回贴全', find('B2_皮肤层_基于只去瑕疵', n, '亮度回贴全.jpg'), '构造:光与色回原图'],
    ['+皮肤层 轻', find('B2_皮肤层_基于只去瑕疵', n, '冷白轻'), '按 Y 均值比例'],
    ['+皮肤层 中', find('B2_皮肤层_基于只去瑕疵', n, '冷白中'), '按 Y 均值比例'],
  ],
  invalid: B2.无效件[n] || null,
}))
const all = [...new Set(rows.flatMap((r) => r.cols.map((c) => c[1])).filter((p) => p && existsSync(join(D, p))))]
/* 🔴 格数对账:应有格 = 每行每列里**磁盘上真有的**那些。丢格立刻红,不许静默少格。 */
const 应有格 = rows.reduce((s, r) => s + r.cols.filter((c) => c[1] && existsSync(join(D, c[1]))).length, 0)
const 期望 = rows.length * 6 - rows.filter((r) => r.invalid).length * 3   /* 无效件缺回贴+轻+中 三格 */
if (应有格 !== 期望) { console.error(`🔴 格数对账不上:磁盘有 ${应有格} 格,按「8行×6列 − 无效件×3」应为 ${期望}`); process.exit(1) }
console.log(`  格数对账:${应有格} = ${期望} ✅`)
const mm = measure(all.map((p) => join(D, p))); const M = new Map(all.map((p, i) => [p, mm[i]]))
const tt = texture(all.map((p) => join(D, p))); const T = new Map(all.map((p, i) => [p, tt[i]]))

const cell = (label, rel, note, baseRel) => {
  if (!rel || rel.endsWith('undefined') || !existsSync(join(D, rel))) return `<td class="miss">没有</td>`
  const m = M.get(rel), t = T.get(rel), b = T.get(baseRel)
  const hi = b && t?.手框肌理 > b?.手框肌理
  const ctor = /亮度回贴全/.test(rel)
  return `<td><a href="${esc('../' + rel)}" target="_blank"><img src="data:image/jpeg;base64,${th(join(D, rel))}"></a>
  <div class="meta"><b>${esc(label)}</b>${note ? '<br>' + esc(note) : ''}
  <br><span class="tag">[手框]</span> R:B ${m?.手框?.RB ?? '—'} · 死白 ${m?.手框?.死白 ?? '—'}%
  <br><span class="tag">[全图]</span> R:B ${m?.全图.RB} · 死白 ${m?.全图.死白}%
  <br><span class="tag">[手框]</span> 肌理 <b class="${hi ? 'red' : ''}">${t?.手框肌理 ?? '—'}</b>${hi ? ' 🔴比原图高' : ''}
  ${ctor ? '<br><span class="note">这两行是<b>回贴的定义</b>,不是模型的功劳 —— 不当通过项</span>' : ''}</div></td>`
}
const OVDIR = join(D, 'round6_分割验准_2026-09-24/叠图')
const ovs = existsSync(OVDIR) ? readdirSync(OVDIR).filter((f) => f.endsWith('.jpg')).sort() : []

writeFileSync(OUT, `<meta charset="utf-8">
<title>12a 第五轮对比包</title>
<style>
:root{--ink:#2b2622;--sub:#7a6f62;--line:#e6e0d8;--bad:#b3413a;--paper:#faf8f3}
body{font:14px/1.6 -apple-system,"PingFang SC",sans-serif;background:var(--paper);color:var(--ink);margin:0;padding:24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:26px 0 10px;border-bottom:2px solid var(--line);padding-bottom:6px}
.sub{color:var(--sub);margin-bottom:16px}
.box{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:16px}.box b{color:var(--bad)}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:10px}
th,td{border-bottom:1px solid var(--line);padding:9px;vertical-align:top;text-align:left;font-size:12.5px}
th{background:#f4f0e9;font-weight:600;position:sticky;top:0;z-index:2}
img{max-width:280px;border-radius:6px;display:block;border:1px solid var(--line)}
a img:hover{outline:2px solid #8a7a66}
.meta{font-size:11px;color:var(--sub);margin-top:5px;line-height:1.5}
.tag{display:inline-block;padding:0 5px;border-radius:3px;background:#efeae2;color:#6f6255;font-size:10px}
.red{color:var(--bad)}.note{color:var(--bad);font-size:10.5px}.miss{color:var(--bad);font-weight:600}
.bad{background:#fdf1f0}
</style>
<h1>12a 第五轮对比包 · 皮肤与甲面分两层</h1>
<div class="sub">生成于 ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'short' }).format(new Date())} 多伦多 · 模型 doubao-seedream-5-0-pro-260628</div>
<div class="box">
<b>🔴 这份 html 在 <code>round5_…/</code> 夹里,图走 <code>../</code> 指回产出夹根 —— 别把它单独拷走。</b><br><br>
每个数带范围标签:<span class="tag">[全图]</span> 整张 · <span class="tag">[手框]</span> 只算皮肤。<br>
<b>「腿A′+亮度回贴全」那一列的 R:B 和死白回到原图,是回贴的定义,不是模型的功劳</b> —— 不当通过项。
你要的「略白净」在那一列按定义不存在,看后面两档皮肤层。<br><br>
<b>皮肤层参数已改成按掩膜内 Y 均值的百分比</b>:同样的「轻」档,亮片 02 实际加 Y+4.4、暗片 28 只加 Y+1.5。
绝对值那版对两张都是 +6,正是 28 号被打爆的原因(R:B 崩到 1.087,跟没回贴一样蓝)。
</div>
<h2>一、手部分层:八张 × 六档</h2>
<table><tr><th style="width:120px">样片</th>${rows[0].cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr>
${rows.map((r) => `<tr class="${r.invalid ? 'bad' : ''}"><td><b>${esc(r.n)}</b>${r.invalid ? '<br><span class="red">掩膜失效</span>' : ''}
<div class="meta">${esc(origOf(r.n))}${r.invalid ? '<br><b class="red">' + esc(r.invalid) + '</b><br>皮肤层两档未出' : ''}</div></td>
${r.cols.map((c) => cell(c[0], c[1], c[2], r.orig)).join('')}</tr>`).join('\n')}
</table>
<h2>二、分割验准叠图(D221)</h2>
<div class="box" style="margin-bottom:10px">
红 = 手(不含甲)· 青 = 指甲 · <b>黄 = 重叠/分不开</b>。提示点/框<b>都由人给</b> —— 这只证明分割准不准,<b>不证明产品能自动出点</b>(三条自动路全不通)。<br>
<b>14 号「甲」层是 0.0%</b> —— 一个像素都没分出来,连人给框也不行。42 号重叠 45.5%。44 号重叠只有 4.1%、甲层 33.1% 干净。
</div>
<table><tr>${ovs.map((f) => `<th>${esc(f.split('_')[0])} 号 · ${esc(f.replace(/\.jpg$/, '').split('_').pop())}</th>`).join('')}</tr><tr>
${ovs.map((f) => `<td><a href="../round6_分割验准_2026-09-24/叠图/${esc(f)}" target="_blank"><img style="max-width:330px" src="data:image/jpeg;base64,${th(join(OVDIR, f), 330)}"></a></td>`).join('')}
</tr></table>
`)
console.log(`  对比包5:${OUT}\n  手部 ${rows.length} 行(无效件 ${rows.filter((r) => r.invalid).length} 行已打标)· 叠图 ${ovs.length} 张`)

/* 12k §三 —— 对比包没有反馈按钮和导出按钮的,视为未交付。
   统一从 feedback-embed.mjs 这一个出口嵌,不许每个 build-report 各写一套。 */
import { fbScript as __fbScript } from './feedback-embed.mjs'
import { appendFileSync as __fbAppend } from 'node:fs'
__fbAppend(OUT, __fbScript())
console.log('  已嵌入可点反馈组件(12k)')
