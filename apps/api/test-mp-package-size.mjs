/* 🔴 D208:小程序主包体积棘轮(店主 10i 立,夜16 §二 验收③)
 *
 * ══ 案底 ══
 * 2026-09-21 店主真机调试撞到:`source size 2199KB exceed max limit 2MB`。
 * **主包超限 ⇒ 上传也被同一道闸拦下 ⇒ 提交不了审核 ⇒ 发布不了。**
 * 而它为什么到那天才被发现:**我们一直在模拟器和自动化里验,从来没走过「打包上传」那一步。**
 * 决定能不能发布的是**微信那台打包机** —— 和 CI 那件一模一样(J-95:绿要说清在哪台机器上量的)。
 *
 * ══ 🔴 这把尺子量的是什么,必须说清(J-95 / J-108)══
 * 微信说的 `source size` 是**编译后**的数,只有它那台打包机给得出来。
 * 这里量的是**主包源文件字节和** —— 一个**代理量**,不是那个数本身。
 *   · 它能falsify 的那件事:**有人往主包里塞了大东西**(这正是会再胖回去的那条路);
 *   · 它给不出的:编译后的确切 KB。**所以下面把真实那一次的数、时刻、机器一起钉在代码里。**
 * 两个数一起看才算数:代理量守日常,真数靠上传那一闸。
 *
 * ══ 上一次真实测量(cli upload,不是估的)══
 *   2026-09-22 · 微信开发者工具 cli upload · AppID wx247cd8ad9907430d
 *   TOTAL 2,260,466 B · **main 1,294,665 B(1,264 KB)** · /pages/merchant/ 965,801 B
 *   ✔ upload 通过 —— 开发版,未提审、未发布。
 *   同一时刻的代理量(本文件这把尺子)= 见 REAL.proxyBytes,两者比值记在下面。
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const MP = join(ROOT, 'miniprogram')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`); fails.push(name) }
}

/* 分包根从 app.json 现读 —— 不写死,以后加分包这把尺子自己跟着走 */
const app = JSON.parse(readFileSync(join(MP, 'app.json'), 'utf8'))
const subRoots = (app.subPackages || app.subpackages || []).map((s) => String(s.root).replace(/\/+$/, ''))

const SKIP_FILE = new Set(['.DS_Store'])
function bytesUnder(base, excludeRoots = []) {
  let total = 0
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const r = rel ? `${rel}/${name}` : name
      if (name === 'node_modules' || name === '.git') continue
      if (excludeRoots.some((x) => r === x || r.startsWith(`${x}/`))) continue
      const st = statSync(p)
      if (st.isDirectory()) walk(p, r)
      else if (!SKIP_FILE.has(name)) total += st.size
    }
  }
  walk(base, '')
  return total
}

const mainBytes = bytesUnder(MP, subRoots)
const MAIN_CAP = 1_250_000        /* 🔴 只许降。2026-09-22 实测 1,203,637 B,留 ~46KB 波动余量后钉在这儿 */
const REAL = { at: '2026-09-22', by: 'cli upload · wx247cd8ad9907430d', mainBytes: 1_294_665, totalBytes: 2_260_466 }
const GATE = 2048 * 1024
const WARN = 1900 * 1024

check(`① 🔴 主包源字节 ${(mainBytes / 1024).toFixed(1)} KB ≤ 棘轮 ${(MAIN_CAP / 1024).toFixed(0)} KB(**只许降**;代理量,不是微信那个 source size)`,
  mainBytes <= MAIN_CAP, `${mainBytes} > ${MAIN_CAP}`)
check(`②a 上一次**真实**打包数钉在代码里(${REAL.at} · ${REAL.by}):main ${(REAL.mainBytes / 1024).toFixed(0)} KB`,
  REAL.mainBytes > 0 && REAL.at && REAL.by.includes('upload'))
