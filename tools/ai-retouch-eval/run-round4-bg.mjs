/* P2 背景探针(12d补 §三-3,口令按补二 §二 改过)
 * 前三种 × 无 IP 的两张(23、44)= 6 次。42/43 有版权风险,按 §二 不进背景探针。
 * 🔴 44 号选它就是为了看**立体钻在换背景时保不保得住** —— 它是「甲面细节不许动」最狠的一张。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { bgPromptFor, BACKGROUNDS, findContradictions } from './round4-prompts.mjs'

const [, , ENV_FILE, IN_DIR, OUT_DIR] = process.argv
const KEY = (/ARK_API_KEY\s*=\s*(.+)/.exec(readFileSync(ENV_FILE, 'utf8'))?.[1] || '').trim()
if (!KEY) { console.error('🔴 钥匙读不到'); process.exit(2) }
const AREA_CAP = 4624220, PY = '/opt/anaconda3/bin/python3'
const MODEL = 'doubao-seedream-5-0-pro-260628', YUAN = 0.32
const FILES = ['23_IMG_4665.jpg', '44_IMG_3d钻.jpg']
const KINDS = ['虚化', '窗边', '暗调']        /* 后两种等店主确认(§六-2) */

/* 开跑前守一道:口令不许自相矛盾(补二 §二) */
for (const k of KINDS) {
  const c = findContradictions(bgPromptFor('B', '浅', k))
  if (c.length) { console.error(`🔴 背景口令「${k}」自相矛盾:${c.join(' / ')}`); process.exit(1) }
}
const dimsOf = (f) => { const o = execFileSync(PY, ['-c', `from PIL import Image;im=Image.open("${f}");print(im.width,im.height)`], { encoding: 'utf8' }).trim().split(' '); return { w: +o[0], h: +o[1] } }
const fitSize = ({ w, h }) => {
  if (w * h <= AREA_CAP) return `${w}x${h}`
  const r = Math.sqrt(AREA_CAP / (w * h))
  let nw = Math.floor(w * r / 2) * 2, nh = Math.floor(h * r / 2) * 2
  while (nw * nh > AREA_CAP) nh -= 2
  return `${nw}x${nh}`
}
mkdirSync(OUT_DIR, { recursive: true })
const jobs = FILES.flatMap((f) => KINDS.map((k) => ({ f, k })))
console.log(`P2 背景探针:${jobs.length} 次 ≈ ¥${(jobs.length * YUAN).toFixed(2)}`)
const log = []
let spend = 0
for (const [i, j] of jobs.entries()) {
  const src = join(IN_DIR, j.f), size = fitSize(dimsOf(src))
  const dst = join(OUT_DIR, `BG_${j.k}_${j.f}`)
  if (existsSync(dst)) { log.push({ 文件: j.f, 背景: j.k, 状态: '已存在跳过' }); continue }
  const b64 = readFileSync(src).toString('base64')
  const rec = { 文件: j.f, 背景: j.k, 请求尺寸: size }
  for (let a = 1; a <= 2; a += 1) {
    const t0 = Date.now()
    try {
      const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, prompt: bgPromptFor('B', '浅', j.k), image: `data:image/jpeg;base64,${b64}`, size, watermark: false, response_format: 'url' }),
        signal: AbortSignal.timeout(300000),
      })
      const d = await r.json()
      rec.耗时ms = Date.now() - t0
      if (!r.ok || !d.data?.[0]?.url) {
        rec.状态 = `🔴 HTTP ${r.status}`; rec.错误 = String(d.error?.message || '').slice(0, 220)
        if (/copyright/i.test(rec.错误)) { rec.状态 = '🔴 版权拒稿'; break }
        if (a === 2) break; continue
      }
      writeFileSync(dst, Buffer.from(await (await fetch(d.data[0].url)).arrayBuffer()))
      rec.状态 = '✅'; rec.出图尺寸 = d.data[0].size; spend += YUAN; break
    } catch (e) { rec.耗时ms = Date.now() - t0; rec.状态 = '🔴 超时/网络'; rec.错误 = String(e.message).slice(0, 100); if (a === 2) break }
  }
  log.push(rec)
  process.stdout.write(`\r  ${i + 1}/${jobs.length} ${j.k} ${j.f.slice(0, 2)} ${rec.状态}  已花 ≈${spend.toFixed(2)}   `)
}
console.log('')
console.log(`完成:成功 ${log.filter((r) => r.状态 === '✅').length} · 约花 ${spend.toFixed(2)} 元`)
writeFileSync(join(OUT_DIR, '_跑批日志.json'), JSON.stringify({
  生成于: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()) + ' 多伦多',
  花费元: Number(spend.toFixed(2)),
  口令: Object.fromEntries(KINDS.map((k) => [k, bgPromptFor('B', '浅', k)])),
  未跑的两种: Object.keys(BACKGROUNDS).filter((k) => !KINDS.includes(k)),
  明细: log,
}, null, 2))
for (const r of log.filter((x) => x.状态 !== '✅')) console.log(`  🔴 ${r.文件} ${r.背景} ${r.状态} ${(r.错误 || '').slice(0, 140)}`)
