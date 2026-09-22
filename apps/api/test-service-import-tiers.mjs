/* 价目表导入:三档价 + 商家自导(D212 / D214,店主 11o 裁,2026-09-23)
 *
 * ══ D212 ══
 * 模板原来只认**一个**「价格」,而项目本身早就有四档价(`service_prices.tier_key` = list/share/member/course)。
 * 北京店那份印刷稿**每项三个价**(原价 / 分享价 / 会员价)—— 模板吃不下,抄进来就丢两档。
 * 🔴 五列都可空:空的就只写 list,**老模板照样能用**(行为向后兼容,J-107)。
 * 🔴 倒挂报红:原价 ≥ 分享价 ≥ 会员价 是价目表的常识;倒挂**多半是抄串了行**,
 *    整批退回让人看一眼,比默默导进去、等顾客按会员价买到比原价还贵的东西强。
 *
 * ══ D214 ══
 * 店主:「以后这种操作我要能在商家配置后台自己做。」
 * 现在唯一的「上传导入」是知识库 FAQ 那条,价目表只能平台代导。
 * 🔴 **复用同一个 dryRun/execute,不另写一份解析** —— 两份解析必然分叉,而这一份管的是钱。 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || 'owner-demo-token'
const read = (f) => readFileSync(join(ROOT, f), 'utf8')
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

let checks = 0, failed = 0
function check(name, ok, extra = '') {
  checks++
  if (ok) console.log(`ok ${checks} - ${name}`)
  else { failed++; console.log(`not ok ${checks} - ${name}${extra ? ' :: ' + extra : ''}`) }
}
const H = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-owner-token': TOKEN }
async function post(path, body, extraHeaders = {}) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { ...H, ...extraHeaders }, body: JSON.stringify(body) })
  let d = null
  try { d = await r.json() } catch { d = null }
  return { status: r.status, data: d }
}
const HEAD5 = ['大类', '项目名', '价格', '分享价', '会员价', '疗程价', '疗程次数', '加做项']
const dry = (rows, headers = HEAD5) => post('/admin/services/import', { headers, rows })

/* ══ ① D212 三档价收得进来 ══ */
const okRun = await dry([['美甲', '三档验项', '200', '180', '160', '', '', '否']])
const row0 = okRun.data?.report?.ok?.[0]
check('①a 三档价都收进来了(list/share/member 各有值)',
  row0?.priceCents === 20000 && row0?.shareCents === 18000 && row0?.memberCents === 16000, JSON.stringify(row0))
check('①b 疗程价空 ⇒ 不写那一档(空是「没这一档」,不是 0)',
  row0?.courseCents === 0, String(row0?.courseCents))
const addonRun = await dry([['美甲', '加项验项', '50', '', '', '', '', '是']])
check('①c `加做项=是` ⇒ item_kind=addon(加项永不见客,规则①)',
  addonRun.data?.report?.ok?.[0]?.isAddon === true, JSON.stringify(addonRun.data?.report?.ok?.[0]))
const courseRun = await dry([['美甲', '疗程验项', '300', '', '', '2400', '10', '否']])
check('①d 疗程价 + 次数一起收', courseRun.data?.report?.ok?.[0]?.courseCents === 240000
  && courseRun.data?.report?.ok?.[0]?.courseTimes === 10, JSON.stringify(courseRun.data?.report?.ok?.[0]))

/* ══ ② 🔴 倒挂报红(11o 点名要阳性对照)══ */
const bad1 = await dry([['美甲', '倒挂A', '100', '90', '120']])
check('②a 🔴 会员价 > 原价 ⇒ 整批退回并点名是哪一行',
  bad1.data?.report?.blocked?.[0]?.kind === 'PRICE_LADDER' && bad1.data?.report?.blocked?.[0]?.line === 2,
  JSON.stringify(bad1.data?.report?.blocked))
check('②b 退回理由说得出**具体是哪两个数倒挂**(不是一句「价格有问题」)',
  /会员价 ¥120 > 原价 ¥100/.test(String(bad1.data?.report?.blocked?.[0]?.reason)), String(bad1.data?.report?.blocked?.[0]?.reason))
