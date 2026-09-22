/* 12a 第一轮 · 对比包生成(店主 11y §一.2,2026-09-23)
 *
 * 🔴 店主定的两条口径,写死在这里:
 *   ① **每格标清输出尺寸** —— 她要**亲眼判缩小后的清晰度够不够**。
 *      **不预设阈值、不写「够/不够」的结论**,只把数摆出来:输出尺寸、占原图长边的百分比。
 *      (判据律那条反过来用:这一件不该由判据下结论,该由看的人下。)
 *   ② **①a(改甲面细节)单独算率** —— 11x §一.2 拆的两级里最重的那一级,一票否决。
 *
 * 初判由 Code 做(12a §2.2「先由 Code 初判,店主终判」),所以每格留一个可改的判定位,
 * 且**初判依据要写出来**,不是只给一个结论。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, basename } from 'node:path'

const [, , IN_DIR, R1_DIR, OUT_HTML] = process.argv
if (!IN_DIR || !R1_DIR || !OUT_HTML) { console.error('用法:node build-report.mjs <_input> <round1> <对比包.html>'); process.exit(2) }
const PY = '/opt/anaconda3/bin/python3'
const dims = (f) => {
  try {
    const o = execFileSync(PY, ['-c', `from PIL import Image;im=Image.open("${f}");print(im.width,im.height)`], { encoding: 'utf8' }).trim().split(' ')
    return { w: Number(o[0]), h: Number(o[1]) }
  } catch { return null }
}
/* 缩略图走 data: 内嵌 —— 对比包要能单文件发给店主,不依赖同目录(她可能只转发那个 html) */
const thumb = (f, w = 300) => {
  try {
    return execFileSync(PY, ['-c', `
import sys, io, base64
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
im.thumbnail((${w}, ${w * 3}), Image.LANCZOS)
b = io.BytesIO(); im.save(b, 'JPEG', quality=72)
print(base64.b64encode(b.getvalue()).decode())
`, f], { encoding: 'utf8', maxBuffer: 64e6 }).trim()
  } catch { return '' }
}

const logPath = join(R1_DIR, '_跑批日志.json')
const runLog = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : { 明细: [] }
const byKey = new Map(runLog.明细.map((r) => [`${r.模型}_${r.文件}`, r]))

const inputs = readdirSync(IN_DIR).filter((f) => f.endsWith('.jpg')).sort()
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const rows = []
for (const f of inputs) {
  const o = dims(join(IN_DIR, f))
  const cells = ['A', 'B'].map((code) => {
    const p = join(R1_DIR, `${code}_${f}`)
    if (!existsSync(p)) return { code, missing: true, log: byKey.get(`${code}_${f}`) }
    const d = dims(p)
    return {
      code, path: p, d,
      /* 🔴 店主要的那两个数:输出尺寸 + 占原图长边多少 */
      pctLong: o && d ? Math.round((Math.max(d.w, d.h) / Math.max(o.w, o.h)) * 100) : null,
      ratioOK: o && d ? Math.abs((d.w / d.h) - (o.w / o.h)) < 0.005 : null,
      log: byKey.get(`${code}_${f}`),
      bytes: statSync(p).size,
    }
  })
  rows.push({ f, o, cells })
}

const done = rows.flatMap((r) => r.cells).filter((c) => !c.missing)
/* 指令原文从 run-round1.mjs 源码里按行取 ——
   不用正则抠,正则里的反引号会把外层模板串提前关掉(刚踩过) */
const PROMPT_TEXT = (() => {
  const lines = readFileSync(new URL('./run-round1.mjs', import.meta.url), 'utf8').split('\n')
  const a = lines.findIndex((l) => l.startsWith('const PREFIX'))
  const b = lines.findIndex((l) => l.startsWith('const PROMPT'))
  return a >= 0 && b > a ? lines.slice(a, b + 1).join('\n') : '(取不到)'
})()

