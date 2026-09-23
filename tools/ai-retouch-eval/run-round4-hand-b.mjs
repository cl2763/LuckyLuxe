/* P1b 手部探针(磨皮矛盾已拆)(12d补 §三-2 + §七-4)—— 桶 × 甲面色调 2×2 覆盖,6 次
 * 🔴 曝光桶用**手框均亮**(§七-1);甲面色调是**我看图判的**,不是算的 ——
 *    零依赖下做不出可靠甲面分割(证据:12a_四 的 PoC 否定 + 本批肤色掩膜取反在红甲/黑甲上失败)。
 *    判定写在 TONE 表里,店主可逐条推翻。
 * 🔴 42/43 有版权风险(唐老鸭 / 蜡笔小新):拒稿 = 失败不计张数、不重试、记录原文(§二)。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { handPromptForP1b, bucketOfSkin, handPromptFor } from './round4-prompts.mjs'

const [, , ENV_FILE, IN_DIR, OUT_DIR, REGION_JSON] = process.argv
const KEY = (/ARK_API_KEY\s*=\s*(.+)/.exec(readFileSync(ENV_FILE, 'utf8'))?.[1] || '').trim()
if (!KEY) { console.error('🔴 钥匙读不到'); process.exit(2) }
const AREA_CAP = 4624220, PY = '/opt/anaconda3/bin/python3'
const MODEL = 'doubao-seedream-5-0-pro-260628', YUAN = 0.32

/* 甲面色调 —— Code 看图判(§七-2 的二分类),附理由 */
const TONE = {
  '02_IMG_0555.jpg': ['深', '纯黑短甲'],
  '18_IMG_4239.jpg': ['深', '黑紫猫眼,整体深色'],
  '23_IMG_4665.jpg': ['浅', '香槟白闪粉 + 透明感,带雪花与大钻'],
  '42_IMG_197.jpg': ['浅', '裸色长甲,单色浅裸'],
  '43_IMG_199.jpg': ['浅', '裸粉长甲,单色浅裸'],
  '44_IMG_3d钻.jpg': ['浅', '透明蕾丝甲面 + 多颗立体钻与珍珠 —— 细节最密的一张'],
}
const dimsOf = (f) => { const o = execFileSync(PY, ['-c', `from PIL import Image;im=Image.open("${f}");print(im.width,im.height)`], { encoding: 'utf8' }).trim().split(' '); return { w: +o[0], h: +o[1] } }
const fitSize = ({ w, h }) => {
  if (w * h <= AREA_CAP) return `${w}x${h}`
  const r = Math.sqrt(AREA_CAP / (w * h))
  let nw = Math.floor(w * r / 2) * 2, nh = Math.floor(h * r / 2) * 2
  while (nw * nh > AREA_CAP) nh -= 2
  return `${nw}x${nh}`
}
const R = new Map(JSON.parse(readFileSync(REGION_JSON, 'utf8')).map((x) => [x.f, x]))
mkdirSync(OUT_DIR, { recursive: true })
const jobs = Object.keys(TONE).map((f) => {
  const m = R.get(f)
  const b = bucketOfSkin(m.手框均亮, m.全图均亮 /*p95 缺,C 桶本批为空*/ , m.全图均亮)
  return { f, b, tone: TONE[f][0], why: TONE[f][1], m }
})
/* 反向守:2×2 必须真覆盖,缺一格就红 —— 否则"两维"白设 */
const cells = new Set(jobs.map((j) => `${j.b}×${j.tone}`))
console.log('  覆盖格:', [...cells].join(' · '))
for (const need of ['A×深', 'A×浅', 'B×深', 'B×浅']) {
  if (!cells.has(need)) { console.error(`🔴 2×2 缺格:${need} —— §七-4 要求每格至少 1 张`); process.exit(1) }
}
console.log(`P1b 手部探针(磨皮矛盾已拆):${jobs.length} 次 ≈ ¥${(jobs.length * YUAN).toFixed(2)}`)
const log = []
let spend = 0
for (const [i, j] of jobs.entries()) {
  const src = join(IN_DIR, j.f), d0 = dimsOf(src), size = fitSize(d0)
  const dst = join(OUT_DIR, `Hb_${j.b}${j.tone}_${j.f}`)
  if (existsSync(dst)) { log.push({ 文件: j.f, 桶: j.b, 甲面: j.tone, 状态: '已存在跳过' }); continue }
  const b64 = readFileSync(src).toString('base64')
  const rec = { 文件: j.f, 桶: j.b, 甲面: j.tone, 判定理由: j.why, 手框均亮: j.m.手框均亮, 请求尺寸: size }
  for (let a = 1; a <= 2; a += 1) {
    const t0 = Date.now()
    try {
      const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, prompt: handPromptForP1b(j.b, j.tone), image: `data:image/jpeg;base64,${b64}`, size, watermark: false, response_format: 'url' }),
        signal: AbortSignal.timeout(300000),
      })
      const d = await r.json()
      rec.耗时ms = Date.now() - t0
      if (!r.ok || !d.data?.[0]?.url) {
        rec.状态 = `🔴 HTTP ${r.status}`; rec.错误 = String(d.error?.message || '').slice(0, 220)
        /* 版权拒稿 = 失败不计张数、**不重试**(§二) */
        if (/copyright/i.test(rec.错误)) { rec.状态 = '🔴 版权拒稿'; break }
        if (a === 2) break; continue
      }
      writeFileSync(dst, Buffer.from(await (await fetch(d.data[0].url)).arrayBuffer()))
      rec.状态 = '✅'; rec.出图尺寸 = d.data[0].size; spend += YUAN; break
    } catch (e) { rec.耗时ms = Date.now() - t0; rec.状态 = '🔴 超时/网络'; rec.错误 = String(e.message).slice(0, 100); if (a === 2) break }
  }
  log.push(rec)
  process.stdout.write(`\r  ${i + 1}/${jobs.length} ${j.b}×${j.tone} ${j.f.slice(0, 2)} ${rec.状态}  已花 ≈${spend.toFixed(2)}   `)
}
console.log('')
console.log(`完成:成功 ${log.filter((r) => r.状态 === '✅').length} · 约花 ${spend.toFixed(2)} 元`)
writeFileSync(join(OUT_DIR, '_跑批日志.json'), JSON.stringify({
  生成于: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()) + ' 多伦多',
  花费元: Number(spend.toFixed(2)),
  口令: Object.fromEntries([['A深', handPromptForP1b('A','深')], ['A浅', handPromptForP1b('A','浅')], ['B深', handPromptForP1b('B','深')], ['B浅', handPromptForP1b('B','浅')]]),
  明细: log,
}, null, 2))
for (const r of log.filter((x) => x.状态 !== '✅')) console.log(`  🔴 ${r.文件} ${r.状态} ${(r.错误 || '').slice(0, 140)}`)