const bad2 = await dry([['美甲', '倒挂B', '100', '80', '90']])
check('②c 🔴 会员价 > 分享价(都不超原价)也要报 —— 阶梯是三档之间的,不只是跟原价比',
  bad2.data?.report?.blocked?.[0]?.kind === 'PRICE_LADDER', JSON.stringify(bad2.data?.report?.blocked))
check('②d 🔴 一行有问题 ⇒ **整批不进库**(半批进库最难收拾)',
  bad1.data?.report?.willImport === 0, String(bad1.data?.report?.willImport))
/* 🟢 反向守:一把「对什么都说倒挂」的刀会把正常价目表全拦下来 */
check('②e 🟢 **反向守**:正常的三档价不许被误判成倒挂',
  (okRun.data?.report?.blocked || []).length === 0, JSON.stringify(okRun.data?.report?.blocked))
const half = await dry([['美甲', '半疗程', '300', '', '', '', '10', '否']])
check('②f 写了疗程次数却没疗程价 ⇒ 退回(半个配置比没有更坏)',
  half.data?.report?.blocked?.[0]?.kind === 'COURSE_HALF', JSON.stringify(half.data?.report?.blocked))

/* ══ ③ 🔴 向后兼容:老模板(只有「价格」一列)照样能用 ══ */
const oldTpl = await post('/admin/services/import', { headers: ['大类', '项目名', '价格'], rows: [['美甲', '老模板项', '120']] })
check('③a 🔴 老模板照样过(五列都可空 —— 抽取必须行为等价,J-107)',
  oldTpl.data?.report?.ok?.[0]?.priceCents === 12000 && (oldTpl.data?.report?.blocked || []).length === 0,
  JSON.stringify(oldTpl.data?.report))
check('③b 老模板那一行三档价都是 0(没写就是没这一档)',
  oldTpl.data?.report?.ok?.[0]?.shareCents === 0 && oldTpl.data?.report?.ok?.[0]?.memberCents === 0)

/* ══ ④ D214 商家自己导 —— 权限与「试跑不落库」 ══
   🔴 复用同一份解析:判据钉住「没有第二个 dryRun/execute 的实现」。 */