check(`②b 🔴 那个真数 ${(REAL.mainBytes / 1024).toFixed(0)} KB ≤ 黄线 ${WARN / 1024} KB ≤ 闸 ${GATE / 1024} KB`,
  REAL.mainBytes <= WARN, `${REAL.mainBytes} > ${WARN}`)
check(`②c 代理量与真数的比值 ${(REAL.mainBytes / mainBytes).toFixed(3)} 在 1.0–1.3 之间(离谱说明尺子量错了对象)`,
  REAL.mainBytes / mainBytes > 1.0 && REAL.mainBytes / mainBytes < 1.3,
  `真 ${REAL.mainBytes} / 代理 ${mainBytes}`)

/* ③ 分包真的配上了,而且顾客主路一页都没被挪走 */
check(`③a 🔴 subPackages 配了 ${subRoots.length} 个(0 个 = 那 151KB 额度一点没用上)`,
  subRoots.length >= 1, JSON.stringify(subRoots))
const CUSTOMER_MAIN = ['entry', 'home', 'shop-select', 'services', 'service-detail', 'booking', 'booking-done',
  'cart', 'checkout', 'orders', 'order-detail', 'me', 'card-pack', 'stored-value', 'sign', 'bind', 'store-location']
const mainPages = new Set(app.pages || [])
const strayed = CUSTOMER_MAIN.filter((p) => !mainPages.has(`pages/${p}/index`))
check(`③b 🔴 顾客主路 ${CUSTOMER_MAIN.length} 页**一页都不许进分包**(夜16 §二(乙):顾客第一次用或每次都用的那条路,分包会让它多等一下)`,
  strayed.length === 0, `跑掉了:${strayed.join(', ')}`)
check('③c 🔴 tabBar 四页必须在主包(在分包里小程序根本起不来)',
  (app.tabBar?.list || []).every((x) => mainPages.has(x.pagePath)),
  (app.tabBar?.list || []).map((x) => x.pagePath).join(' '))
check('③d 入口页在主包', mainPages.has(app.entryPagePath), String(app.entryPagePath))

/* ④ 两面验(J-91):塞个大文件进主包必须红,拿掉必须回绿 */
const probeDir = join(MP, 'assets', 'images')
const probe = join(probeDir, '__size_probe__.bin')
let redWithProbe = false
let greenAfter = false
try {
  writeFileSync(probe, Buffer.alloc(MAIN_CAP)) // 一个必定顶破棘轮的文件
  redWithProbe = bytesUnder(MP, subRoots) > MAIN_CAP
} finally {
  if (existsSync(probe)) rmSync(probe)
  greenAfter = bytesUnder(MP, subRoots) <= MAIN_CAP
}
check('④a 🔴 造病:往主包塞一个大文件 → ① 必须红', redWithProbe)
check('④b 🔴 拿掉之后必须回绿(不回绿说明造病没收干净,判据本身会变得不幂等)', greenAfter)
check('④c 🔴 反向守:同样大小的文件塞进**分包**里,① 不许红(否则这把尺子分不清主包和分包)',
  (() => {
    if (!subRoots.length) return false
    const d = join(MP, subRoots[0])
    const p = join(d, '__size_probe__.bin')
    try { writeFileSync(p, Buffer.alloc(MAIN_CAP)); return bytesUnder(MP, subRoots) <= MAIN_CAP }
    finally { if (existsSync(p)) rmSync(p) }
  })())
check('④d 收尾自证:造病文件一个都没留下',
  !existsSync(probe) && subRoots.every((r) => !existsSync(join(MP, r, '__size_probe__.bin'))))

console.log(`\n[D208 主包体积] 代理量 ${(mainBytes / 1024).toFixed(1)} KB / 棘轮 ${(MAIN_CAP / 1024).toFixed(0)} KB · `
  + `上次真实打包 ${(REAL.mainBytes / 1024).toFixed(0)} KB(${REAL.at} ${REAL.by})· 黄线 ${WARN / 1024} · 闸 ${GATE / 1024}`)
if (fails.length) { console.error(`\n❌ test-mp-package-size ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-mp-package-size 通过 ${checks} 项`)
