#!/usr/bin/env node
/* L5 重复稳定律 · 网页三档外观**连续 5 次真点**(店主 05w §八 收尾那一项)
 *
 * 立件:夜班令6 段 3 把三档做出来了,但 L5 那条自评写的是「各真点过一次,**没做满 5 次**」。
 * L5 的原话是:交互类(点击/输入/签字/提交)必须**连续 5 次进出页面**都成功;
 * 出现 1 次异常 = 缺陷,不许写「偶发」。这把刀就是来补那 4 次的。
 *
 * ══ 每一轮验四样(缺一样都可能「看着换了其实没换」)══
 *   ① 真点:`element.click()`(不是改 localStorage 再刷新 —— 那绕开了按钮本身)
 *   ② 存住:`localStorage['ll-admin-theme']` == 这一档
 *   ③ 挂上:`documentElement.dataset.theme` == 这一档(system 档**不挂属性**)
 *   ④ 真变:`getComputedStyle(body).backgroundColor` 跟着令牌走,而且**浅深两档不相等**
 * 外加**进出页面**:每一轮都重新 `Page.navigate` 回首页,验「刷新之后还是那一档」(存的是偏好,不是这一次)。
 *
 * 用法:SHOT_BASE=http://127.0.0.1:4310 SHOT_TOKEN=<开发主钥匙> node tools/theme-l5-proof.mjs
 */
import { spawn } from 'node:child_process'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'SHOT_BASE', value: process.env.SHOT_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const TOKEN = requireTarget({ envName: 'SHOT_TOKEN', value: process.env.SHOT_TOKEN, hint: '(开发主钥匙,启动日志里那一串;不写进代码)' })
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9334)
const ROUNDS = Number(process.env.L5_ROUNDS || 5)

const profile = `/private/tmp/ll-l5-profile-${process.pid}`
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function cdpTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  throw new Error('Chrome 调试端口没起来 —— 装没装 Chrome?SHOT_CHROME 路径对不对?')
}
const ws = new WebSocket(await cdpTarget())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(`页内报错:${r.result.exceptionDetails.text}`)
  return r.result?.result?.value
}
await send('Page.enable'); await send('Runtime.enable')

/* 🔴 「量到颜色了」不许把**透明**算进去:`rgba(0, 0, 0, 0)` 也是 /^rgb/ 开头的,
   我头一版就是这么让五轮空值全绿的。要的是**真有底色**。 */
const REAL_COLOR = /^rgb\((?!0, 0, 0, 0\))|^rgba\((?!0, 0, 0, 0\))/

let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

async function openHome() {
  await send('Page.navigate', { url: `${BASE}/admin` })   /* 路由是 /admin,不是 /admin.html(现测 404) */
  await sleep(1500)
  await ev(`(() => { const el = document.querySelector('#tokenInput'); if (!el) return 0; el.value = ${JSON.stringify(TOKEN)};
    const b = Array.from(document.querySelectorAll('button')).find((x) => /刷新|Refresh/.test(x.textContent)); if (b) b.click(); return 1 })()`)
  /* 等首页出态:头一版等 12 秒,首轮偶尔差一点点就报「没出态」——
     而后面每一轮都好好的,那就是**等得不够**,不是页面坏了。等到 30 秒,并且等到
     `data-dh-state` 不再是 loading(出态 ≠ 挂上那个属性)。 */
  for (let i = 0; i < 60; i += 1) {
    const st = await ev(`(document.querySelector('#dashboardCharts [data-dh-state]') || {}).dataset?.dhState || ''`)
    if (st && st !== 'loading') break
    await sleep(500)
  }
  await sleep(800)
}

/* 外观那一格在**「通用设置」这一页**里(侧栏 `#sidebarGeneralSettings` → `#gsThemeBody`)。
   头一版我在首页上瞎找 `summary` 就点,`[data-gs-theme]` 一个都没有 —— 判据没找到按钮却
   一路往下跑,最后 ⑤ 因为**五轮全是 undefined** 而「全等」通过了:
   **零命中判据在空气上绿**,正是判据律点名的那种废判据。所以现在:进对页 + 前置自证。 */
async function openAppearance() {
  await ev(`(() => { const b = document.querySelector('#sidebarGeneralSettings'); if (b) b.click(); return 1 })()`)
  await sleep(900)
  await ev(`(() => { const d = document.querySelector('#gsThemeBody')?.closest('details'); if (d) d.open = true; return 1 })()`)
  await sleep(300)
  return ev(`document.querySelectorAll('[data-gs-theme]').length`)
}

const clickTheme = (mode) => ev(`(() => {
  const b = document.querySelector('[data-gs-theme="${mode}"]'); if (!b) return { 点到: false }
  b.click()
  return { 点到: true,
    存的: localStorage.getItem('ll-admin-theme'),
    挂的: document.documentElement.dataset.theme || '(没挂 = 跟随系统)',
    /* 取样点现测定的:整屏的底就画在 body 上(rgb(25,27,25) = 深色档的 --paper)。
       我头一版按 .app/#app/main 找,main 存在但是透明,于是量到 rgba(0,0,0,0) 五轮全一样,
       而「五轮一致」那条居然还绿了 —— 取样取错地方 + 判据只看形状不看内容,两层废判据叠一起。
       ⚠️ 这段注释里一个反引号都不许有:它整个住在模板串里,反引号会当场把串截断。 */
    底色: getComputedStyle(document.body).backgroundColor,
    卡色: (() => { const c = document.querySelector('.card, .panel, section')
      return c ? getComputedStyle(c).backgroundColor : '' })() }
})()`)

