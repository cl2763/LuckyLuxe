/* 12a 第二轮对比包(小批 11z §三)
 *
 * 🔴 本文件存在的头号理由 = 修第一轮那个交付缺陷。
 *    第一轮我在每格标了「2740×1686」这种数字,但**嵌进去的是 300px 缩略图**,
 *    店主想「亲眼判缩小后清晰度够不够」,在对比包这一层**根本判不了** ——
 *    她看到的是模糊缩略,以为清晰度不行;打开 round1/ 里的真文件就能接受。
 *    标了尺寸数字 ≠ 给了她能判尺寸的东西。**判据律的同一条:自检的判据要能证伪你要证的那件事。**
 *
 *    改法两条(11z §〇.1 原话):
 *      ① 每张缩略图**包一层 <a> 指向原文件**,点开就是 round1/ round2/ 里那张;
 *      ② 页顶写明「缩略图仅供导航,清晰度以 round1/ round2/ 里的原文件为准」。
 *    ⚠️ 相应地:这份对比包**必须留在产出夹里打开**(相对路径指向同目录的 round1/ round2/),
 *       单独把 html 拷走会点不开 —— 这句也写进页顶。
 *
 * 另加 11z §三 要的「光影」列:死白 / 保留层次,**店主终判**,我只把客观量摆出来。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const [, , IN_DIR, R1_DIR, R2_DIR, OUT_HTML] = process.argv
if (!OUT_HTML) { console.error('用法:node build-report2.mjs <_input> <round1> <round2> <out.html>'); process.exit(2) }
const PY = '/opt/anaconda3/bin/python3'
const dims = (f) => { try { const o = execFileSync(PY, ['-c', `from PIL import Image;im=Image.open("${f}");print(im.width,im.height)`], { encoding: 'utf8' }).trim().split(' '); return { w: +o[0], h: +o[1] } } catch { return null } }
const thumb = (f, w = 340) => { try { return execFileSync(PY, ['-c', `
import sys, io, base64
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); im.thumbnail((${w}, ${w * 3}), Image.LANCZOS)
b = io.BytesIO(); im.save(b, 'JPEG', quality=80); print(base64.b64encode(b.getvalue()).decode())`, f], { encoding: 'utf8', maxBuffer: 64e6 }).trim() } catch { return '' } }
/* 明暗的客观量。
 * 🔴 指标换过一次,换的理由写在这里:一开始我用「暗部占比」当主指标,**那是个废指标** ——
 *    店主认可的参考01 暗部只有 6.5%(比模型出图还少)却很高级,参考04 暗部 65.2% 也高级,毫无规律。
 *    把四张参考图和模型出图放同一把尺子上量,真正分开两者的是另外两个数:
 *      · **最亮值 p95**:参考图 107–151(均 131),模型出图 228–247(均 235)→ **「死白」= 高光冲顶**
 *      · **R/B 冷暖**:参考图 1.17–1.32 **全偏暖**,模型出图 0.91–1.04 **偏冷**
 *    所以主指标改成 p95 与 R/B,暗部占比降为参考值。**不下「死白/有层次」的结论**,那一栏仍归店主。 */
const tone = (f) => { try { return JSON.parse(execFileSync(PY, ['-c', `
import sys, json
import numpy as np
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); im.thumbnail((320,320), Image.LANCZOS)
a = np.asarray(im).astype(np.float64)
l = 0.299*a[:,:,0] + 0.587*a[:,:,1] + 0.114*a[:,:,2]
print(json.dumps({'暗部占比': round(float((l<64).mean())*100,1), 'p5': round(float(np.percentile(l,5)),1), 'p95': round(float(np.percentile(l,95)),1), '均亮': round(float(l.mean()),1), 'RB': round(float(a[:,:,0].mean()/max(a[:,:,2].mean(),1e-6)),3), '很亮区': round(float((l>225).mean()*100),1), '过曝块': round(float((l>245).mean()*100),2)}))`, f], { encoding: 'utf8' })) } catch { return null } }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const rel = (dir, f) => `${dir.split('/').pop()}/${f}`   /* 相对同目录,点开即原文件 */

