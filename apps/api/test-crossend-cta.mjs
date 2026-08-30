/* 死口清剿常驻扫描(店主 v2 指令·三,08-30 立;08-30 二批收编为常驻判据 —— C4)。

   店主原话:「我要的是这个系统两边是一模一样的……除了那三个投票投出来的例外,
   我不要再看到任何一个『请去另一端操作』的字样。」

   扫描面=**运行时表面**(J3/J6 族:不写死文件清单):
   web = admin.html/index.html script manifest 展开 + 两张 html 本体;
   mini = miniprogram 全部 .js/.wxml。剥注释后匹配指路句式。
   白名单=死口清剿总表_2026-08-30 的豁免行,逐条写理由、钉条数;新死口自动红。

   ⚠️ standalone:CI_SUITES="crossend-cta" bash apps/api/run-all-tests.sh */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

const walk = (d, re, out = []) => {
  for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    const p = `${d}/${e.name}`
    if (e.isDirectory()) { if (!['node_modules', '.git'].includes(e.name)) walk(p, re, out) }
    else if (re.test(e.name)) out.push(p)
  }
  return out
}

/* 扫描面:运行时决定(html 真加载什么就扫什么),配条数下限防缩水(判据的覆盖面本身要有判据) */
const webFiles = new Set(['apps/web/admin.html', 'apps/web/index.html'])
for (const h of ['apps/web/admin.html', 'apps/web/index.html']) {
  const src = readFileSync(join(ROOT, h), 'utf8')
  for (const m of src.matchAll(/<script src="\/web\/([\w.-]+\.js)/g)) webFiles.add(`apps/web/${m[1]}`)
}
webFiles.add('apps/web/admin.js'); webFiles.add('apps/web/customer.js')
const miniFiles = walk('miniprogram', /\.(js|wxml)$/)
check('扫描面下限:web ≥ 10 个文件(manifest 缩水立红)', webFiles.size >= 10, String(webFiles.size))
check('扫描面下限:mini ≥ 140 个文件(66 页 × js/wxml + 组件;缩水立红)', miniFiles.length >= 140, String(miniFiles.length))

const PAT = /请?(在|去|走|用)(小程序|网页版?)(上|里|中)?(操作|开单|办|设置|完成|处理|排单|充值|确认|兑换|写|补)|先用小程序|网页版登记待排|在小程序(里|中|端|或|「| )|需要您?在小程序|员工小程序端|小程序客户库/
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const stripHtml = (t) => t.replace(/<!--[\s\S]*?-->/g, '')

/* 白名单(=死口清剿总表 08-30 豁免行,逐条理由;marker 必须仍在该文件,条数钉死) */
const ALLOW = [
  { file: 'apps/web/admin.js', marker: '打卡在员工小程序端', max: 1,
    reason: '硬件能力边界:打卡/设打卡WiFi 要真机读店内 WiFi,浏览器拿不到 BSSID(判定表既有裁定);本页能修正/补卡' },
  { file: 'apps/web/admin.js', marker: '名单动作与阈值微调在小程序客户库', max: 1,
    reason: '店主 08-30 已裁:接回网页、排进拉平批;句子说的是现状,拉平批落地时随功能删(到期不删=这条红)' },
  { file: 'apps/web/admin.html', marker: '顾客在小程序「积分商城」兑换', max: 1,
    reason: '受众=顾客在顾客端的行为(积分商城=顾客端功能),非指路商家换端;本页即商家配奖品本端入口' },
  { file: 'apps/web/ai-desk.js', marker: '请在小程序中确认时间并支付定金', max: 1,
    reason: 'AI 客服对顾客话术(顾客确认+付定金产品位=顾客小程序);matrix 66 红线,不动' },
  { file: 'apps/web/ai-desk.js', marker: '在小程序里确认时间并支付', max: 1,
    reason: '同上(AI 回复模板)' },
  /* 提醒/画像两句 08-30 已改成「小程序或网页『我的客人』」——两端都点得到,不算指路;
     但句里仍含「小程序」字样会被 PAT 撞上,按「两端并列句」豁免 */
  { file: 'apps/web/admin.js', marker: '记得在小程序或网页「我的客人」里补一下', max: 1, reason: '两端并列句(两端都有功能),非死口' }
]

const rows = []
for (const f of [...webFiles, ...miniFiles]) {
  let src
  try { src = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
  const cleaned = f.endsWith('.js') ? stripJs(src) : stripHtml(src)
  cleaned.split('\n').forEach((line, i) => {
    if (PAT.test(line)) rows.push({ f, l: i + 1, full: line, t: line.trim().slice(0, 100) })
  })
}

const outside = []
const used = new Map()
for (const r of rows) {
  /* 匹配用整行(第一版拿 100 字截断去比,长句后半的标记比不上=判据自伤,当场咬出) */
  const a = ALLOW.find((x) => x.file === r.f && r.full.includes(x.marker) && readFileSync(join(ROOT, x.file), 'utf8').includes(x.marker))
  if (!a) { outside.push(`${r.f}:${r.l} ${r.t}`); continue }
  used.set(a.marker, (used.get(a.marker) || 0) + 1)
}
for (const a of ALLOW) {
  const n = used.get(a.marker) || 0
  if (n > a.max) outside.push(`白名单超钉数 ${a.file}「${a.marker.slice(0, 14)}…」${n}>${a.max}`)
}
check('🔴 全仓死口零残留:运行时表面每条指路句必须落白名单(豁免各有理由;新死口自动红)',
  outside.length === 0, outside.slice(0, 6).join(' | '))
check('白名单条目全部仍在用(豁免句删掉后要同步清白名单,不许留僵尸条目)',
  ALLOW.every((a) => (used.get(a.marker) || 0) >= 1),
  JSON.stringify([...used.entries()]))

console.log(`\n✅ test-crossend-cta 通过 ${checks} 项(命中 ${rows.length} 条,白名单 ${ALLOW.length} 条)`)
