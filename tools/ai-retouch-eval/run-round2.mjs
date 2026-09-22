/* 12a 第二轮 · 只跑 B · 口令按「相机质感」重写(小批 11z)
 *
 * ══ 与第一轮的差别,全部来自 11z §二 ══
 * ① 固定前缀「绝对不改」清单**原样保留**,**追加一句**解 p1/p6 与「绝对不改甲色」打架:
 *    「肤色、白平衡、亮度的调整只作用于皮肤与背景,指甲区域的颜色、明暗、反光一律保持原样。」
 * ② {PRESET} 换成一条「相机质感」口令(仍是一条,一次调用一次计费)
 * ③ 删掉三句:p1「冷白皮」· p4「只保留一条水光反射带」· p3「阴影提亮不发灰」
 *    —— 第一轮归因查明:这三句正是 ③ 肤色 100%、金变银、B 凭空加高光的来源。
 * ④ **只跑 B**(A 第一轮 ①b 14/41,已淘汰)
 *
 * ══ size:沿用第一轮的按张缩放,不写死 ══
 * 🔴 11z §三 写「size 传 1780×2596」。核查第一轮日志:41 张里 **38 张竖图**本来就是这个尺寸,
 *    另 **3 张是横图**(2740×1686)。写死会把那 3 张压成竖的,**违反「画面比例与原图一致」**。
 *    所以这里**仍按每张自己的比例缩进 B 的面积上限**,与第一轮完全一致 —— 38 张结果就是 1780×2596。
 *    这是可推定的笔误,不是口径变更;已在回执里写明。
 *
 * 纪律:n=1 · watermark:false · 90 秒超时 · 失败重试 1 次不补跑 · 花费实时累计 ·
 *       钥匙从 env 读并 trim,不进日志。累计上限 60 元(12a 已花 ≈31,本轮 ≈16)。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const [, , ENV_FILE, IN_DIR, OUT_DIR, MODE] = process.argv
if (!ENV_FILE || !IN_DIR || !OUT_DIR) { console.error('用法:node run-round2.mjs <ark.env> <_input> <输出目录> [full|l5]'); process.exit(2) }
const KEY = (/ARK_API_KEY\s*=\s*(.+)/.exec(readFileSync(ENV_FILE, 'utf8'))?.[1] || '').trim()
if (!KEY) { console.error('🔴 钥匙读不到'); process.exit(2) }

const AREA_CAP = 4624220
const PY = '/opt/anaconda3/bin/python3'
const B = { code: 'B', id: 'doubao-seedream-5-0-pro-260628', yuanPerImage: 0.32 }
const SPEND_CAP_THIS_RUN = 25   /* 本轮自己的安全线:41×0.32=13.1,L5 9×0.32=2.9,合计 ≈16 */

/* 口令在独立模块里,**为的是自检能真 import** —— 见 round2-prompt.mjs 顶部那条教训 */
import { PROMPT } from './round2-prompt.mjs'

const dimsOf = (f) => {
  const o = execFileSync(PY, ['-c', `from PIL import Image;im=Image.open("${f}");print(im.width,im.height)`], { encoding: 'utf8' }).trim().split(' ')
  return { w: Number(o[0]), h: Number(o[1]) }
}
const fitSize = ({ w, h }) => {
  if (w * h <= AREA_CAP) return `${w}x${h}`
  const r = Math.sqrt(AREA_CAP / (w * h))
  let nw = Math.floor(w * r / 2) * 2, nh = Math.floor(h * r / 2) * 2
  while (nw * nh > AREA_CAP) nh -= 2
  return `${nw}x${nh}`
}

/* L5 稳定性三张(11z §三),用第一轮的客观亮度挑的,不是拍脑袋:
   02 黑短甲两手交叠(令点名)· 18 亮度 32 最暗的黑甲(对标参考03)· 35 亮度 120 曝光正常 */
const L5_PICKS = ['02_IMG_0555.jpg', '18_IMG_4239.jpg', '35_IMG_9350.jpg']
const L5_RUNS = 3

mkdirSync(OUT_DIR, { recursive: true })
const all = readdirSync(IN_DIR).filter((f) => f.endsWith('.jpg')).sort()
const jobs = []
if (MODE !== 'l5') for (const f of all) jobs.push({ f, tag: '' })
if (MODE !== 'full') for (const f of L5_PICKS) for (let k = 1; k <= L5_RUNS; k += 1) jobs.push({ f, tag: `_L5r${k}` })
console.log(`第二轮(只跑 B):${jobs.length} 次调用  预计 ≈${(jobs.length * B.yuanPerImage).toFixed(2)} 元`)

const log = []
let spend = 0, stopped = false
for (const [i, job] of jobs.entries()) {
  if (spend >= SPEND_CAP_THIS_RUN) { stopped = true; break }
  const src = join(IN_DIR, job.f)
  const d0 = dimsOf(src)
  const size = fitSize(d0)
  const dst = join(OUT_DIR, `B2${job.tag}_${job.f}`)
  if (existsSync(dst)) { log.push({ 文件: job.f, 轮次: job.tag || '主', 状态: '已存在跳过' }); continue }
  const b64 = readFileSync(src).toString('base64')
  const rec = { 文件: job.f, 轮次: job.tag || '主', 输入尺寸: `${d0.w}x${d0.h}`, 请求尺寸: size }
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const t0 = Date.now()
    try {
      const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: B.id, prompt: PROMPT, image: `data:image/jpeg;base64,${b64}`, size, watermark: false, response_format: 'url' }),
        signal: AbortSignal.timeout(90000),
      })
      const d = await r.json()
      rec.耗时ms = Date.now() - t0
      if (!r.ok || !d.data?.[0]?.url) {
        rec.状态 = `🔴 HTTP ${r.status}`
        rec.错误 = String(d.error?.message || '').slice(0, 200)
        if (attempt === 2) break
        continue
      }
      writeFileSync(dst, Buffer.from(await (await fetch(d.data[0].url)).arrayBuffer()))
      rec.状态 = '✅'; rec.出图尺寸 = d.data[0].size; rec.tokens = d.usage?.output_tokens
      spend += B.yuanPerImage
      break
    } catch (e) {
      rec.耗时ms = Date.now() - t0
      rec.状态 = '🔴 超时/网络'; rec.错误 = String(e.message).slice(0, 100)
      if (attempt === 2) break
    }
  }
  log.push(rec)
  process.stdout.write(`\r  ${i + 1}/${jobs.length} ${job.f.slice(0, 2)}${job.tag} ${rec.状态}  已花 ≈${spend.toFixed(2)} 元   `)
}
console.log('')
const ok = log.filter((r) => r.状态 === '✅')
const bad = log.filter((r) => String(r.状态).startsWith('🔴'))
console.log(`完成:成功 ${ok.length} · 失败 ${bad.length} · 约花 ${spend.toFixed(2)} 元${stopped ? '  🔴 到本轮安全线,已停' : ''}`)
writeFileSync(join(OUT_DIR, '_跑批日志.json'), JSON.stringify({
  生成于: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()) + ' 多伦多',
  花费元: Number(spend.toFixed(2)), 停在安全线: stopped, 口令: PROMPT, 明细: log,
}, null, 2))
if (bad.length) { console.log('  失败明细:'); for (const b of bad) console.log(`    ${b.文件}${b.轮次 === '主' ? '' : b.轮次} ${b.状态} ${b.错误 || ''}`) }
