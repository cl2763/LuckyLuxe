/* 第七轮(12i补二)—— 15 张 × 腿A / 腿A′ = 30 次
 *
 * 🔴 口令、桶、回贴一律**沿用现成件,不重写**(12i补二 §二「其余一字不动」):
 *      腿A  = round5-prompts.mjs 的 promptR5
 *      腿A′ = round5-prompts.mjs 的 promptR5b
 *      曝光桶 = round4-prompts.mjs 的 bucketOfSkin,**代入法照第五轮**:
 *               bucketOfSkin(手框均亮, 全图均亮, 全图均亮)   ← 第二个参数本该是 p95
 *      ⚠️ 已知:这样代入后桶 C 永远触发不了(p95>240 不可能)。本批按令不改,写进回执。
 *
 * 档位来源:tools/segment/annotations/<序号>.json 的 `甲色档_人眼`。
 *   **本脚本不读 nail-tier.json、不跑机器判档**(12i补二 §一)。
 *   口令 tone 只有深/浅:人眼档「浅」→ 浅,其余三档 → 深。
 *
 * 用法:node run-round7.mjs <ark.env> <_input 目录> <round7 产出夹> <区域量json> [--dry]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promptR5, promptR5b } from './round5-prompts.mjs'
import { bucketOfSkin } from './round4-prompts.mjs'

const [, , ENV_FILE, IN_DIR, ROOT, REGION_JSON, ...FLAGS] = process.argv
const DRY = FLAGS.includes('--dry')
const PY = '/opt/anaconda3/bin/python3'
const MODEL = 'doubao-seedream-5-0-pro-260628', YUAN = 0.32
const AREA_CAP = 4624220
const 本批上限 = 12.0, 累计已花 = 58.6, 累计上限 = 72.0

const ANN = join(dirname(fileURLToPath(import.meta.url)), '..', 'segment', 'annotations')
const PICKS = ['60', '61', '42', '57', '14', '49', '53', '78', '18', '28', '71', '02', '46', '74', '38']

const R = new Map(JSON.parse(readFileSync(REGION_JSON, 'utf8')).map((x) => [x.f.slice(0, 2), x]))
const 桶名 = { A: '桶A暗', B: '桶B正常', C: '桶C偏亮' }
const dimsOf = (f) => { const o = execFileSync(PY, ['-c', `from PIL import Image;im=Image.open("${f}");print(im.width,im.height)`], { encoding: 'utf8' }).trim().split(' '); return { w: +o[0], h: +o[1] } }
const fitSize = ({ w, h }) => {
  if (w * h <= AREA_CAP) return `${w}x${h}`
  const r = Math.sqrt(AREA_CAP / (w * h))
  let nw = Math.floor(w * r / 2) * 2, nh = Math.floor(h * r / 2) * 2
  while (nw * nh > AREA_CAP) nh -= 2
  return `${nw}x${nh}`
}

/* ── 组装任务表(¥0,dry 也走这一段)── */
const JOBS = []
for (const n of PICKS) {
  const a = JSON.parse(readFileSync(join(ANN, `${n}.json`), 'utf8'))
  const 人眼档 = (a.甲色档_人眼 || '').split('(')[0].trim()
  if (!人眼档) throw new Error(`🔴 ${n} 没有 甲色档_人眼`)
  const tone = 人眼档 === '浅' ? '浅' : '深'
  const mm = R.get(n)
  if (!mm) throw new Error(`🔴 ${n} 取不到区域量`)
  const b = bucketOfSkin(mm.手框均亮, mm.全图均亮, mm.全图均亮)
  if (!b) throw new Error(`🔴 ${n} 手框均亮取不到,桶判不了 —— 不许静默当 B`)
  for (const [腿, fn, dir] of [['腿A', promptR5, 'A_四块口令'], ["腿A'", promptR5b, "A2_只去瑕疵"]]) {
    JOBS.push({ 序号: n, 文件: a.文件, 人眼档, tone, 桶: b, 腿, 目录: dir,
      产出: `${n}_模型${腿 === '腿A' ? '四块口令' : '只去瑕疵'}_${桶名[b]}_${tone}甲_${人眼档}.jpg`,
      口令: fn(b, tone) })
  }
}
console.log(`任务 ${JOBS.length} 次 ≈ ¥${(JOBS.length * YUAN).toFixed(2)}(本批上限 ¥${本批上限} · 累计 ${累计已花}+${(JOBS.length * YUAN).toFixed(2)} ≤ ${累计上限})`)
console.table(JOBS.filter((j) => j.腿 === '腿A').map((j) => ({ 序号: j.序号, 人眼档: j.人眼档, tone: j.tone, 桶: j.桶 })))
if ((JOBS.length * YUAN) > 本批上限) { console.error('🔴 预估超本批上限,停'); process.exit(3) }
if (累计已花 + JOBS.length * YUAN > 累计上限) { console.error('🔴 预估超累计上限,停'); process.exit(3) }

