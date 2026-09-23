/* 第五轮 腿A · 四块口令 · 角例八张(12e §二 腿A + §三)
 * 🔴 §六 命名:文件名 = 序号_处理链_参数,全人话,不许代号。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { promptR5b as promptR5 } from './round5-prompts.mjs'
import { bucketOfSkin } from './round4-prompts.mjs'

const [, , ENV_FILE, IN_DIR, ROOT, REGION_JSON] = process.argv
const KEY = (/ARK_API_KEY\s*=\s*(.+)/.exec(readFileSync(ENV_FILE, 'utf8'))?.[1] || '').trim()
if (!KEY) { console.error('🔴 钥匙读不到'); process.exit(2) }
const AREA_CAP = 4624220, PY = '/opt/anaconda3/bin/python3'
const MODEL = 'doubao-seedream-5-0-pro-260628', YUAN = 0.32

/* §三 角例八张 + 甲面色调(Code 看图判,理由随附) */
const CASES = [
  ['44_IMG_3d钻.jpg', '浅', '浅甲+立体钻+蕾丝,细节最狠'],
  ['42_IMG_197.jpg', '浅', '新素材;裸甲≈肤色,掩膜易误判;唐老鸭 IP'],
  ['43_IMG_199.jpg', '浅', '新素材;裸粉甲;蜡笔小新拼豆 IP'],
  ['02_IMG_0555.jpg', '深', '黑甲、皮肤亮;P1 曾把皮肤烧到 13.57%'],
  ['18_IMG_4239.jpg', '深', '最暗片;唯一能干净归因的一张'],
  ['23_IMG_4665.jpg', '浅', '缎面碎高光,死白尺子的离群件'],
  ['14_IMG_34282.jpg', '深', '红甲,色度≈皮肤,掩膜必失败 → 看口令能不能救'],
  ['28_IMG_49512.jpg', '深', '墨绿甲,两轮被改成天蓝;验色温句缩宾语后还守不守'],
]
const 桶名 = { A: '桶A暗', B: '桶B正常', C: '桶C偏亮' }
const 甲名 = { 深: '深甲', 浅: '浅甲' }

const dimsOf = (f) => { const o = execFileSync(PY, ['-c', `from PIL import Image;im=Image.open("${f}");print(im.width,im.height)`], { encoding: 'utf8' }).trim().split(' '); return { w: +o[0], h: +o[1] } }
const fitSize = ({ w, h }) => {
  if (w * h <= AREA_CAP) return `${w}x${h}`
  const r = Math.sqrt(AREA_CAP / (w * h))
  let nw = Math.floor(w * r / 2) * 2, nh = Math.floor(h * r / 2) * 2
  while (nw * nh > AREA_CAP) nh -= 2
  return `${nw}x${nh}`
}
const R = new Map(JSON.parse(readFileSync(REGION_JSON, 'utf8')).map((x) => [x.f, x]))
const DIR_A = join(ROOT, 'A2_只去瑕疵'), DIR_O = join(ROOT, '原图')
mkdirSync(DIR_A, { recursive: true }); mkdirSync(DIR_O, { recursive: true })

console.log(`第五轮 腿A′(只留去瑕疵):${CASES.length} 次 ≈ ¥${(CASES.length * YUAN).toFixed(2)}`)
const log = []
let spend = 0
for (const [i, [f, tone, why]] of CASES.entries()) {
  const mm = R.get(f)
  const b = bucketOfSkin(mm.手框均亮, mm.全图均亮, mm.全图均亮)
  const num = f.slice(0, 2)
  copyFileSync(join(IN_DIR, f), join(DIR_O, `${num}_原图.jpg`))
  const 人话 = `${num}_模型四块口令_只去瑕疵_${桶名[b]}_${甲名[tone]}.jpg`
  const dst = join(DIR_A, 人话)
  if (existsSync(dst)) { log.push({ 序号: num, 文件: f, 桶: b, 甲面: tone, 产出: 人话, 状态: '已存在跳过' }); continue }
  const size = fitSize(dimsOf(join(IN_DIR, f)))
  const rec = { 序号: num, 文件: f, 桶: b, 甲面: tone, 选它的理由: why, 手框均亮: mm.手框均亮, 请求尺寸: size, 产出: 人话 }
  const b64 = readFileSync(join(IN_DIR, f)).toString('base64')
  for (let a = 1; a <= 2; a += 1) {
    const t0 = Date.now()
    try {
      const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, prompt: promptR5(b, tone), image: `data:image/jpeg;base64,${b64}`, size, watermark: false, response_format: 'url' }),
        signal: AbortSignal.timeout(300000),
      })
      const d = await r.json()
      rec.耗时ms = Date.now() - t0
      if (!r.ok || !d.data?.[0]?.url) {
        rec.状态 = `🔴 HTTP ${r.status}`; rec.错误 = String(d.error?.message || '').slice(0, 220)
        if (/copyright/i.test(rec.错误)) { rec.状态 = '🔴 版权拒稿'; break }   /* 不计张、不重试 */
        if (a === 2) break; continue
      }
      writeFileSync(dst, Buffer.from(await (await fetch(d.data[0].url)).arrayBuffer()))
      rec.状态 = '✅'; rec.出图尺寸 = d.data[0].size; spend += YUAN; break
    } catch (e) { rec.耗时ms = Date.now() - t0; rec.状态 = '🔴 超时/网络'; rec.错误 = String(e.message).slice(0, 100); if (a === 2) break }
  }
  log.push(rec)
  process.stdout.write(`\r  ${i + 1}/${CASES.length} ${num} ${b}×${tone} ${rec.状态}  已花 ≈${spend.toFixed(2)}   `)
}
console.log('')
console.log(`完成:成功 ${log.filter((r) => r.状态 === '✅').length}/${CASES.length} · 约花 ${spend.toFixed(2)} 元`)
writeFileSync(join(ROOT, '_跑批日志_腿A2.json'), JSON.stringify({
  生成于: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()) + ' 多伦多',
  花费元: Number(spend.toFixed(2)),
  口令: Object.fromEntries([['A深', promptR5('A','深')], ['A浅', promptR5('A','浅')], ['B深', promptR5('B','深')], ['B浅', promptR5('B','浅')]]),
  明细: log,
}, null, 2))
for (const r of log.filter((x) => x.状态 !== '✅')) console.log(`  🔴 ${r.序号} ${r.状态} ${(r.错误 || '').slice(0, 140)}`)