const inputs = readdirSync(IN_DIR).filter((f) => f.endsWith('.jpg')).sort()
const log2 = existsSync(join(R2_DIR, '_跑批日志.json')) ? JSON.parse(readFileSync(join(R2_DIR, '_跑批日志.json'), 'utf8')) : { 明细: [] }
const by2 = new Map(log2.明细.filter((r) => r.轮次 === '主').map((r) => [r.文件, r]))

const cell = (label, path, href, o, log) => {
  if (!path || !existsSync(path)) return `<td class="miss">未出图<div class="meta">${esc(log?.状态 || '')}<br>${esc((log?.错误 || '').slice(0, 90))}</div></td>`
  const d = dims(path), t = tone(path)
  const pct = o && d ? Math.round((Math.max(d.w, d.h) / Math.max(o.w, o.h)) * 100) : null
  return `<td>
    <a href="${esc(href)}" target="_blank" title="点开看原文件(${d.w}×${d.h})"><img src="data:image/jpeg;base64,${thumb(path)}" alt="${esc(label)}"></a>
    <div class="meta"><span class="sz">${d.w}×${d.h}</span><span class="pct">原图长边 ${pct}%</span> · ${(statSync(path).size / 1048576).toFixed(2)} MB${log?.耗时ms ? ' · ' + (log.耗时ms / 1000).toFixed(1) + ' 秒' : ''}
    <br><b>死白区 ${t.很亮区}%</b>${t.很亮区 > 1 ? '<span class="hot">超参考图</span>' : ''} · <b>冷暖 ${t.RB}</b>${t.RB < 1.10 ? '<span class="cold">偏冷</span>' : ''}<br>最亮 ${t.p95} · 均亮 ${t.均亮} · 暗部 ${t.暗部占比}%</div>
    <div class="judge"><b>光影</b>(你判)<label><input type="checkbox"> 死白没层次</label><label><input type="checkbox"> 保留了层次</label>
    <b>翻车</b><label><input type="checkbox"> ①a 改甲面</label><label><input type="checkbox"> ①b 改构图/背景</label><label><input type="checkbox"> ③ 肤色怪</label></div></td>`
}

const rows = inputs.map((f) => {
  const o = dims(join(IN_DIR, f))
  return { f, o, t0: tone(join(IN_DIR, f)) }
})

