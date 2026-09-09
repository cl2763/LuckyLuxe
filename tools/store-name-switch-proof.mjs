#!/usr/bin/env node
/* D156 切店刀 —— 先登 A 店再登 B 店,**A 的店名必须从整页消失**(店主 09-08 判据原文)

   为什么单独一把:常驻回归起不了浏览器,而这条要证的事只在浏览器里成立 ——
   「退出/换账号之后,顶栏那行还留着上一家的名字吗」。
   静态那半(锁回登录页就清空 `owner.storeName`)由 `test-store-name` ④d 守;
   这一把补的是**渲染出来的那一层**(L1 末端验证律)。

   判据三条,一条都不许靠「看起来对」:
   ① 登 A 之后,`[data-tenant-name]` 的字 ≡ A 店 `stores.name`;
   ② 换成 B 再登,那一行 ≡ B 店的名字;
   ③ 🔴 **整页文字里 A 的店名出现 0 次** —— 不是只看那一行,是全页扫。

   用法:
     SWITCH_BASE=http://127.0.0.1:4310 SWITCH_TOKEN=<开发主钥匙> \
       node tools/store-name-switch-proof.mjs <A租户id> <B租户id> */
import { spawn } from 'node:child_process'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'SWITCH_BASE', value: process.env.SWITCH_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const TOKEN = requireTarget({ envName: 'SWITCH_TOKEN', value: process.env.SWITCH_TOKEN, hint: '(开发主钥匙;不写进代码)' })
const [A, B] = process.argv.slice(2)
if (!A || !B) { console.error('用法:node tools/store-name-switch-proof.mjs <A租户id> <B租户id>'); process.exit(2) }
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9335)

const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=/private/tmp/ll-switch-${process.pid}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl = null
for (let i = 0; i < 60 && !wsUrl; i += 1) {
  try { wsUrl = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())).find((t) => t.type === 'page')?.webSocketDebuggerUrl } catch { /* 还没起来 */ }
  if (!wsUrl) await sleep(250)
}
if (!wsUrl) { console.error('Chrome 调试端口没起来'); chrome.kill(); process.exit(2) }
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

