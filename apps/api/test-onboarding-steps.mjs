/* D197 第一段 · 新店配置五步灯(店主 11s补 §二.3 · 11t §三,2026-09-23)
 *
 * 店主原话:「现在的配置界面我看不出商家配置到哪一环。」
 * 合同图《有迹新店入驻向导》画的是五步 + 每步状态灯 —— 11e 盘点表现扫:**至今一行代码没有**。
 *
 * 🔴 本套件的两条要害:
 *   ① **每盏灯一条阳性对照** —— 只验「亮了」不算数:得证明它在该灭的时候会灭,
 *      否则一盏永远绿的灯和一张贴纸没区别(J-58①)。
 *   ② **第五盏恒灰** —— 提审清单只活在文档里,没有机器可读的来源。
 *      **没有数据源的灯不许亮**:亮绿是撒谎,亮红是冤枉。
 *      这里钉一条守着,哪天有人偷偷让它绿,当场红。 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || 'owner-demo-token'
const read = (f) => readFileSync(join(ROOT, f), 'utf8')
const codeOnly = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

let checks = 0, failed = 0
function check(name, ok, extra = '') {
  checks++
  if (ok) console.log(`ok ${checks} - ${name}`)
  else { failed++; console.log(`not ok ${checks} - ${name}${extra ? ' :: ' + extra : ''}`) }
}
const H = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-owner-token': TOKEN }
async function req(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } })
  let d = null
  try { d = await r.json() } catch { d = null }
  return { status: r.status, data: d }
}
const mkTenant = (id, extra = {}) => req('/platform/tenants', {
  method: 'POST',
  body: JSON.stringify({ name: `五步灯验店 ${id}`, id, plan: 'free', initialTerm: 'trial30', currency: 'CNY', timezone: 'Asia/Shanghai', ...extra }),
})
const stepsOf = async (tid) => {
  const ov = await req('/platform/overview')
  return (ov.data?.progress || []).find((p) => p.id === tid) || null
}
const lampOf = (p, key) => (p?.steps || []).find((s) => s.key === key) || null

const T0 = `lamp-${Date.now().toString(36)}`
check('①a 夹具:建店成功', (await mkTenant(T0)).status === 201)
let p = await stepsOf(T0)
check('①b 新店出现在进度表里(取不到的话下面全是「没测到」)', Boolean(p), JSON.stringify(p))
check('①c 五盏灯都在,顺序固定', (p?.steps || []).map((s) => s.key).join(',') === 'store,pricing,owner,wecom,launch',
  (p?.steps || []).map((s) => s.key).join(','))

/* ══ 灯 1 建店:平台建店只填了 name/currency/timezone,没填地址电话 ⇒ 应当 pending ══ */
check('② 灯1 建店:地址电话没填 ⇒ **pending**(不是 done)',
  lampOf(p, 'store')?.state === 'pending' && /地址/.test(lampOf(p, 'store')?.note || ''), JSON.stringify(lampOf(p, 'store')))
const T1 = `lampfull-${Date.now().toString(36)}`
await mkTenant(T1, { city: '北京市朝阳区某路 1 号', phone: '18500000001' })
check('②反 🟢 **阳性对照**:地址电话都填了 ⇒ **done**(证明这盏灯不是永远 pending)',
  lampOf(await stepsOf(T1), 'store')?.state === 'done', JSON.stringify(lampOf(await stepsOf(T1), 'store')))
/* 🔴 占位值那一条:`Address TBD` 不是空,但它也不是地址(11j/11k 那条律) */
const T2 = `lamptbd-${Date.now().toString(36)}`
await mkTenant(T2, { city: 'Address TBD', phone: 'Phone TBD' })
check('②b 🔴 填的是占位值(`Address TBD`)⇒ 仍然 **pending** —— 占位值不算填了',
  lampOf(await stepsOf(T2), 'store')?.state === 'pending', JSON.stringify(lampOf(await stepsOf(T2), 'store')))

/* ══ 灯 2 经营规则:新店没有服务项目 ⇒ pending;导一行 ⇒ done ══ */
check('③ 灯2 经营规则:没有服务项目 ⇒ **pending**',
  lampOf(p, 'pricing')?.state === 'pending', JSON.stringify(lampOf(p, 'pricing')))
/* 走**平台代导**那条口:商家口 `/admin/services/import` 认的是登录态的租户,
   不是 `x-tenant-id` 头(我第一版写错了,③反 当场红 —— 夹具没把项目导进那家店)。 */
await req(`/platform/tenants/${T0}/import/services`, {
  method: 'POST',
  body: JSON.stringify({ dryRun: false, headers: ['大类', '项目名', '价格'], rows: [['美甲', '灯验项目', '100']] }),
})
const afterImport = lampOf(await stepsOf(T0), 'pricing')
check('③反 🟢 **阳性对照**:导了一个项目 ⇒ **done**(证明这盏灯会变)',
  afterImport?.state === 'done' && /1 个服务项目/.test(afterImport?.note || ''), JSON.stringify(afterImport))