const impSrc = codeOnly(read('apps/api/import-services.mjs'))
const srv = codeOnly(read('apps/api/local-server.mjs'))
check('④a 商家口住在 import-services.mjs(巨型文件只留一行分发)',
  /function ownerRoute\(/.test(impSrc) && /serviceImportApi\.ownerRoute\(/.test(srv))
const oneDry = (impSrc.match(/function dryRun\(/g) || []).length === 1
const oneExec = (impSrc.match(/function execute\(/g) || []).length === 1
const reuses = /body\.dryRun === false \? execute\(/.test(impSrc)
check('④b 🔴 **复用同一个 dryRun/execute**,没有第二份解析', oneDry && oneExec && reuses,
  JSON.stringify({ oneDry, oneExec, reuses }))
check('④c 平台那条老口还在(两条口共用一份解析,不是把老口搬走了)',
  /path\.endsWith\('\/import\/services'\)/.test(srv))

const staff = await post('/admin/auth/login', { username: 'avalin', password: 'nope' })
check('④d 夹具:员工登录这条路在(下面那条 403 才有意义)', staff.status === 401 || staff.status === 200, String(staff.status))
/* 用「没有 owner 身份」的请求打那条口:平台令牌走的是 isPlatform,不是 adminSession.role */
const noAuth = await fetch(`${BASE}/admin/services/import`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ headers: HEAD5, rows: [] }),
})
check('④e 🔴 越权:不带身份打商家导入口 ⇒ 401/403', [401, 403].includes(noAuth.status), String(noAuth.status))

/* ══ ⑤ 试跑不落库 ══ */
const before = (await (await fetch(`${BASE}/admin/pricing/items`, { headers: H })).json().catch(() => ({}))).items?.length ?? -1
await dry([['美甲', '试跑不落库验项', '199', '', '']])
const after = (await (await fetch(`${BASE}/admin/pricing/items`, { headers: H })).json().catch(() => ({}))).items?.length ?? -2
check('⑤a 夹具有效:价目列表读得到(读不到的话下面那条相等是「没测到」)', before >= 0, String(before))
check('⑤b 🔴 **试跑不落库**:跑完项目数一个没变', before === after, `${before} → ${after}`)

/* ══ ⑥ 🔴 时长 0 不许被 `||` 吞掉(2026-09-23 实战抓到,静默失败器族)══
 *
 * 原来写的是 `Number(at('duration')) || 60` —— **`0` 是假值**,于是
 * 「填了 0」和「没填」在代码眼里是同一件事,`0` 被默默换成 60。
 * 案发现场:北京店那份 CSV 里「足部美甲加收」时长写的就是 **0**
 * (11r 明写「足部加收 时长 0、加价 100」—— 它是整单加收,不占时段),
 * 而试跑报告显示它是 60。**一个店主填了的值,被判据默默改掉了。**
 * 🔴 而这种错**不会让任何断言变红** —— 它只会让排班里凭空多出一个小时。 */
{
  const zero = await dry([['美甲', '零时长项', '100', '', '', '', '', '是']], ['大类', '项目名', '价格', '分享价', '会员价', '疗程价', '疗程次数', '加做项', '时长'])
  check('⑥a 夹具:这一行本身是可导的(不然下面那条 0 是「没测到」)',
    (zero.data?.report?.ok || []).length === 1, JSON.stringify(zero.data?.report))
  const withZero = await dry([['美甲', '零时长项', '100', '', '', '', '', '是', '0']], ['大类', '项目名', '价格', '分享价', '会员价', '疗程价', '疗程次数', '加做项', '时长'])
  check('⑥b 🔴 **时长填 0 ⇒ 落 0**(不是被 `||` 吞成 60)',
    withZero.data?.report?.ok?.[0]?.durationMin === 0, String(withZero.data?.report?.ok?.[0]?.durationMin))
  const empty = await dry([['美甲', '空时长项', '100', '', '', '', '', '否', '']], ['大类', '项目名', '价格', '分享价', '会员价', '疗程价', '疗程次数', '加做项', '时长'])
  check('⑥c 🟢 **反向守**:时长真没填 ⇒ 仍然给默认 60(不是把 0 和空一起改成 0)',
    empty.data?.report?.ok?.[0]?.durationMin === 60, String(empty.data?.report?.ok?.[0]?.durationMin))
  const real = await dry([['美甲', '八十分钟项', '100', '', '', '', '', '否', '80']], ['大类', '项目名', '价格', '分享价', '会员价', '疗程价', '疗程次数', '加做项', '时长'])
  check('⑥d 🟢 **反向守**:填了别的数照样是那个数(证明 ⑥b 不是「一律落 0」)',
    real.data?.report?.ok?.[0]?.durationMin === 80, String(real.data?.report?.ok?.[0]?.durationMin))
  const junk = await dry([['美甲', '乱时长项', '100', '', '', '', '', '否', 'abc']], ['大类', '项目名', '价格', '分享价', '会员价', '疗程价', '疗程次数', '加做项', '时长'])
  check('⑥e 填了但不是数 ⇒ 按没填处理(60),不落 NaN',
    junk.data?.report?.ok?.[0]?.durationMin === 60, String(junk.data?.report?.ok?.[0]?.durationMin))
  /* 🔴 用 `codeOnly` 剥注释:第一版直接扫全文,咬到的是**我自己注释里引用的那句原文** ——
     「数提及而不是数执行」,本仓栽过五次的同一个坑,这是第六次。 */
  const src2 = codeOnly(read('apps/api/import-services.mjs'))
  check('⑥f 🔴 代码里不许再出现 `Number(at(.duration.)) || ` 那种写法(静默失败器族)',
    !/Number\(at\('duration'\)\)\s*\|\|/.test(src2),
    (src2.match(/.{0,40}at\('duration'\).{0,30}/g) || []).join(' | '))
}

const EXPECTED_CHECKS = 25
if (checks !== EXPECTED_CHECKS) {
  console.error(`not ok - 🔴 断言条数对不上:实跑 ${checks} 条,应为 ${EXPECTED_CHECKS} 条(判据五)。`)
  process.exit(1)
}
if (failed) { console.error(`\n❌ 价目表导入三档价:${failed}/${checks} 条未过`); process.exit(1) }
console.log(`\n✅ 价目表导入三档价 + 商家自导 ${checks} 条全过(与声明的 ${EXPECTED_CHECKS} 条一致)`)
