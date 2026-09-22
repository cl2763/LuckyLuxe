/* 建店必须走正门,而且正门要拿全该拿的(D210 · J-115,店主 11l 立)
 *
 * ══ 案由 ══
 * 11k 我写了两条手写 INSERT 去开北京旗舰店,彩排全绿 —— **而建出来的店没人能登录**。
 * 正门 `POST /platform/tenants` 建一家店时顺手做五件事,手写 SQL 漏了三件:
 *   ① tenants 一行 ② stores 一行 ③ **plan_expires_at 按首期订阅算**
 *   ④ **pricingCategoryApi.seedDefaults 平台三大类** ⑤ **admin_accounts 老板账号(首登强制改密)**
 *   ⑥ invalidateTenantTimezone
 *
 * 🔴 J-115:**凡是系统自己有正门的写入,不许绕过正门手写 SQL。**
 *    正门顺手做的每一件事,手写都会漏,**而且漏了当时看不出来 —— 要等到有人用的时候才发现**。
 *    推论 A:预批判别式除了「不该有的为 0」,**必须有一条「必须有的都在」**,
 *            而那张清单**只能从正门代码里读出来,不能凭记忆列**。
 *
 * ══ D210 ══
 * `platform.html` 那一屏原来只发 name/city/plan/initialTerm/id/isDemo —— **不发币种、时区、电话**。
 * 正门缺这两样就默认 `CAD` / `APP_TIMEZONE` ⇒ **在这一屏点一家北京店,建出来是加元计价、多伦多时区**。
 * 小婕店之所以对,是 `seed-jics-nail.mjs` 走正门时**脚本自己带了** —— 界面从来没带过。 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || 'owner-demo-token'
const read = (f) => readFileSync(join(ROOT, f), 'utf8')
const codeOnly = (src) => src
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

let checks = 0
let failed = 0
function check(name, ok, extra = '') {
  checks++
  if (ok) console.log(`ok ${checks} - ${name}`)
  else { failed++; console.log(`not ok ${checks} - ${name}${extra ? ' :: ' + extra : ''}`) }
}
async function req(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-owner-token': TOKEN, ...(opts.headers || {}) },
  })
  let data = null
  try { data = await r.json() } catch { data = null }
  return { status: r.status, data }
}

/* ══ ① 那一屏:四个框在,且 POST 真带上了(静态) ══ */
const html = read('apps/web/platform.html')
const js = codeOnly(html)
for (const [id, label] of [['mCurrency', '币种'], ['mTz', '时区'], ['mPhone', '门店电话'], ['mCity', '地址']]) {
  check(`①a 新建商家那一屏有「${label}」这个框(id=${id})`, html.includes(`id="${id}"`), id)
}
check('①b 🔴 POST body 真的带上了 currency / timezone / phone —— 框在但不发,等于没做',
  /body:JSON\.stringify\(\{name,\s*city:[^}]*phone:[^}]*currency,\s*timezone/.test(js),
  (js.match(/body:JSON\.stringify\(\{name[^}]*\}/) || ['(没找到那一行)'])[0].slice(0, 160))
/* 🔴 币种/时区**不许有默认值**(11l 明写):默认值就是这条缺陷的来源。
   判法是看那两个 select 的第一项 value 是不是空 —— 空=必选,非空=又有默认了。 */