await openHome()
/* 🔴 前置该验的是**这把刀要用的东西**,不是随手拿一个别的信号。
   头一版拿「首页大屏出态」当前置 —— 它跟外观三档毫无关系,而且这台无头浏览器上
   首屏偶尔停在别的页,于是判据红在一件与被测无关的事情上(这也是一种废判据:
   红了不代表被测坏了)。改成验**登进来了 + 侧栏那颗「通用设置」在**。 */
check('⓪ 造景:登进来了,侧栏「通用设置」那颗在(外观三档就住在它里面)',
  Boolean(await ev(`Boolean(document.querySelector('#sidebarGeneralSettings'))`)))
const hasBtns = await openAppearance()
check('⓪b 造景:「通用设置 → 外观」**三个**按钮都在 DOM 上(找不到就别往下跑 —— 零命中会在空气上绿)',
  hasBtns === 3, `找到 ${hasBtns} 个`)
if (hasBtns !== 3) { console.error('🔴 前置不成立,后面那些轮次一条都没验成 —— 直接红,不装跑完了'); ws.close(); chrome.kill(); process.exit(1) }

const seen = []
for (let round = 1; round <= ROUNDS; round += 1) {
  /* 每一轮都**重新进页面**(L5 原话:连续 5 次**进出页面**都成功) */
  if (round > 1) { await openHome(); await openAppearance() }
  const r = {}
  for (const mode of ['light', 'dark', 'system']) {
    const got = await clickTheme(mode)
    r[mode] = got
    check(`第 ${round} 轮 · 点「${mode}」:点得到 · 存住 · 挂对 · 底色跟着变`,
      got?.点到 === true && got.存的 === mode
      && (mode === 'system' ? got.挂的.startsWith('(没挂') : got.挂的 === mode)
      && REAL_COLOR.test(String(got.底色 || '')),
      JSON.stringify(got))
  }
  /* 反向守:同一轮里浅与深的底色**不能相等** —— 相等说明按钮点了个寂寞 */
  check(`第 ${round} 轮 · 反向守:浅档底色 ≠ 深档底色(相等 = 换了个寂寞)`,
    r.light?.底色 !== r.dark?.底色, `浅 ${r.light?.底色} · 深 ${r.dark?.底色}`)
  /* 刷新之后还得是刚才那一档(存的是这台电脑的偏好,不是这一次) */
  await ev(`localStorage.setItem('ll-admin-theme','dark')`)
  await openHome()
  const after = await ev(`({ 存的: localStorage.getItem('ll-admin-theme'), 挂的: document.documentElement.dataset.theme || '',
    底色: getComputedStyle(document.body).backgroundColor })`)
  check(`第 ${round} 轮 · 进出页面之后还是深色档(偏好不是一次性的)`,
    after.存的 === 'dark' && after.挂的 === 'dark' && REAL_COLOR.test(String(after.底色 || '')), JSON.stringify(after))
  seen.push({ round, 浅: r.light?.底色, 深: r.dark?.底色, 跟系统: r.system?.底色, 刷新后: after.底色 })
}

/* 五轮之间**每一轮量到的值都要一样** —— 有一轮不一样就是「偶发」,而 L5 不许有偶发 */
const same = (k) => new Set(seen.map((x) => String(x[k]))).size === 1
/* 🔴 先证「量到东西了」再谈「五轮一致」——
   头一版就是因为五轮全 undefined 而「一致」通过的(零命中在空气上绿)。 */
const gotAll = seen.every((x) => REAL_COLOR.test(String(x.浅)) && REAL_COLOR.test(String(x.深)) && REAL_COLOR.test(String(x.刷新后)))
check('⑤0 五轮**每一轮都真量到了底色**(量不到就别谈一致)', gotAll, JSON.stringify(seen))
check(`⑤ 五轮之间量到的底色完全一致(浅/深/跟系统/刷新后各自只有一个值 —— 有第二个值就是偶发,L5 不许有)`,
  gotAll && same('浅') && same('深') && same('跟系统') && same('刷新后'), JSON.stringify(seen))

/* J-33 收摊:把这台浏览器留下的偏好清掉,再把浏览器关掉 */
await ev(`localStorage.removeItem('ll-admin-theme')`)
console.log(`\n[五轮实测] ${JSON.stringify(seen, null, 0)}`)
ws.close(); chrome.kill()
if (fails.length) { console.error(`\n❌ theme-l5-proof ${fails.length}/${n} 条未过`); process.exit(1) }
console.log(`\n✅ theme-l5-proof 通过 ${n} 条(${ROUNDS} 轮 × 三档,真点、存住、挂对、底色跟着变、进出页面仍在)`)
process.exit(0)
