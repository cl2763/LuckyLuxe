#!/usr/bin/env node
/* 网页截图刀 —— 把后台某一页**存成文件**(店主 05r 补一 第一条)

   案由:D154 回执写「交了两张截图」,而 `git show --stat` 与整仓找图**一张都没有** ——
   我看见的图只存在于聊天窗里,仓里没有文件。**「交了」而没有文件,与 J-27 同族**
   (那次是把一个不存在的 localStorage 键说成「就存在这上面」)。
   这件东西的存在意义只有一个:**让「交了截图」这句话有文件可核**。

   怎么做的:起一个**独立 profile 的无头 Chrome**(不碰店主自己的浏览器),
   走 CDP:先 `addScriptToEvaluateOnNewDocument` 把换店的请求头挂上(平台主钥匙那条口,
   `x-admin-tenant-id`,见 local-server.mjs `requireAdmin`),再填令牌框、点刷新,
   **轮询等到页面真出了态**再 `Page.captureScreenshot` 落盘。
   —— 不用无头 `--screenshot`:那条路没法先登录,截出来永远是登录页;
   也不用定长 sleep:等不够就截到加载中,那种图等于没截。

   用法:
     SHOT_BASE=http://127.0.0.1:4310 SHOT_OUT=<目录> node tools/web-shot.mjs \
       --shot 名字:租户id:维度[:宽x高][:failed]
   例:
     --shot 旗舰店_本月:lucky-luxe:month
     --shot 窄屏:lucky-luxe:month:420x900
     --shot 失败态:lucky-luxe:today:1440x900:failed */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'SHOT_BASE', value: process.env.SHOT_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const OUT = requireTarget({ envName: 'SHOT_OUT', value: process.env.SHOT_OUT, hint: '(截图落到哪个目录)' })
/* 令牌从环境进,**不写进代码**(店主长期约束:走查凭证不进代码/判据/回执/提交) */
const TOKEN = requireTarget({ envName: 'SHOT_TOKEN', value: process.env.SHOT_TOKEN, hint: '(开发主钥匙,启动日志里那一串;不写进代码)' })
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9333)

const shots = process.argv.reduce((acc, a, i, arr) => (a === '--shot' ? [...acc, arr[i + 1]] : acc), [])
if (!shots.length) { console.error('至少给一个 --shot 名字:租户:维度'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const profile = `/private/tmp/ll-shot-profile-${process.pid}`
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function cdpTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* 还没起来,接着等 */ }
    await sleep(250)
  }
  throw new Error('Chrome 调试端口没起来 —— 装没装 Chrome?SHOT_CHROME 路径对不对?')
}