mkdirSync(join(ROOT, '原图'), { recursive: true })
for (const d of ['A_四块口令', 'A2_只去瑕疵']) mkdirSync(join(ROOT, d), { recursive: true })

if (DRY) {
  writeFileSync(join(ROOT, '_跑批计划_第七轮.json'), JSON.stringify({ 预估花费元: Number((JOBS.length * YUAN).toFixed(2)), 任务: JOBS }, null, 2))
  console.log('— dry run,未调用模型。计划写在 _跑批计划_第七轮.json')
  process.exit(0)
}

const KEY = (/ARK_API_KEY\s*=\s*(.+)/.exec(readFileSync(ENV_FILE, 'utf8'))?.[1] || '').trim()
if (!KEY) { console.error('🔴 钥匙读不到'); process.exit(2) }

const log = []; let spend = 0
for (const [i, j] of JOBS.entries()) {
  if (spend + YUAN > 本批上限) { console.log(`\n🔴 再跑一次就超本批上限 ¥${本批上限},停在第 ${i} 次`); break }
  const src = join(IN_DIR, j.文件)
  copyFileSync(src, join(ROOT, '原图', `${j.序号}_原图.jpg`))
  const dst = join(ROOT, j.目录, j.产出)
  const rec = { ...j, 口令长度: j.口令.length }; delete rec.口令
  if (existsSync(dst)) { rec.状态 = '已存在跳过'; log.push(rec); continue }
  const size = fitSize(dimsOf(src)); rec.请求尺寸 = size
  const b64 = readFileSync(src).toString('base64')
  for (let a = 1; a <= 2; a += 1) {
    const t0 = Date.now()
    try {
      const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, prompt: j.口令, image: `data:image/jpeg;base64,${b64}`, size, watermark: false, response_format: 'url' }),
        signal: AbortSignal.timeout(300000),
      })
      const d = await r.json()
      rec.耗时ms = Date.now() - t0
      if (!r.ok || !d.data?.[0]?.url) {
        rec.状态 = `🔴 HTTP ${r.status}`; rec.错误 = String(d.error?.message || '').slice(0, 220)
        if (/copyright/i.test(rec.错误)) { rec.状态 = '🔴 版权拒稿'; break }   /* 不计张、不重试、不补跑 */
        if (a === 2) break; continue
      }
      writeFileSync(dst, Buffer.from(await (await fetch(d.data[0].url)).arrayBuffer()))
      rec.状态 = '✅'; rec.出图尺寸 = d.data[0].size; spend += YUAN; break
    } catch (e) { rec.耗时ms = Date.now() - t0; rec.状态 = '🔴 超时/网络'; rec.错误 = String(e.message).slice(0, 120); if (a === 2) break }
  }
  log.push(rec)
  process.stdout.write(`\r  ${i + 1}/${JOBS.length} ${j.序号}${j.腿} ${rec.状态}  已花 ≈¥${spend.toFixed(2)}     `)
}
console.log('')
const ok = log.filter((r) => r.状态 === '✅').length
console.log(`完成:成功 ${ok}/${JOBS.length} · 约花 ¥${spend.toFixed(2)} · 累计 ≈¥${(累计已花 + spend).toFixed(2)}`)
writeFileSync(join(ROOT, '_跑批日志_第七轮.json'), JSON.stringify({
  生成于: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()) + ' 多伦多',
  模型: MODEL, 单价元: YUAN, 花费元: Number(spend.toFixed(2)), 累计元: Number((累计已花 + spend).toFixed(2)),
  口令样本: { 腿A_B深: promptR5('B', '深'), 腿A_B浅: promptR5('B', '浅'), "腿A'_B深": promptR5b('B', '深'), "腿A'_A深": promptR5b('A', '深') },
  明细: log,
}, null, 2))
for (const r of log.filter((x) => x.状态 !== '✅' && x.状态 !== '已存在跳过')) console.log(`  🔴 ${r.序号}${r.腿} ${r.状态} ${(r.错误 || '').slice(0, 140)}`)
