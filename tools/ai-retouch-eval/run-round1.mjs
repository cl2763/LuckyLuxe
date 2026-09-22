/* 12a 第一轮 · 41 张 × combo × 两模型(店主 11w 放行 · 11y §一.2)
 *
 * ══ 尺寸口径(12a 这一路探出来的,写死在这里)══
 * 🔴 `size` 必须传 **原图宽高按比例缩到 B 模型面积上限之内**,原因有三层,缺一层就会错:
 *   ① 不传 `size` ⇒ 出 `2048x2048` 正方形,**比例丢了**(令里「画面比例与原图一致」不成立);
 *   ② `adaptive`/`auto` 不是合法值(400,报错原文给出了合法集:`WIDTHxHEIGHT`/`1k`/`2k`/…);
 *   ③ 🔴 **B 模型有面积上限 4,624,220 px**,而归一化后 41 张**全部超标**(2268×3306 = 7.5M)。
 *      A 能吃 7.5M,B 不能 —— 两个模型要对照,**必须用同一个尺寸**,所以统一缩到 B 的上限内。
 *   ⚠️ 取整要往**小**取:我第一次算 1786×2604 = 4,650,744,超 26,524 px,当场 400。
 *
 * ══ 这条口径的代价(必须在回执里说清)══
 * 原图 2268×3306,送进去 1780×2596 ⇒ **出图比原图小 22%**。
 * 令里「清晰度不低于原图」这一条,**在 B 模型的面积上限下物理上做不到**。
 * 这不是模型修坏了,是接口档位的硬约束。
 *
 * 纪律(12a §3 + 11w §一):n=1 · watermark:false · 单张 90 秒超时 · 失败重试 1 次不补跑 ·
 * 花费实时累计,**到 30 元先停报数** · 钥匙从 env 读并 trim,不进日志。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const [, , ENV_FILE, IN_DIR, OUT_DIR] = process.argv
if (!ENV_FILE || !IN_DIR || !OUT_DIR) { console.error('用法:node run-round1.mjs <ark.env> <_input> <输出目录>'); process.exit(2) }
const KEY = (/ARK_API_KEY\s*=\s*(.+)/.exec(readFileSync(ENV_FILE, 'utf8'))?.[1] || '').trim()
if (!KEY) { console.error('🔴 钥匙读不到'); process.exit(2) }

const AREA_CAP = 4624220          // B 模型的面积上限(实测,报错原文给的数)
const PY = '/opt/anaconda3/bin/python3'
const MODELS = [
  { code: 'A', id: 'doubao-seedream-4-5-251128', yuanPerImage: 0.25 },
  { code: 'B', id: 'doubao-seedream-5-0-pro-260628', yuanPerImage: 0.32 },
]
const SPEND_PAUSE = 30            // 到这个数先停报数(11w:第一轮安全线)
const SPEND_CAP = 60              // 令里的硬上限

const PREFIX = `这是一张美甲客照的保真修图任务。输出必须与原图是同一张照片、同一构图、同一双手、同一背景,只做下面要求的调整。
【绝对不改】指甲的形状、长度、颜色、图案、贴钻位置和数量与原图完全一致;手的姿势、手指位置、手指粗细、关节位置不改;背景内容和构图不改;画面比例与原图一致。
【本次调整】`
const SUFFIX = `
【输出】清晰度不低于原图,不做风格化,不加滤镜色,不加任何文字或水印。`
/* combo = p6 + p3 + p4 + p1 + p5,按 12a §1.2 的顺序拼成一条 */
const COMBO = [
  '校正白平衡,去掉偏黄或偏青,让白色物体回到中性白,指甲颜色还原到真实颜色',
  '把整体曝光提到正常水平,阴影提亮不发灰,压噪,肤色还原正常,不改变光的方向',
  '去掉甲面上杂乱的多点反光和刺眼高光,每片甲面只保留一条自然的水光反射带,钻饰和亮片轻微提亮增加通透感,但形状和位置不变',
  '手部肤色调成干净的冷白皮,轻微提亮,降低橙红饱和度,保留皮肤真实纹理和指节褶皱,只减淡不抹平,清理甲缘死皮和指缝暗角,不能出现塑料感和假白',
  '背景只做轻微虚化和柔和的明暗渐变增加空间感,不换背景、不加东西、不去东西,手和指甲保持全清晰',
].join(';') + '。'
const PROMPT = PREFIX + COMBO + SUFFIX

