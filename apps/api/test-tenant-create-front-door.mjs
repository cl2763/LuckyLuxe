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

/* ══ ⑤ 北京店「永久」走现成的路,不新加开关(店主 11m §二)══
 *
 * 店主答「不要到期日,做成永久的」。**路已经有**:
 *   建店(默认年付)→ 平台后台套餐计费页把日期框清空 → `planExpiresAt: null` → `plan_expires_at = NULL` → 永久。
 * 🔴 11m 要求逐处确认 **NULL 被当「不过期」而不是「已过期」** —— 全仓现扫 11 处,这里把关键那几处钉住。
 *    哪天有人把某一处改成「NULL 当过期」,内部店第二天就会被停掉,而没有任何断言会红。 */
{
  const srv = codeOnly(read('apps/api/local-server.mjs'))
  const plat = read('apps/web/platform.html')
  const adm = codeOnly(read('apps/web/admin.js'))
  check('⑤a 🔴 `planExpired` 判据:NULL ⇒ 不过期(`Boolean(planExpiresAt && …)`)',
    /planExpired = Boolean\(planExpiresAt && /.test(srv))
  check('⑤b 🔴 `/admin/subscription`:没有到期日 ⇒ `status = .unlimited.`,不是 suspended',
    /\} else \{\s*status = 'unlimited'/.test(srv))
  check('⑤c 🔴 平台列表:没有到期日 ⇒ 显示「长期授权」,不是「已到期」',
    /t\.planExpiresAt\?\(days<=0\?[\s\S]{0,140}?:'<span class="muted">长期授权<\/span>'/.test(plat), '')
  check('⑤d 🔴 商家后台:没有到期日 ⇒「长期有效」', /'长期有效' : 'No expiry'/.test(adm))
  check('⑤e 🔴 `daysLeft`:没有到期日 ⇒ null(不是负数)',
    /daysLeft: t\.plan_expires_at \? [^:]+: null/.test(srv))
  check('⑤f 🔴 **清空到期日这条路已经有**:平台 billing 口收 `planExpiresAt: null/""` ⇒ `plan_expires_at = NULL`',
    /body\.planExpiresAt === null \|\| body\.planExpiresAt === ''\) \{ updates\.push\('plan_expires_at = NULL'\)/.test(srv))
  check('⑤g 🔴 界面入口在:套餐计费页那个日期框清空就走这条路(不用新加按钮)',
    /onchange="setExpiry\('\$\{esc\(t\.id\)\}',this\.value\)"/.test(plat)
    && /planExpiresAt:date\|\|null/.test(plat))
  check('⑤h 🟢 反向守:续费按「今天与旧到期日的较大者」起算 —— 永久店(NULL)续费从今天起,不是从 1970',
    (srv.match(/Math\.max\(Date\.now\(\), tenant\?\.plan_expires_at \? new Date\(tenant\.plan_expires_at\)\.getTime\(\) : 0\)/g) || []).length >= 2)
}

/* ══ ⑥ 对外域名按租户出(店主 11p §三)══
 *
 * `APP_PUBLIC_URL` 原来是**一个全局常量**:所有店的推荐/签署/绑定链接都用它。
 * 两家真店要落在两个域上(境内已备案的 app 子域 / 境外原域),一个常量表达不了 ——
 * **小婕的顾客会收到一条境外域名的签署链接,而系统不会有任何报错。**
 * 🔴 三处链接全走 `publicAppUrl()` 这一个出口,判据钉住「没有谁再直接读那个常量」。 */
{
  const srv2 = codeOnly(read('apps/api/local-server.mjs'))
  const mod = read('apps/api/tenant-public-url.mjs')
  check('⑥a 唯一出口件在,两个域各有名字(别处引名字,不引字面量)',
    /export const DOMAIN_CN = 'https:\/\/app\.jingshengyouji\.com'/.test(mod)
    && /export const DOMAIN_INTL = 'https:\/\/www\.luckyluxeatelier\.com'/.test(mod))
  /* 🔴 三处用处逐个钉 —— 漏一处就是「有一条链接还用着全局常量」,而那一条不会报错 */
  for (const [re, label] of [
    [/referralUrl: `\$\{publicAppUrl\(tenantId\)\}\/\?ref=/, '推荐链接 /?ref=(且把 tenantId 传了进去)'],
    [/return `\$\{publicAppUrl\(\)\}\/sign\?t=/, '签署链接 /sign?t='],
    [/url: `\$\{publicAppUrl\(\)\}\/bind\?t=/, '绑定链接 /bind?t='],
  ]) check(`⑥b 走唯一出口:${label}`, re.test(srv2), label)
  /* 🔴 全仓零残留:除了定义那一行与两个 fallback,不许谁再直接读 APP_PUBLIC_URL 去拼链接 */
  const raw = (srv2.match(/\$\{APP_PUBLIC_URL\}/g) || []).length
  check('⑥c 🔴 **零残留**:没有任何一处再用 `${APP_PUBLIC_URL}` 直接拼链接', raw === 0, String(raw))

  /* ══ 行为层:两家店各建一个,各签一条链接,域名必须对得上 ══ */
  const cn = `dom-cn-${Date.now().toString(36)}`
  const intl = `dom-intl-${Date.now().toString(36)}`
  const x = `dom-x-${Date.now().toString(36)}`
  const mk = (id, cur, tz, extra = {}) => req('/platform/tenants', {
    method: 'POST',
    body: JSON.stringify({ name: `域名验店 ${id}`, id, plan: 'free', initialTerm: 'trial30', currency: cur, timezone: tz, ...extra }),
  })
  check('⑥d 夹具:三家店建成', (await mk(cn, 'CNY', 'Asia/Shanghai')).status === 201
    && (await mk(intl, 'CAD', 'America/Toronto')).status === 201
    && (await mk(x, 'CNY', 'Asia/Shanghai', { publicDomain: 'intl' })).status === 201)
  /* 🔴 推荐链接住在 `serializeUser` 里,而**只有顾客自己读自己那条口会走它**
     (`/admin/customers` 走的是另一份投影,没有 referralUrl —— 我第一版取错了口,夹具自证当场红)。
     所以走顾客正门登录再读 `/users/:id`(J-60:夹具走正门),
     用真实端到端路径取值 —— 模块函数对了不等于链接上的域名对了。 */
  const { loginCustomerViaFrontDoor } = await import('./customer-login-fixture.mjs')
  const refOf = async (tid) => {
    /* 登录响应本身就带 `user`(已经过 `serializeUser`)—— 少一次请求,也少一处会取错的字段名。
       ⚠️ 字段叫 `accessToken` 不是 `token`:我第一版写了 `who.token`,取到 undefined,夹具自证当场红。 */
    const who = await loginCustomerViaFrontDoor({ base: BASE, tenantId: tid, openid: `domprobe-${tid}` })
    if (!who.ok || !who.user) return `(登录失败 ${who.status} ${JSON.stringify(who.body).slice(0, 90)})`
    return String(who.user.referralUrl || '')
  }
  const cnUrl = await refOf(cn)
  const intlUrl = await refOf(intl)
  const xUrl = await refOf(x)
  /* 取不到就红,不静默跳过(判据五:被条件块包住的断言,取不到前置就红) */
  check('⑥e 夹具有效:三家店都取到了推荐链接(取不到就没法验域名)',
    Boolean(cnUrl && intlUrl && xUrl), JSON.stringify({ cnUrl, intlUrl, xUrl }))
  check('⑥f 🔴 **境内店(CNY,没显式选)⇒ app.jingshengyouji.com**',
    cnUrl.startsWith('https://app.jingshengyouji.com'), cnUrl)
  check('⑥g 🟢 **阳性对照**:境外店(CAD)**不是**那个域 —— 证明 ⑥f 不是「所有店都返回同一个域」',
    Boolean(intlUrl) && !intlUrl.startsWith('https://app.jingshengyouji.com'), intlUrl)
  check('⑥h 🔴 显式选覆盖币种推断:CNY 的店选了境外 ⇒ 拿到境外域',
    xUrl.startsWith('https://www.luckyluxeatelier.com'), xUrl)
  check('⑥i 平台建店表单有「对外域名」下拉,且 POST 真带上了',
    read('apps/web/platform.html').includes('id="mDomain"')
    && /publicDomain:\$\('mDomain'\)\.value/.test(codeOnly(read('apps/web/platform.html'))))
}

const EXPECTED_CHECKS = 46
if (checks !== EXPECTED_CHECKS) {
  console.error(`not ok - 🔴 断言条数对不上:实跑 ${checks} 条,应为 ${EXPECTED_CHECKS} 条(判据五)。`)
  process.exit(1)
}
if (failed) { console.error(`\n❌ 建店走正门:${failed}/${checks} 条未过`); process.exit(1) }
console.log(`\n✅ 建店走正门 ${checks} 条全过(与声明的 ${EXPECTED_CHECKS} 条一致)`)