const html = `<meta charset="utf-8">
<title>12a 第一轮对比包</title>
<style>
:root{--ink:#2b2622;--sub:#7a6f62;--line:#e6e0d8;--paper:#faf8f3;--bad:#b3413a;--ok:#26794c}
body{font:14px/1.6 -apple-system,"PingFang SC",sans-serif;background:var(--paper);color:var(--ink);margin:0;padding:24px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--sub);margin-bottom:20px}
.legend{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:20px}
.legend b{color:var(--bad)}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{border-bottom:1px solid var(--line);padding:10px;vertical-align:top;text-align:left}
th{background:#f4f0e9;font-weight:600;position:sticky;top:0}
img{max-width:300px;border-radius:6px;display:block;cursor:zoom-in}
.meta{font-size:12px;color:var(--sub);margin-top:6px;line-height:1.5}
.sz{font-weight:600;color:var(--ink)}
.pct{display:inline-block;padding:1px 7px;border-radius:99px;background:#efeae2;color:#6f6255;font-size:11px;margin-left:4px}
.miss{color:var(--bad);font-weight:600}
.judge{margin-top:8px;font-size:12px}
.judge label{display:block;margin:2px 0}
details{margin-top:24px}pre{white-space:pre-wrap;background:#fff;border:1px solid var(--line);padding:14px;border-radius:8px;font-size:12px}
</style>
<h1>12a 第一轮对比包 · 41 张 × combo × 两模型</h1>
<div class="sub">生成于 ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'short' }).format(new Date())} 多伦多 · A = doubao-seedream-4-5-251128 · B = doubao-seedream-5-0-pro-260628</div>

<div class="legend">
<b>🔴 清晰度这一栏没有阈值,请你自己看。</b> 每格标了<b>输出尺寸</b>和<b>占原图长边的百分比</b>。<br>
输出比原图小,是因为 B 模型有面积上限 4,624,220 px 而 41 张原图全部超标 ——
两个模型要对照必须同尺寸,所以统一缩到 B 的上限内。<span class="sz">这不是模型修坏了,是接口档位的硬约束。</span><br><br>
<b>翻车分三类(12a §2.2),其中 ① 按 11x 拆两级:</b><br>
<b>①a 改甲面</b>(图案/形状/颜色/钻)—— 最重,一票否决,单独算率<br>
①b 改构图/手型/背景 &nbsp;·&nbsp; ② 伪影/六指/糊 &nbsp;·&nbsp; ③ 肤色怪
</div>

<table>
<tr><th style="width:150px">样片</th><th>原图</th><th>A · combo</th><th>B · combo</th></tr>
${rows.map((r) => {
  const cell = (c) => {
    if (c.missing) return `<td class="miss">未出图<div class="meta">${esc(c.log?.状态 || '')} ${esc(c.log?.错误 || '')}</div></td>`
    const t = thumb(c.path)
    return `<td><img src="data:image/jpeg;base64,${t}" alt="${esc(c.code)}">
      <div class="meta">
        <span class="sz">${c.d.w}×${c.d.h}</span><span class="pct">占原图长边 ${c.pctLong}%</span><br>
        比例与原图${c.ratioOK ? '一致' : '<b style="color:var(--bad)">不一致</b>'} ·
        ${c.log?.耗时ms ? (c.log.耗时ms / 1000).toFixed(1) + ' 秒' : ''} ·
        ${(c.bytes / 1024 / 1024).toFixed(2)} MB ·
        约 ${c.code === 'A' ? '0.25' : '0.32'} 元
      </div>
      <div class="judge">
        <label><input type="checkbox"> ①a 改了甲面</label>
        <label><input type="checkbox"> ①b 改了构图/手型/背景</label>
        <label><input type="checkbox"> ② 伪影/六指/糊</label>
        <label><input type="checkbox"> ③ 肤色怪</label>
      </div></td>`
  }
  const t0 = thumb(join(IN_DIR, r.f))
  return `<tr><td><b>${esc(r.f.split('_')[0])}</b><div class="meta">${esc(r.f)}<br>${r.o ? `${r.o.w}×${r.o.h}` : ''}</div></td>
    <td><img src="data:image/jpeg;base64,${t0}"><div class="meta">归一化后原图</div></td>
    ${cell(r.cells[0])}${cell(r.cells[1])}</tr>`
}).join('\n')}
</table>

<details open><summary style="margin-top:24px;cursor:pointer"><b>本轮指令原文(12a §2.1 要求附在页尾)</b></summary>
<pre>${esc(PROMPT_TEXT)}</pre>
</details>`
writeFileSync(OUT_HTML, html)
console.log(`  对比包:${OUT_HTML}`)
console.log(`  行数 ${rows.length} · 出图 ${done.length} / ${rows.length * 2}`)
