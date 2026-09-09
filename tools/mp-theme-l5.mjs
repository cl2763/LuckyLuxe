#!/usr/bin/env node
/* L5 重复稳定律 · **小程序**三档连续 5 次(店主 05x §五:随裁 #25 顺路做满)
 *
 * 上一批我如实写了「小程序那三档没做满 5 次」;店主准了理由,但要求
 * 「做 #25 那一批时顺手做满 —— 那一批本来就要反复切档位量 tabbar 和导航栏,5 次是顺路的」。
 *
 * 每一轮:三档各切一次 × 两页(商家首页 / 商家「我的」),量四样 ——
 *   ① 页面根节点的档位类   ② 整页底色 == 该档 --paper
 *   ③ 卡片底色 == 该档 --card ④ 导航栏最后被设成该档那两个值(留痕在 ll-theme-chrome)
 * 五轮之间**每个量值只许有一个值**;出现第二个值 = 偶发,L5 不许有。
 *
 * 用法:MP_AUTOMATOR=<模块绝对路径> node tools/mp-theme-l5.mjs   (MP_L5_ROUNDS 可改轮数)
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const AUTO = process.env.MP_AUTOMATOR
if (!AUTO || AUTO === 'skip') {
  console.error('\n🔴 MP_AUTOMATOR 没给(或 =skip)—— **这一刀本轮未跑**,不是通过。')
  process.exit(1)
}
const ROUNDS = Number(process.env.MP_L5_ROUNDS || 5)
const automator = createRequire(import.meta.url)(AUTO)
const T = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`automator 卡住了(${ms}ms):${what}`)), ms))])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 令牌值现读(判据不许自己抄一份色值) */
const TOK = readFileSync(new URL('../miniprogram/styles/tokens.wxss', import.meta.url), 'utf8')
const blockOf = (sel) => (TOK.match(new RegExp(`^\\${sel}\\{[^}]*\\}`, 'm')) || [''])[0]
const tokenIn = (block, name) => (block.match(new RegExp(`--${name}:\\s*([^;}]+)`)) || [])[1]?.trim() || ''
const hexToRgb = (h) => {
  const s = h.replace('#', '').trim()
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return `rgb(${parseInt(f.slice(0, 2), 16)}, ${parseInt(f.slice(2, 4), 16)}, ${parseInt(f.slice(4, 6), 16)})`
}
const WANT = {
  light: { paper: hexToRgb(tokenIn(blockOf('.theme-light'), 'paper')), card: hexToRgb(tokenIn(blockOf('.theme-light'), 'card')) },
  dark: { paper: hexToRgb(tokenIn(blockOf('.theme-dark'), 'paper')), card: hexToRgb(tokenIn(blockOf('.theme-dark'), 'card')) },
}

let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const mp = await T((automator.connect || automator.default.connect).call(automator,
  { wsEndpoint: `ws://127.0.0.1:${Number(process.env.MP_AUTO_PORT || 9420)}`, timeout: 20000 }), 25000, 'connect')

const setTheme = (m) => T(mp.evaluate((x) => { wx.setStorageSync('ll-theme', x) }, m), 8000, `setTheme ${m}`)
const styleOf = async (page, sel, prop) => {
  const el = await T(page.$(sel), 8000, `$(${sel})`)
  if (!el) return ''
  const size = await T(el.size(), 6000, 'size').catch(() => null)
  if (!size || !(size.width > 0 && size.height > 0)) return '(宽高为 0,不算看得见)'   /* J-37 */
  return String(await T(el.style(prop), 6000, `style(${sel})`) || '')
}