/* ══ 灯 3 老板账号:建店即建账号,但没改密 ⇒ pending(初始密码还在用 = 门还没交出去) ══ */
check('④ 灯3 老板账号:建了但没首登改密 ⇒ **pending**(不是 done)',
  lampOf(p, 'owner')?.state === 'pending' && /还没首登改密/.test(lampOf(p, 'owner')?.note || ''),
  JSON.stringify(lampOf(p, 'owner')))

/* ══ 灯 4 企微接入:没填 kfid ⇒ pending;填了 ⇒ done;🔴 填空格不算 ══ */
check('⑤ 灯4 企微接入:没填客服号 ⇒ **pending**', lampOf(p, 'wecom')?.state === 'pending', JSON.stringify(lampOf(p, 'wecom')))
await req(`/platform/tenants/${T0}/wecom-kfid`, { method: 'PUT', body: JSON.stringify({ openKfid: '   ' }) })
check('⑤b 🔴 填的是空格 ⇒ 仍然 **pending**(D132 口径:未填则进线拒收,不许放松)',
  lampOf(await stepsOf(T0), 'wecom')?.state === 'pending', JSON.stringify(lampOf(await stepsOf(T0), 'wecom')))
/* 🔴 客服号**全局唯一**(一个 kfid 只能绑一家店,绑过就 409 KFID_TAKEN)。
   第一版我写死 `wkTestKfid001` —— 主档与门关档共用同一个库连跑两遍,
   第二遍换了租户 id 就撞 409,于是灯没亮、判据红。**夹具里不许有全局唯一的写死值。** */
const KFID = `wkTestKfid-${T0}`
const kfPut = await req(`/platform/tenants/${T0}/wecom-kfid`, { method: 'PUT', body: JSON.stringify({ openKfid: KFID }) })
check('⑤c 夹具自证:这次 PUT 真的成了(没成的话下面那条 done 是「没测到」)',
  kfPut.status === 200, `${kfPut.status} ${JSON.stringify(kfPut.data)}`)
check('⑤反 🟢 **阳性对照**:填了真客服号 ⇒ **done**',
  lampOf(await stepsOf(T0), 'wecom')?.state === 'done', JSON.stringify(lampOf(await stepsOf(T0), 'wecom')))

/* ══ 灯 5 🔴 恒灰 ══ */
const launch = lampOf(await stepsOf(T0), 'launch')
check('⑥a 🔴 **灯5 恒灰**:state = `unavailable`(不是 done,也不是 pending)',
  launch?.state === 'unavailable', JSON.stringify(launch))
check('⑥b 🔴 句子说清**为什么**灰 —— 不是留白,是实话',
  /尚未接入系统/.test(launch?.note || ''), String(launch?.note))
const modSrc = codeOnly(read('apps/api/onboarding-steps.mjs'))
check('⑥c 🔴 代码里第五盏**没有任何一条路能返回 done/pending/blocked** —— 哪天有人偷偷让它亮,这条红',
  /function stepLaunch\(\)\s*\{\s*return \{ state: 'unavailable'/.test(modSrc),
  (modSrc.match(/function stepLaunch[\s\S]{0,200}?\}/) || [''])[0].slice(0, 160))
check('⑥d 🟢 **反向守**:它确实在五盏里(不是干脆不显示)—— 店主要看见「这一环还没接上」',
  (p?.steps || []).some((s) => s.key === 'launch'))

/* ══ ⑦ 「配到哪一环」那句话由后端出,前端零判断 ══ */
check('⑦a 后端出 summary,而且指的是第一个没完成的环',
  /配到第 1 环:建店/.test(p?.summary || ''), String(p?.summary))
const plat = codeOnly(read('apps/web/platform.html'))
check('⑦b 🔴 前端**零判断**:直接贴 `st.state` / `st.label` / `st.note` / `p.summary`,自己不算',
  /DOT\[st\.state\]/.test(plat) && /esc\(st\.label\)/.test(plat) && /esc\(p\.summary\)/.test(plat))
/* 🔴 `plat` 已经 codeOnly 过,但那几个词也出现在**我写的 HTML 注释**里 ——
   codeOnly 剥的是 `<!-- -->`,所以这里安全;真要防的是**前端代码里**出现判词。
   第一版没剥注释就扫,咬到自己写的注释(「数提及不是数执行」第七次)。 */
check('⑦c 🔴 前端没有自己判「算不算配好了」的分支(那会变成两端两份口径)',
  !/配到第 \$\{|还差:\$\{|state\s*===\s*'done'/.test(plat),
  (plat.match(/.{0,30}(配到第|还差:|state\s*===).{0,20}/g) || []).join(' | '))
check('⑦d 🟢 **反向守**:四种灯色都有定义(少一种会让某盏灯变成默认灰,看不出区别)',
  /done:/.test(plat) && /pending:/.test(plat) && /blocked:/.test(plat) && /unavailable:/.test(plat))

const EXPECTED_CHECKS = 21
if (checks !== EXPECTED_CHECKS) {
  console.error(`not ok - 🔴 断言条数对不上:实跑 ${checks} 条,应为 ${EXPECTED_CHECKS} 条(判据五)。`)
  process.exit(1)
}
if (failed) { console.error(`\n❌ 五步灯:${failed}/${checks} 条未过`); process.exit(1) }
console.log(`\n✅ 新店配置五步灯 ${checks} 条全过(与声明的 ${EXPECTED_CHECKS} 条一致)`)