for (const id of ['mCurrency', 'mTz']) {
  const block = (html.match(new RegExp(`<select id="${id}">[\\s\\S]*?</select>`)) || [''])[0]
  check(`①c 🔴 ${id} 第一项是空 value(必选,不许有默认值)`,
    /<option value="" selected>/.test(block), block.slice(0, 120))
}
check('①d 🔴 前端对空币种/空时区真的拦(不是只把框摆在那儿)',
  /if\(!currency\)\{toast\(/.test(js) && /if\(!timezone\)\{toast\(/.test(js))

/* ══ ② 正门代码里「建一家店顺手做的事」逐条在场 ══
   🔴 这张清单是**从正门代码读出来的**(J-115 推论 A),不是凭记忆列的。 */
const srv = codeOnly(read('apps/api/local-server.mjs'))
const gate = (srv.match(/path === '\/platform\/tenants'\)[\s\S]{0,4200}?shopEntry/) || [''])[0]
check('②a 正门那一段找得到(找不到说明它被搬走了,下面几条就都是空转)', gate.length > 500, String(gate.length))
for (const [re, label] of [
  [/INSERT INTO tenants/, 'tenants 一行'],
  [/INSERT INTO stores/, 'stores 一行'],
  [/plan_expires_at/, 'plan_expires_at 按首期订阅算'],
  [/pricingCategoryApi\.seedDefaults/, '平台三大类 seedDefaults'],
  [/INSERT INTO admin_accounts/, '🔴 老板账号 admin_accounts'],
  [/must_change_password/, '🔴 首登强制改密'],
  [/invalidateTenantTimezone/, '时区缓存失效'],
]) check(`②b 正门建店仍然做着:${label}`, re.test(gate), label)

/* ══ ③ 行为层:真打正门建一家 CNY / Asia/Shanghai 的店,六样逐个验 ══ */
const tid = `t210-${Date.now().toString(36)}`
const created = await req('/platform/tenants', {
  method: 'POST',
  body: JSON.stringify({
    name: 'D210 走查店', id: tid, plan: 'studio', initialTerm: 'year',
    city: '北京市朝阳区某路 1 号', phone: '18500000000',
    currency: 'CNY', timezone: 'Asia/Shanghai', isDemo: false,
  }),
})
check('③a 正门建店成功(201)', created.status === 201, `${created.status} ${JSON.stringify(created.data).slice(0, 160)}`)
check('③b 🔴 **老板账号有** —— 11k 那两条手写 SQL 漏的就是它,漏了店主就登不进后台',
  Boolean(created.data?.owner?.username), JSON.stringify(created.data?.owner || {}).slice(0, 80))
/* 🔴 初始密码只证明「有」,**一个字符都不打印** —— 密码不进日志、不进回执。 */
check('③c 🔴 初始密码有值,但这里只验它非空,不打印(密码不许经过任何文件)',
  typeof created.data?.owner?.initialPassword === 'string' && created.data.owner.initialPassword.length >= 8)
check('③d 🔴 **到期日有值** —— 手写 SQL 那次写死 NULL,而没人裁过这家店要不要到期日',
  Boolean(created.data?.tenant?.planExpiresAt), String(created.data?.tenant?.planExpiresAt))

const stores = await req(`/stores`, { headers: { 'x-tenant-id': tid } })
const st = (stores.data?.stores || [])[0]
check('③e 🔴 **币种是 CNY** —— 这就是 D210:界面不传,正门默认 CAD,北京店变加元',
  st?.currency === 'CNY', JSON.stringify(st || {}).slice(0, 160))
check('③f 🔴 **时区是 Asia/Shanghai** —— 同上,不传就是多伦多', st?.timezone === 'Asia/Shanghai', String(st?.timezone))
check('③g 地址与电话也落进去了(这一屏原来一个都不发)',
  String(st?.address || '').includes('北京市') && String(st?.phone || '') === '18500000000',
  JSON.stringify({ a: st?.address, p: st?.phone }))

const cats = await req('/admin/pricing/categories', { headers: { 'x-tenant-id': tid } })
check('③h 平台三大类建店即落(seedDefaults 真跑了)',
  (cats.data?.categories || []).length >= 3, String((cats.data?.categories || []).length))

/* 🟢 阳性对照:不传币种/时区时,正门确实会回落到 CAD / 非上海 ——
   证明 ③e/③f 不是「反正都对」,而是**这一屏传了才对**。
   (这同时把 D210 的缺陷本身钉成一条常驻断言:回落还在,所以界面必须传。) */
const tid2 = `t210b-${Date.now().toString(36)}`
const created2 = await req('/platform/tenants', {
  method: 'POST',
  body: JSON.stringify({ name: 'D210 回落对照店', id: tid2, plan: 'free', initialTerm: 'trial30', isDemo: false }),
})
check('④a 🟢 **阳性对照**:不传币种/时区照样建得出来(证明正门没在这儿拦)', created2.status === 201, String(created2.status))
const stores2 = await req(`/stores`, { headers: { 'x-tenant-id': tid2 } })
const st2 = (stores2.data?.stores || [])[0]
check('④b 🔴 **回落仍在**:不传币种 → CAD。所以「界面必须传」这件事一天不做,这条缺陷一天在',
  st2?.currency === 'CAD', String(st2?.currency))
/* 🔴 第一版这条是**假绿**:请求失败时 `st2` 是 undefined,`undefined !== 'Asia/Shanghai'` 照样成立,
   于是这条断言在「整个对照根本没建成」的时候报绿。**先要求那家店真在,再谈它的时区是什么。** */
check('④c 🔴 **回落仍在**:不传时区 → 不是 Asia/Shanghai(先要求对照店真建出来了)',
  Boolean(st2) && typeof st2.timezone === 'string' && st2.timezone !== 'Asia/Shanghai',
  JSON.stringify({ 有没有这家店: Boolean(st2), tz: st2?.timezone }))

const EXPECTED_CHECKS = 27
if (checks !== EXPECTED_CHECKS) {
  console.error(`not ok - 🔴 断言条数对不上:实跑 ${checks} 条,应为 ${EXPECTED_CHECKS} 条(判据五)。`)
  process.exit(1)
}
if (failed) { console.error(`\n❌ 建店走正门:${failed}/${checks} 条未过`); process.exit(1) }
console.log(`\n✅ 建店走正门 ${checks} 条全过(与声明的 ${EXPECTED_CHECKS} 条一致)`)