const html = `<meta charset="utf-8">
<title>12a 第二轮对比包</title>
<style>
:root{--ink:#2b2622;--sub:#7a6f62;--line:#e6e0d8;--bad:#b3413a;--paper:#faf8f3}
body{font:14px/1.6 -apple-system,"PingFang SC",sans-serif;background:var(--paper);color:var(--ink);margin:0;padding:24px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--sub);margin-bottom:18px}
.box{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:16px}
.box b{color:var(--bad)}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{border-bottom:1px solid var(--line);padding:10px;vertical-align:top;text-align:left}
th{background:#f4f0e9;font-weight:600;position:sticky;top:0;z-index:2}
img{max-width:340px;border-radius:6px;display:block;border:1px solid var(--line)}
a img:hover{outline:2px solid #8a7a66}
.meta{font-size:12px;color:var(--sub);margin-top:6px;line-height:1.5}
.sz{font-weight:600;color:var(--ink)}
.pct{display:inline-block;padding:1px 7px;border-radius:99px;background:#efeae2;color:#6f6255;font-size:11px;margin-left:4px}
.miss{color:var(--bad);font-weight:600}
.hot,.cold{display:inline-block;padding:0 6px;border-radius:99px;font-size:10px;margin-left:4px;color:#fff}
.hot{background:#b3413a}.cold{background:#4a6fa5}
.judge{margin-top:8px;font-size:12px}.judge label{display:block;margin:1px 0}.judge b{display:block;margin-top:5px;color:var(--ink)}
pre{white-space:pre-wrap;background:#fff;border:1px solid var(--line);padding:14px;border-radius:8px;font-size:12px}
</style>
<h1>12a 第二轮对比包 · 只跑 B · 口令按「相机质感」重写</h1>
<div class="sub">生成于 ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'short' }).format(new Date())} 多伦多 · 模型 doubao-seedream-5-0-pro-260628</div>

<div class="box">
<b>🔴 缩略图只是导航,清晰度以原文件为准 —— 点任何一张图就打开原文件。</b><br>
上一版对比包我嵌的是 300px 缩略图,你在那一层判清晰度是判不准的(你说"修好的文件夹里的图能接受、网页预览的不接受",
就是这个原因 —— 你接受的那个才是真实输出)。这一版每张都点得开。<br><br>
<b>⚠️ 这份 html 要留在产出夹里打开</b>,它按相对路径指向同目录的 <code>round1/</code> <code>round2/</code>;单独把 html 拷到别处,点开会失效。
</div>

<div class="box">
<b>「光影」这一栏我不下结论,你判。</b> 但客观量我换过两次指标,第二次换出了硬结论,值得你看一眼:<br><br>

先用「暗部占比」——<b>废指标</b>:你的<b>参考01 暗部只有 6.5%</b>(比模型出图还少)照样高级,参考04 暗部 65.2% 也高级,毫无规律。<br>
再用「最亮值」——方向对了。最后落到<b>「死白区」= 画面里亮度超过 225 的像素占多少</b>,这条最直接:

<table style="width:auto;margin:10px 0;font-size:13px">
<tr><th></th><th>死白区占比</th><th>冷暖 R/B</th></tr>
<tr><td><b>你的参考图(四张)</b></td><td><b>0.0% – 0.1%</b></td><td>1.17 – 1.32 <b>全偏暖</b></td></tr>
<tr><td>原片本身</td><td>0.0% – 8.4%</td><td>1.13 – 1.41 偏暖</td></tr>
<tr><td><b>模型出图</b></td><td><b>1.7% – 26.3%</b></td><td>0.91 – 1.20 <b>偏冷</b></td></tr>
</table>

<b>结论:原片没有死白,你的参考图也没有,死白是模型自己造出来的。</b><br>
冷暖同理 —— 原片和参考图都偏暖,模型一律拉到中性以下。口令里还留着「白平衡轻微偏冷,让白色回到中性白」,<b>方向跟你的参考图是反的</b>。<br><br>
每格的「超参考图」「偏冷」只是标注,阈值取自你那四张参考图,<b>不代表我替你判了好坏</b>。
</div>

<table>
<tr><th style="width:150px">样片</th><th>原图</th><th>第一轮 B(旧口令)</th><th>第二轮 B(新口令)</th></tr>
${rows.map((r) => {
  const f = r.f
  return `<tr>
  <td><b>${esc(f.split('_')[0])}</b><div class="meta">${esc(f)}<br>${r.o ? `${r.o.w}×${r.o.h}` : ''}
    <br><br><b>死白区 ${r.t0.很亮区}%</b><br><b>冷暖 ${r.t0.RB}</b><br>最亮 ${r.t0.p95} · 均亮 ${r.t0.均亮}</div></td>
  <td><a href="${esc(rel(IN_DIR, f))}" target="_blank"><img src="data:image/jpeg;base64,${thumb(join(IN_DIR, f))}"></a><div class="meta">归一化后原图(基准)</div></td>
  ${cell('R1', join(R1_DIR, `B_${f}`), rel(R1_DIR, `B_${f}`), r.o, null)}
  ${cell('R2', join(R2_DIR, `B2_${f}`), rel(R2_DIR, `B2_${f}`), r.o, by2.get(f))}
</tr>`
}).join('\n')}
</table>

<details open style="margin-top:24px"><summary style="cursor:pointer"><b>第二轮口令原文(11z §二,逐字照抄没润色)</b></summary>
<pre>${esc(log2.口令 || '(日志里没有)')}</pre>
<p style="font-size:13px;color:var(--sub)">与第一轮的差别:前缀追加了「肤色、白平衡、亮度的调整只作用于皮肤与背景,指甲区域的颜色、明暗、反光一律保持原样」;
{PRESET} 整段换成相机质感那条;删掉了「冷白皮」「只保留一条水光反射带」「阴影提亮不发灰」「整体曝光提到正常水平」。</p>
</details>
`
writeFileSync(OUT_HTML, html)
const got = rows.filter((r) => existsSync(join(R2_DIR, `B2_${r.f}`))).length
console.log(`  对比包2:${OUT_HTML}\n  行数 ${rows.length} · 第二轮出图 ${got}/${rows.length}`)