const rounds = []
for (let round = 1; round <= ROUNDS; round += 1) {
  const got = { round }
  for (const mode of ['light', 'dark']) {
    await setTheme(mode)
    await T(mp.reLaunch('/pages/merchant/home/index'), 18000, 'reLaunch 商家首页'); await sleep(2000)
    const home = await T(mp.currentPage(), 8000, 'currentPage')
    const rootEl = await T(home.$('.page'), 8000, '.page')
    got[`${mode}·类`] = rootEl ? String(await T(rootEl.attribute('class'), 5000, 'class') || '') : ''
    got[`${mode}·纸`] = await styleOf(home, '.page', 'background-color')
    got[`${mode}·卡`] = await styleOf(home, '.dh-card', 'background-color')
    await T(mp.reLaunch('/pages/merchant/me/index'), 18000, 'reLaunch 商家我的'); await sleep(1800)
    const me = await T(mp.currentPage(), 8000, 'currentPage')
    got[`${mode}·我的卡`] = await styleOf(me, '.group', 'background-color')
    const chrome = await T(mp.evaluate(() => wx.getStorageSync('ll-theme-chrome')), 8000, 'chrome')
    got[`${mode}·导航栏`] = chrome ? String(chrome.backgroundColor || '').toLowerCase() : ''
    check(`第 ${round} 轮 · ${mode} 档:类挂上 · 纸=${WANT[mode].paper} · 卡=${WANT[mode].card} · 导航栏跟着换`,
      new RegExp(`theme-${mode}`).test(got[`${mode}·类`])
      && got[`${mode}·纸`] === WANT[mode].paper
      && got[`${mode}·卡`] === WANT[mode].card
      && got[`${mode}·我的卡`] === WANT[mode].card
      && got[`${mode}·导航栏`] === String(tokenIn(blockOf(`.theme-${mode}`), 'paper')).toLowerCase(),
      JSON.stringify(got))
  }
  /* 跟系统那一档也走一遍(它不挂类,靠 @media —— 走一遍是为了证明「切回去也不留残」) */
  await setTheme('system')
  await T(mp.reLaunch('/pages/merchant/home/index'), 18000, 'reLaunch'); await sleep(1800)
  const sysPage = await T(mp.currentPage(), 8000, 'currentPage')
  const sysEl = await T(sysPage.$('.page'), 8000, '.page')
  got['跟系统·类'] = sysEl ? String(await T(sysEl.attribute('class'), 5000, 'class') || '') : ''
  check(`第 ${round} 轮 · 跟系统档:根节点**不带** theme-light / theme-dark(它靠 @media,不靠类)`,
    !/theme-(light|dark)/.test(got['跟系统·类']), got['跟系统·类'])
  rounds.push(got)
}

const keys = Object.keys(rounds[0] || {}).filter((k) => k !== 'round')
const wobbly = keys.filter((k) => new Set(rounds.map((r) => String(r[k]))).size !== 1)
check(`⑤ 五轮之间每个量值只有一个值(出现第二个值 = 偶发,L5 不许有)`,
  wobbly.length === 0, wobbly.length ? `这些量值在五轮里变过:${wobbly.join(' / ')}` : '')
check('⑤0 先证「真量到了」:五轮的底色都是真颜色,不是空串也不是透明',
  rounds.every((r) => /^rgb\((?!0, 0, 0, 0\))/.test(String(r['dark·纸'])) && /^rgb\((?!0, 0, 0, 0\))/.test(String(r['light·纸']))),
  JSON.stringify(rounds.map((r) => ({ 轮: r.round, 浅纸: r['light·纸'], 深纸: r['dark·纸'] }))))

await setTheme('system')   /* J-33 收摊:档位还回默认 */
try { await T(mp.disconnect(), 5000, 'disconnect') } catch { /* 断不开不拖住收尾 */ }
console.log(`\n[五轮量值表]`)
for (const r of rounds) console.log(`  第 ${r.round} 轮 · 浅纸 ${r['light·纸']} / 深纸 ${r['dark·纸']} / 深卡 ${r['dark·卡']} / 深我的卡 ${r['dark·我的卡']} / 深导航栏 ${r['dark·导航栏']}`)
if (fails.length) { console.error(`\n❌ mp-theme-l5 ${fails.length}/${n} 条未过`); process.exit(1) }
console.log(`\n✅ mp-theme-l5 通过 ${n} 条(${ROUNDS} 轮 × 三档 × 两页)`)
process.exit(0)
