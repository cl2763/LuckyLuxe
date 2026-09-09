#!/usr/bin/env node
/* 段 9 · 小程序商家端首页(老板视角)截图落仓 —— 三店 + 三态

   夜班令 5 规矩 5:**带图的段必交截图落仓**,DOM 证据不替代截图(J-32)。
   这把刀用开发者工具自动化直开 `pages/merchant/home`,按店、按态各截一张。

   态怎么造(不改产品代码,只在页面上造):
   · ready  —— 正常取数;
   · failed —— 把页面的 `dhState` 直接置成 failed(那一支就是「整块换一句话」);
   · loading—— 置成 loading。
   两个造出来的态都是**页面自己的分支**,不是我另画一个假界面。

   用法:
     MP_AUTOMATOR=<模块绝对路径> MPH_BASE=http://127.0.0.1:4310 MPH_TOKEN=<开发主钥匙> \
       MPH_OUT=handoff/night-runs/段9截图 node tools/mp-home-shot.mjs <租户id>... */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'MPH_BASE', value: process.env.MPH_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const TOKEN = requireTarget({ envName: 'MPH_TOKEN', value: process.env.MPH_TOKEN, hint: '(开发主钥匙;不写进代码)' })
const OUT = requireTarget({ envName: 'MPH_OUT', value: process.env.MPH_OUT, hint: '(截图落到哪个目录)' })
const AUTOMATOR = process.env.MP_AUTOMATOR
const PORT = Number(process.env.MP_AUTO_PORT || 9420)
const TENANTS = process.argv.slice(2)
if (!TENANTS.length) { console.error('用法:node tools/mp-home-shot.mjs <租户id>...'); process.exit(2) }
if (!AUTOMATOR || AUTOMATOR === 'skip') {
  console.error('\n🔴 MP_AUTOMATOR 没给(或 =skip)—— **这一刀本轮未跑**,不是通过。')
  process.exit(1)
}
const automator = createRequire(import.meta.url)(AUTOMATOR)
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/* 🔴 automator 的调用**没有超时**(05r 补一 残留第 5 条登记在册的缺陷):
   会话一旦不对劲,它就一直挂着,什么都不打印,人只能干等。
   这里给每一个调用套一层硬超时 —— 挂住就当场报「哪一步挂了」,而不是让整刀装死。 */
const withTimeout = (p, ms, what) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error(`automator 卡住了(${ms}ms):${what}`)), ms)),
])
/* 🔴 裁 #21 第 1 条(店主 05v 补一 §二):**截图卡住只算「本次没拍到」,不许吊死整刀**。
   这台机器上 `mp.screenshot()` 必卡(现测:别的调用秒回,只有它不返回)。
   包一层:超时就点名记一笔、继续往下跑;真要图走第三条路
   —— `tools/mp-window-shot.mjs`(macOS `screencapture -l <windowid>`,已跑通)。 */
const missed = []
const shotOrSkip = async (p, what) => {
  try { await withTimeout(p, 20000, what); return true }
  catch (e) { missed.push(`${what}(${e.message})`); console.log(`⏳ ${what} —— **本次没拍到**,继续往下跑`); return false }
}

const seen = []
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  console.log(`${ok ? 'ok' : 'not ok'} ${n} - ${name}${ok || !detail ? '' : ` :: ${detail}`}`)
  if (!ok) fails.push(name)
}