const dimsOf = (f) => {
  const o = execFileSync(PY, ['-c', `from PIL import Image;im=Image.open("${f}");print(im.width,im.height)`], { encoding: 'utf8' }).trim().split(' ')
  return { w: Number(o[0]), h: Number(o[1]) }
}
/* 🔴 往小取,并保持偶数 —— 取大一点点就会 400(实测差 26,524 px 就被拒) */
const fitSize = ({ w, h }) => {
  if (w * h <= AREA_CAP) return `${w}x${h}`
  const r = Math.sqrt(AREA_CAP / (w * h))
  let nw = Math.floor(w * r / 2) * 2
  let nh = Math.floor(h * r / 2) * 2
  while (nw * nh > AREA_CAP) nh -= 2
  return `${nw}x${nh}`
}

mkdirSync(OUT_DIR, { recursive: true })
const files = readdirSync(IN_DIR).filter((f) => f.endsWith('.jpg')).sort()
console.log(`第一轮:${files.length} 张 × combo × ${MODELS.length} 模型 = ${files.length * MODELS.length} 次调用`)

const log = []
let spend = 0
let stopped = false
outer:
for (const [i, f] of files.entries()) {
  const src = join(IN_DIR, f)
  const d0 = dimsOf(src)
  const size = fitSize(d0)
  const b64 = readFileSync(src).toString('base64')
  for (const m of MODELS) {
    if (spend >= SPEND_PAUSE) { stopped = true; break outer }
    const dst = join(OUT_DIR, `${m.code}_${f}`)
    if (existsSync(dst)) { log.push({ 文件: f, 模型: m.code, 状态: '已存在跳过' }); continue }
    let rec = { 文件: f, 模型: m.code, 输入尺寸: `${d0.w}x${d0.h}`, 请求尺寸: size }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const t0 = Date.now()
      try {
        const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
          body: JSON.stringify({ model: m.id, prompt: PROMPT, image: `data:image/jpeg;base64,${b64}`, size, watermark: false, response_format: 'url' }),
          signal: AbortSignal.timeout(90000),
        })
        const d = await r.json()
        rec.耗时ms = Date.now() - t0
        if (!r.ok || !d.data?.[0]?.url) {
          /* 🔴 报错原文留下,但**永远不打 header**(钥匙在 header 里) */
          rec.状态 = `🔴 HTTP ${r.status}`
          rec.错误 = String(d.error?.message || '').slice(0, 160)
          if (attempt === 2) break
          continue
        }
        writeFileSync(dst, Buffer.from(await (await fetch(d.data[0].url)).arrayBuffer()))
        rec.状态 = '✅'
        rec.出图尺寸 = d.data[0].size
        rec.tokens = d.usage?.output_tokens
        spend += m.yuanPerImage
        break
      } catch (e) {
        rec.耗时ms = Date.now() - t0
        rec.状态 = '🔴 超时/网络'
        rec.错误 = String(e.message).slice(0, 100)
        if (attempt === 2) break
      }
    }
    log.push(rec)
    process.stdout.write(`\r  ${i + 1}/${files.length} ${m.code} ${rec.状态}  已花 ≈${spend.toFixed(2)} 元   `)
  }
}
console.log('')
const ok = log.filter((r) => r.状态 === '✅')
const bad = log.filter((r) => String(r.状态).startsWith('🔴'))
console.log(`完成:成功 ${ok.length} · 失败 ${bad.length} · 约花 ${spend.toFixed(2)} 元${stopped ? '  🔴 到 30 元安全线,已停' : ''}`)
writeFileSync(join(OUT_DIR, '_跑批日志.json'), JSON.stringify({ 生成于: new Date().toISOString(), 花费元: Number(spend.toFixed(2)), 停在安全线: stopped, 明细: log }, null, 2))
if (bad.length) { console.log('  失败明细:'); for (const b of bad.slice(0, 8)) console.log(`    ${b.文件} ${b.模型} ${b.状态} ${b.错误 || ''}`) }
