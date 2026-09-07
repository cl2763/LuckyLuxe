#!/usr/bin/env node
/* D155 · 小程序真跑:直开 `pages/ai-chat` 问一句,答案必须与模拟器**一模一样**

   为什么要这一把:常驻套件比的是**两条 HTTP 路**,证明的是后端并成了一个出口;
   但店主要的是「**小程序里问出来**的答案和网页一样」。中间还隔着小程序自己那一层
   (`utils/api.js` 传什么、页面怎么渲染)。这把刀从**小程序页面里**发问,
   再拿同一句去问模拟器,两边对字 —— 这是 L1 那一层。

   入口按店主 08-04 裁定**仍不显示**,所以用 `wx.navigateTo` 直开这一页(测试夹具,不改产品)。

   前置:开发者工具自动化端口(cli auto --auto-port 9420)+ 仓外 miniprogram-automator。
   用法:
     MP_AUTOMATOR=<模块绝对路径> MPAI_BASE=http://127.0.0.1:4310 MPAI_TOKEN=<开发主钥匙> \
       node tools/mp-ai-chat-proof.mjs <租户id> "<要问的话>" */
import { createRequire } from 'node:module'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'MPAI_BASE', value: process.env.MPAI_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const TOKEN = requireTarget({ envName: 'MPAI_TOKEN', value: process.env.MPAI_TOKEN, hint: '(开发主钥匙;不写进代码)' })
const AUTOMATOR = process.env.MP_AUTOMATOR
const PORT = Number(process.env.MP_AUTO_PORT || 9420)
const [TENANT, ASK] = process.argv.slice(2)
if (!TENANT || !ASK) { console.error('用法:node tools/mp-ai-chat-proof.mjs <租户id> "<要问的话>"'); process.exit(2) }
if (!AUTOMATOR || AUTOMATOR === 'skip') {
  console.error('\n🔴 MP_AUTOMATOR 没给(或 =skip)—— **这一刀本轮未跑**,不是通过。')
  console.error('   跑法:npm i miniprogram-automator(装在仓外),MP_AUTOMATOR=<该模块绝对路径>;')
  console.error(`   开自动化端口:cli auto --project miniprogram --auto-port ${PORT}\n`)
  process.exit(1)
}
const automator = createRequire(import.meta.url)(AUTOMATOR)

let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  console.log(`${ok ? 'ok' : 'not ok'} ${n} - ${name}${ok || !detail ? '' : ` :: ${detail}`}`)
  if (!ok) fails.push(name)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 先拿模拟器那条路的答案当基准 —— 它就是「网页/企微看到的那一句」 */
const sim = await fetch(`${BASE}/admin/wechat/mock-chat-message`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': TENANT },
  body: JSON.stringify({ message: ASK, lang: 'zh', externalUserId: `d155-sim-${Date.now().toString(36)}` }),
}).then((r) => r.json()).catch(() => null)
const simText = String(sim?.reply?.data?.answerZh || sim?.reply?.data?.answer || '')
check('① 模拟器那条先答上(拿它当基准;它答不出来,下面比什么都没意义)', Boolean(simText), JSON.stringify(sim)?.slice(0, 160))

const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}`, timeout: 40000 })
/* 让小程序打本机沙箱、进这家店 —— 与它自己的存储键同名,不另造一套 */
await mp.evaluate((base, tenant) => {
  wx.setStorageSync('lucky_tenant', tenant)
  wx.removeStorageSync('lucky_client_id')     // 每跑一次都是全新访客(J-31:不接上一跑的对话)
  return base
}, BASE, TENANT)
const page = await mp.reLaunch('/pages/ai-chat/index').then(() => mp.currentPage())
check('② 直开 `pages/ai-chat`(入口按 08-04 裁定仍不显示,这里是测试夹具直开)',
  Boolean(page) && String(page.path).includes('ai-chat'), String(page && page.path))

await page.setData({ input: ASK })
const btn = await page.$('.send, #send, button')
if (btn) await btn.tap()
else await page.callMethod('send', ASK)
for (let i = 0; i < 40; i += 1) {
  const d = await page.data()
  if ((d.msgs || []).some((m) => m.side === 'a' && m.id !== 'm1')) break
  await sleep(500)
}
const msgs = (await page.data()).msgs || []
const answer = String((msgs.filter((m) => m.side === 'a').slice(-1)[0] || {}).text || '')
check('③ 小程序页面上真出现了回复', Boolean(answer) && answer !== '网络有点不稳定,稍后再试一下~', answer.slice(0, 80))
check('④ 🔴 小程序里问出来的那一句 ≡ 模拟器那一句(这才是店主说的「就像网页一样」)',
  Boolean(answer) && answer === simText, JSON.stringify({ 小程序: answer.slice(0, 60), 模拟器: simText.slice(0, 60) }))

/* 落一张图 —— 「小程序里真出现了这句」这件事,得有文件可核(J-27:交了就得有文件) */
const shotDir = process.env.MPAI_OUT || ''
if (shotDir) {
  const { mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  mkdirSync(shotDir, { recursive: true })
  const file = join(shotDir, `${TENANT}_ai-chat.png`)
  await mp.screenshot({ path: file })
  console.log(`   [图] ${file}`)
}

await mp.disconnect()
console.log(`\n[D155 小程序真跑] ${TENANT} · 问「${ASK}」`)
if (fails.length) { console.error(`\n❌ 小程序真跑 ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ 小程序真跑通过 ${n} 项`)