let priorScript = null
async function loginAs(tenant) {
  if (priorScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: priorScript })
  priorScript = (await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { const raw = window.fetch; window.fetch = (i, init = {}) => {
      const u = String(typeof i === 'string' ? i : i.url || '');
      if (u.includes('/admin/')) init = { ...init, headers: { ...(init.headers || {}), 'x-admin-tenant-id': ${JSON.stringify(tenant)} } };
      return raw(i, init) } })()`,
  })).result?.identifier
  await send('Page.navigate', { url: `${BASE}/admin` })
  const login = `(() => { const el = document.querySelector('#tokenInput'); if (!el) return 0; el.value = ${JSON.stringify(TOKEN)};
    const b = Array.from(document.querySelectorAll('button')).find((x) => /刷新|Refresh/.test(x.textContent)); if (b) b.click(); return 1 })()`
  for (let i = 0; i < 40; i += 1) {
    await ev(login)
    if (await ev(`Boolean(document.querySelector('#dashboardCharts [data-dh-state]'))`)) break
    await sleep(600)
  }
  await sleep(1200)
  return {
    顶栏: await ev(`(document.querySelector('[data-tenant-name]') || {}).textContent || null`),
    /* 🔴 J-37(店主 05w §五 立):**「在不在」不等于「看得见」。**
       `textContent` 对着一个被 `overflow` 剪掉、被别的层压住、或者宽高为 0 的节点**照样返回文字** ——
       店名这种「必须让人一眼看见」的东西,判据要量它**落没落在可见区里**:
       ①宽高都 > 0 ②包围盒在视口内 ③中心点上 `elementFromPoint` 命中的就是它自己(没被压住)。 */
    可见: await ev(`(() => {
      const el = document.querySelector('[data-tenant-name]'); if (!el) return { 有: false }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
      return { 有: true, 宽: Math.round(r.width), 高: Math.round(r.height),
        进视口: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
        没被压住: Boolean(top) && (top === el || el.contains(top) || top.contains(el)),
        显示: cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 }
    })()`),
    接口: await ev(`fetch('/admin/auth/me', { headers: { authorization: 'Bearer ' + ${JSON.stringify(TOKEN)} } }).then(r => r.json()).then(j => j.admin.storeName)`),
  }
}

let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  console.log(`${ok ? 'ok' : 'not ok'} ${n} - ${name}${ok || !detail ? '' : ` :: ${detail}`}`)
  if (!ok) fails.push(name)
}

const a = await loginAs(A)
check(`① 登 ${A}:顶栏那行 ≡ 该店 storeName`, Boolean(a.接口) && a.顶栏 === a.接口, JSON.stringify(a))
/* J-37:上面那条只证明「字在 DOM 里」,下面这条才证明「人看得见」 */
check(`①v J-37 店名**看得见**:宽高 > 0 · 包围盒在视口内 · 中心点没被别的层压住`,
  Boolean(a.可见?.有) && a.可见.宽 > 0 && a.可见.高 > 0 && a.可见.进视口 && a.可见.没被压住 && a.可见.显示,
  JSON.stringify(a.可见))
/* ①b 退出那一下 —— 这才是「留着上一家的名字」真正会发生的地方。
   换店走的是整页重载,重载天然把内存清空,所以**只靠重载证明不了清理逻辑在**;
   点「退出」不重载页面,`setLocked(true)` 该把店名抹掉。抹不掉,这一条就红。 */
const afterLogout = await (async () => {
  await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^退出|Log out/.test(x.textContent.trim())); if (b) b.click(); return 1 })()`)
  await sleep(800)
  return ev(`(document.querySelector('[data-tenant-name]') || {}).textContent || null`)
})()
check('①b 🔴 点「退出」之后顶栏那行不再是上一家的店名(不重载页面 —— 重载天然清空,证不了清理逻辑)',
  Boolean(afterLogout) && afterLogout !== a.接口, JSON.stringify({ 退出后: afterLogout, 上一家: a.接口 }))

const b = await loginAs(B)
check(`② 换登 ${B}:顶栏那行 ≡ 该店 storeName`, Boolean(b.接口) && b.顶栏 === b.接口, JSON.stringify(b))
check('②b 造景自证:两家店的名字**本来就不一样**(名字一样的话下面那条扫什么都绿)', a.接口 !== b.接口,
  JSON.stringify({ A: a.接口, B: b.接口 }))
/* ③ 不是只看那一行 —— 整页文字里扫 A 的店名。留一处都算「看不出自己在哪家店」。
   🔴 这里有个坑,第一次跑就踩了:**A 的店名可能是 B 的店名的子串**(同一品牌开的分店最容易这样),
   直接数 A 会把 B 自己数进去,判据红得毫无道理(判据律:一条会在无病时也红的判据,和在有病时也绿的一样废)。
   —— 顺带一说,这段解释里**不写具体店名**:`test-store-name` ① 会把注释里的店名字面量也扫出来,
   而判据面不该靠「当前叫什么」活着(判据不许锚在会变的字面量上)。
   所以先把 B 的名字**整段挖掉**再数 A —— 剩下的才是真正的「上一家的残留」。 */
const leftover = await ev(`(() => { const t = document.body.innerText.split(${JSON.stringify(String(b.接口 || ''))}).join('');
  const k = ${JSON.stringify(String(a.接口 || ''))};
  return k ? t.split(k).length - 1 : -1 })()`)
check(`③ 🔴 换店后**整页**再也找不到上一家的店名(先挖掉 B 的名字再数,出现 ${leftover} 次,须为 0)`,
  leftover === 0, `A=${a.接口} · B=${b.接口}`)
if (String(b.接口 || '').includes(String(a.接口 || ''))) {
  console.log(`   [注] A 的店名是 B 的子串 —— 上面那条是「挖掉 B 之后再数」,否则会把 B 自己数成残留`)
}

ws.close(); chrome.kill()
console.log(`\n[D156 切店] ${A} → ${B}`)
if (fails.length) { console.error(`\n❌ 切店刀 ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ 切店刀通过 ${n} 项`)