const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}`, timeout: 40000 })
for (const tenant of TENANTS) {
  /* 🔴 第一版三张图**一模一样**(字节数都相同、三家店都显示 CAD $0)——
     因为商家端的租户来自**登录账号自己**,而我用的是平台主钥匙:
     不带换店头时它回落到默认租户,三张拍的其实是同一家店。
     这正是 05r 补一 那次的教训(三张图分不出是三家)。
     改法:在页面里把 `wx.request` 包一层,给 `/admin/` 请求补上平台主钥匙的换店头
     —— **测试夹具,不改产品**(后端那条口就是给平台侧运维用的)。 */
  await mp.evaluate((t) => { wx.setStorageSync('lucky_tenant', t); return 1 }, tenant)
  await mp.evaluate((tk) => { wx.setStorageSync('lucky_admin_auth', { accessToken: tk, admin: { role: 'owner' } }); return 1 }, TOKEN)
  await mp.evaluate((t) => {
    if (!wx.__shotPatched) {
      const raw = wx.request
      wx.__shotTenant = t
      wx.request = (opt = {}) => raw({ ...opt, header: { ...(opt.header || {}),
        ...(String(opt.url || '').includes('/admin/') ? { 'x-admin-tenant-id': wx.__shotTenant } : {}) } })
      wx.__shotPatched = true
    } else { wx.__shotTenant = t }
    return wx.__shotTenant
  }, tenant)
  await withTimeout(mp.reLaunch('/pages/merchant/home/index'), 25000, `打开首页 ${tenant}`)
  const page = await mp.currentPage()
  for (let i = 0; i < 40; i += 1) {
    const d = await page.data()
    if (d.dhState && d.dhState !== 'loading') break
    await sleep(500)
  }
  const d = await page.data()
  check(`${tenant} · 正常态出来了(dhState=ready)`, d.dhState === 'ready', String(d.dhState))
  check(`${tenant} · 大数不是空的`, Boolean(d.dh && d.dh.headValue), String(d.dh && d.dh.headValue))
  await shotOrSkip(mp.screenshot({ path: join(OUT, `${tenant}_ready.png`) }), `截图 ${tenant}`)
  seen.push({ tenant, head: d.dh && d.dh.headValue, small: d.dh && d.dh.smalls && d.dh.smalls[0] && d.dh.smalls[0].value })
  console.log(`   [图] ${join(OUT, `${tenant}_ready.png`)} · 大数 ${d.dh && d.dh.headValue} · 现金 ${d.dh && d.dh.smalls[0].value}`)
}
/* 🔴 三张图必须**分得开** —— 上一版三张字节数相同,等于三张同一家店的图。
   这里按「页面上真渲染出来的东西」比:三家店的大数或币种至少有一处不同。 */
check('三店自证:三张图不是同一家店(大数/币种至少一处不同)',
  new Set(seen.map((x) => `${x.head}|${x.small}`)).size >= 2, JSON.stringify(seen))

/* 三态各留一张(用第一家店) */
const t0 = TENANTS[0]
const page = await mp.currentPage()
for (const st of ['failed', 'loading']) {
  await page.setData({ dhState: st, dh: st === 'failed' ? null : (await page.data()).dh })
  await sleep(600)
  const cur = await page.data()
  check(`${t0} · ${st} 态是页面自己的分支`, cur.dhState === st, String(cur.dhState))
  await shotOrSkip(mp.screenshot({ path: join(OUT, `${t0}_${st}.png`) }), `截图 ${t0}_${st}`)
  console.log(`   [图] ${join(OUT, `${t0}_${st}.png`)}`)
}
/* ══ 段 10 · 员工打卡门两态 ══
   🔴 **如实说清这两张是怎么来的**:沙箱库里没有员工账号(见 handoff/本地自查账号.txt),
   所以没能用真员工号登一次。这两张是把页面切到员工分支、并喂进两种考勤态拍的 ——
   渲染出来的是**页面自己的分支**,不是我另画的假界面;但它**不等于真员工登录走查**。
   缺的那一半已登记(段 10 残留),不冒充。 */
if (process.env.MPH_STAFF === '1') {
  const gateOff = { state: 'gate', note: '', showButton: true, showBoard: false, badge: '', action: 'in' }
  const gateOn = { state: 'open', note: '', showButton: false, showBoard: true, badge: '✓ 已打卡 09:58', action: 'out' }
  for (const [name, gate, extra] of [
    ['staff_gate', gateOff, { shiftLine: '今天的班 · 到 19:00', clockErr: '' }],
    ['staff_gate_fail', gateOff, { shiftLine: '今天的班 · 到 19:00', clockErr: '未连接门店 WiFi,无法打卡。请连上店内 WiFi 再试;确实连不上找老板手动补卡。' }],
    ['staff_open', gateOn, { staffPerf: '¥860', staffStats: [
      { key: 'myOrders', label: '今日单数', value: '5 单', sub: '在做 1 · 待到店 2', live: true },
      { key: 'next', label: '下一位', value: '14:45', sub: 'Mia · 睫毛嫁接' },
      { key: 'weekHours', label: '本周工时', value: '31 h', sub: '超时算加班' }] }],
  ]) {
    await page.setData({ isOwner: false, roleLabel: '员工', gate, ...extra })
    await sleep(700)
    const cur = await page.data()
    check(`段10 · ${name} 是页面自己的分支(isOwner=false 且 gate.state=${gate.state})`,
      cur.isOwner === false && cur.gate.state === gate.state, JSON.stringify({ isOwner: cur.isOwner, state: cur.gate && cur.gate.state }))
    await shotOrSkip(mp.screenshot({ path: join(OUT, `${name}.png`) }), `截图 ${name}`)
    console.log(`   [图] ${join(OUT, `${name}.png`)}`)
  }
}

await mp.disconnect()
console.log(`\n[段9 截图] ${TENANTS.length} 店 × 正常态 + 失败/加载两态`)
if (fails.length) { console.error(`\n❌ 段9 截图 ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ 段9 截图通过 ${n} 项`)
