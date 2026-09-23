/* 12a 第三轮探针 · 先分桶再修(小批 12c §三)
 * 桶由「量」定(bucketOf),不让模型自己判 —— L5 已证模型自判不稳。
 * 每桶 3 张 × 1 次。🔴 桶 C 本批 41 张零成员,只能跑 A/B 两桶 6 次,已在回执写明。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { promptFor, bucketOf } from './bucket-prompts.mjs'

const [, , ENV_FILE, IN_DIR, OUT_DIR, BUCKETS_JSON] = process.argv
const KEY = (/ARK_API_KEY\s*=\s*(.+)/.exec(readFileSync(ENV_FILE, 'utf8'))?.[1] || '').trim()
if (!KEY) { console.error('🔴 钥匙读不到'); process.exit(2) }
const AREA_CAP = 4624220, PY = '/opt/anaconda3/bin/python3'
const MODEL = 'doubao-seedream-5-0-pro-260628', YUAN = 0.32

/* 探针选样(12c §三:02 与 18 必在其桶里)。其余挑「已知两轮都败」的,信息量最大 */
const PICKS = {
  A: [['02_IMG_0555.jpg', '店主点名;她的 L5 偏好在这张上'],
      ['18_IMG_4239.jpg', '原图最暗(均亮 32);她的 L5 偏好也在这张上'],
      ['28_IMG_49512.jpg', '墨绿→天蓝,第二轮比第一轮更糟 —— 验色温那句']],
  B: [['15_IMG_37912.jpg', '暖金闪→银白,两轮都败'],
      ['23_IMG_4665.jpg', '香槟金→银白 + 米金绸缎被洗成纯白,两轮都败'],
      ['41_IMG_9668.jpg', '粉底→白底,两轮都败']],
}
const dimsOf = (f) => { const o = execFileSync(PY, ['-c', `from PIL import Image;im=Image.open("${f}");print(im.width,im.height)`], { encoding: 'utf8' }).trim().split(' '); return { w: +o[0], h: +o[1] } }
const fitSize = ({ w, h }) => {
  if (w * h <= AREA_CAP) return `${w}x${h}`
  const r = Math.sqrt(AREA_CAP / (w * h))
  let nw = Math.floor(w * r / 2) * 2, nh = Math.floor(h * r / 2) * 2
  while (nw * nh > AREA_CAP) nh -= 2
  return `${nw}x${nh}`
}
const metrics = new Map(JSON.parse(readFileSync(BUCKETS_JSON, 'utf8')).map((t) => [t.f, t]))
mkdirSync(OUT_DIR, { recursive: true })
const jobs = []
for (const [b, list] of Object.entries(PICKS)) for (const [f, why] of list) {
  const t = metrics.get(f)
  /* 🔴 反向守:选样时标的桶,必须等于按量算出来的桶。不等就是选错了,红 */
  if (bucketOf(t) !== b) { console.error(`🔴 ${f} 标为桶 ${b},按量算却是桶 ${bucketOf(t)} —— 选样错了`); process.exit(1) }
  jobs.push({ f, b, why, t })
}
console.log(`第三轮探针:${jobs.length} 次 ≈ ¥${(jobs.length * YUAN).toFixed(2)}`)
const log = []
let spend = 0
for (const [i, j] of jobs.entries()) {
  const src = join(IN_DIR, j.f), d0 = dimsOf(src), size = fitSize(d0)
  const dst = join(OUT_DIR, `B3${j.b}_${j.f}`)
  if (existsSync(dst)) { log.push({ 文件: j.f, 桶: j.b, 状态: '已存在跳过' }); continue }
  const b64 = readFileSync(src).toString('base64')
  const rec = { 文件: j.f, 桶: j.b, 选它的理由: j.why, 原片量: j.t, 请求尺寸: size }
  for (let a = 1; a <= 2; a += 1) {
    const t0 = Date.now()
    try {
      const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, prompt: promptFor(j.b), image: `data:image/jpeg;base64,${b64}`, size, watermark: false, response_format: 'url' }),
        signal: AbortSignal.timeout(300000),
      })
      const d = await r.json()
      rec.耗时ms = Date.now() - t0
      if (!r.ok || !d.data?.[0]?.url) { rec.状态 = `🔴 HTTP ${r.status}`; rec.错误 = String(d.error?.message || '').slice(0, 200); if (a === 2) break; continue }
      writeFileSync(dst, Buffer.from(await (await fetch(d.data[0].url)).arrayBuffer()))
      rec.状态 = '✅'; rec.出图尺寸 = d.data[0].size; spend += YUAN; break
    } catch (e) { rec.耗时ms = Date.now() - t0; rec.状态 = '🔴 超时/网络'; rec.错误 = String(e.message).slice(0, 100); if (a === 2) break }
  }
  log.push(rec)
  process.stdout.write(`\r  ${i + 1}/${jobs.length} 桶${j.b} ${j.f.slice(0, 2)} ${rec.状态}  已花 ≈${spend.toFixed(2)} 元   `)
}
console.log('')
console.log(`完成:成功 ${log.filter((r) => r.状态 === '✅').length} · 约花 ${spend.toFixed(2)} 元`)
writeFileSync(join(OUT_DIR, '_跑批日志.json'), JSON.stringify({
  生成于: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()) + ' 多伦多',
  花费元: Number(spend.toFixed(2)), 口令: { A: promptFor('A'), B: promptFor('B'), C: promptFor('C') }, 明细: log,
}, null, 2))
for (const r of log.filter((x) => x.状态 !== '✅')) console.log(`  🔴 ${r.文件} ${r.状态} ${r.错误 || ''}`)