const ws = new WebSocket(await cdpTarget())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq
  pending.set(id, resolve)
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(`页内报错: ${r.result.exceptionDetails.text} ${r.result.exceptionDetails.exception?.description || ''}`)
  return r.result?.result?.value
}
/* 轮询等条件,而不是定长 sleep —— 等不够就截到「加载中」,那种图等于没截 */
async function waitFor(label, expr, timeoutMs = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await evaluate(`Boolean(${expr})`)) return true
    await sleep(300)
  }
  /* 超时不许只丢一句「等不到」—— 那种报错查不动。把页面当时的样子一起抛出来 */
  const dump = await evaluate(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 500)`).catch(() => '(取不到)')
  throw new Error(`等不到「${label}」(${timeoutMs}ms):${expr}\n  页面当时:${dump}`)
}

await send('Page.enable')
await send('Runtime.enable')

let priorScript = null
const done = []
for (const spec of shots) {
  const [name, tenant, period = 'today', size = '1440x900', mode = ''] = String(spec).split(':')
  const [w, h] = size.split('x').map(Number)

  /* 换店 = 给所有 /admin/ 请求挂平台主钥匙的换店头。装在 document 创建之前,
     所以**整页**(侧栏、店名、每一块)都是那家店的,不是只把首页那一块换掉。 */
  if (priorScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: priorScript })
  const boot = `(() => {
    const TENANT = ${JSON.stringify(tenant)};
    const FAIL = ${JSON.stringify(mode === 'failed')};
    const raw = window.fetch;
    window.fetch = (input, init = {}) => {
      const url = String(typeof input === 'string' ? input : input.url || '');
      if (url.includes('/admin/')) {
        init = { ...init, headers: { ...(init.headers || {}), 'x-admin-tenant-id': TENANT } };
        /* 造「取数失败」态:只掐首页那三条接口,别的照常,页面框架还在(图 §六 要的就是这个样子) */
        if (FAIL && /\\/admin\\/dashboard\\/(pulse|now|todo)/.test(url)) return Promise.reject(new Error('造态:取数失败'));
      }
      return raw(input, init);
    };
  })()`
  priorScript = (await send('Page.addScriptToEvaluateOnNewDocument', { source: boot })).result?.identifier

  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false })
  /* 🔴 D168 段 3 第 7 条:深浅两态各拍一张。两种「深」不是一回事,分开拍:
     · `sysdark` —— **系统**深色(`prefers-color-scheme: dark`),走令牌第 ② 段;
     · `dark`    —— 站内**显式**选深色(`<html data-theme="dark">`),走令牌第 ③ 段。
     ③ 必须压得过 ②,所以两张都得拍;只拍一张证不了「站内的选择赢了系统」。 */
  await send('Emulation.setEmulatedMedia', mode === 'sysdark'
    ? { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }
    : { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await send('Page.navigate', { url: `${BASE}/admin` })
  /* 🔴 令牌框是 admin.html 里的静态节点,**解析到就有了,而那时 admin.js 还没绑上事件** ——
     所以「等它出现再点一次」会点在空气上,页面永远停在登录页(第一次跑就是这么挂的)。
     改成**一直点到真进去为止**:不猜应用什么时候就绪,只认「首页出了态」这个结果。 */
  await waitFor('登录框出现', `document.querySelector('#tokenInput')`)
  const login = `(() => { const el = document.querySelector('#tokenInput'); if (!el) return 0; el.value = ${JSON.stringify(TOKEN)};
    const b = Array.from(document.querySelectorAll('button')).find((x) => /刷新|Refresh/.test(x.textContent)); if (b) b.click(); return 1 })()`
  await evaluate(login)
  for (let i = 0; i < 30; i += 1) {
    if (await evaluate(`Boolean(document.querySelector('#dashboardCharts [data-dh-state]'))`)) break
    await sleep(700)
    await evaluate(login)
  }
  await waitFor('首页出态', `document.querySelector('#dashboardCharts [data-dh-state]')`, 8000)
  if (mode === 'dark') await evaluate(`(() => { document.documentElement.dataset.theme = 'dark'; return 1 })()`)
  await evaluate(`(() => { const b = document.querySelector('#dashboardCharts [data-dh-period="${period}"]'); if (b) b.click(); return 1 })()`)
  /* 切了维度要等它把新数画上来(loading 退场);失败态本来就停在 failed,一起认 */
  await waitFor('维度画完', `(() => { const s = document.querySelector('#dashboardCharts [data-dh-state]'); return s && s.dataset.dhState !== 'loading' })()`)
  /* 🔴 05t 现踩:光等一次「不是 loading」不够 —— `renderDashboard()` 在别处还会被再调一次,
     页面会**再闪一次骨架**,而截图正好落在那一帧上(拍到的是加载中,探针几百毫秒后拍到的却是 ready
     —— 图与证据自相矛盾)。改成**等它稳住**:连续 4 次(每 400ms)都还在 ready 才算。
     这是判据律那条:能验渲染结果就别验中间产物,而「稳住了没有」本身也得验。 */
  for (let tries = 0; tries < 40; tries += 1) {
    let stable = 0
    for (let i = 0; i < 4; i += 1) {
      if (await evaluate(`Boolean(document.querySelector('#dashboardCharts [data-dh-hero]'))`)) stable += 1
      else stable = 0
      await sleep(400)
    }
    if (stable >= 4) break
  }
  await sleep(600)   // 折线/台面的最后一帧

  /* 段 11:`fullscreen` 那一张 —— 点「⤢ 全屏大屏」把前台大屏态拍下来 */
  if (mode === 'fullscreen') {
    await evaluate(`document.querySelector('#dashboardCharts [data-dh-full]').click()`)
    await waitFor('全屏大屏出来', `document.querySelector('[data-dh-fullscreen] [data-fs-metric]')`, 15000)
    await sleep(800)
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const file = join(OUT, `${name}.png`)
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
  /* 取证:D156 之后顶栏那行显的就是当前店名,所以三张图**靠图本身**就分得开。
     这里仍把接口值一起探回来,是为了对一次「页面上写的」与「接口给的」是不是同一个;
     顺带把 `storeName`(门店名)与 `tenantName`(商户名)并排记下 —— 它们会分叉,
     本机库 demo-ai 现测就是两个不同的名字。 */
  const probe = await evaluate(`(async () => { const h = document.querySelector('#dashboardCharts');
    const big = h.querySelector('[data-dh-hero-left] .dh-big');
    const me = await fetch('/admin/auth/me', { headers: { authorization: 'Bearer ' + ${JSON.stringify(TOKEN)} } }).then((r) => r.json()).catch(() => null);
    return JSON.stringify({
      店id: me && me.admin && me.admin.tenantId,
      顶栏店名: (document.querySelector('[data-tenant-name]') || {}).textContent || null,
      接口storeName: me && me.admin && me.admin.storeName,
      接口tenantName: me && me.admin && me.admin.tenantName,
      态: Array.from(h.querySelectorAll('[data-dh-state]')).map((e) => e.dataset.dhState),
      大数: big ? big.textContent.trim() : null,
      币码: (h.querySelector('[data-dh-cur]') || {}).textContent || null,
      四小牌: Array.from(h.querySelectorAll('[data-dh-tiles] .dh-tile')).map((e) => e.textContent.replace(/\\s+/g, ' ').trim()),
      折线点: h.querySelectorAll('[data-dh-spark] circle').length,
      /* D168 判据取证:皮对不对不靠肉眼 —— 把算出来的样式一起带回来。
         大数字第一支字体必须是 Fraunces;英雄块底色必须等于令牌 hero 的当前值。 */
      大数字体: big ? getComputedStyle(big).fontFamily.split(',')[0].replace(/["']/g, '') : null,
      标题字体: getComputedStyle(document.querySelector('h1, h2, h3') || document.body).fontFamily.split(',')[0].replace(/["']/g, ''),
      英雄底色: (() => { const e = h.querySelector('[data-dh-hero]'); return e ? getComputedStyle(e).backgroundColor : null })(),
      令牌hero: getComputedStyle(document.documentElement).getPropertyValue('--hero').trim(),
      令牌herogold: getComputedStyle(document.documentElement).getPropertyValue('--herogold').trim(),
      渐变: h.querySelectorAll('[data-dh-spark] linearGradient stop').length,
      dots: h.querySelectorAll('[data-dh-dots] [data-dh-dot]').length,
      dots选中: h.querySelectorAll('[data-dh-dots] .on').length,
      主题: document.documentElement.dataset.theme || '(跟系统)',
      视口: innerWidth + 'x' + innerHeight,
    }) })()`)
  done.push({ file, spec, probe })
  console.log(`✓ ${file}\n    ${probe}`)
}
ws.close()
chrome.kill()
console.log(`\n共 ${done.length} 张,落在 ${OUT}`)
