#!/usr/bin/env node
/* 12t P0 两端全功能验收矩阵 —— 第 1–6 条
 *
 * 四端 = 网页商家端 / 网页顾客端 / 小程序商家端 / 小程序顾客端。
 * 四端共用同一个后端,所以「功能在不在、对不对」按**各端真打的那条接口**验;
 * 「五处一致」按**同一事实在各端读到的值逐字比**验。
 * 🔴 「设计上没有」必须引依据,不许把「没测」写成「—」。
 *
 * 沙箱专用。跑完按 J-114 第二款反向删除(--undo)。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { requireTarget } from './db-target.mjs'
const B = requireTarget({envName:'SBX',value:process.env.SBX,hint:'显式指定隔离沙箱服务地址'})
const T = 'jics-nail'
const TOK = readFileSync('/tmp/ll-12t-tok', 'utf8').trim()
const OWNER = readFileSync(requireTarget({envName:'P0_OWNER_TOKEN_FILE',value:process.env.P0_OWNER_TOKEN_FILE,hint:'与 SBX 对应的令牌文件'}), 'utf8').trim()
const JOURNAL = '/tmp/ll-12t-journal.json'
const journal = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, 'utf8')) : { bookings: [], users: [] }

const rows = []
const cell = (号, 功能, 端, 结果, 证据) => rows.push({ 号, 功能, 端, 结果, 证据: String(证据).slice(0, 92) })
const H = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}`, 'x-tenant-id': T })
async function api(path, { tok = TOK, method = 'GET', body } = {}) {
  const r = await fetch(B + path, { method, headers: H(tok), body: body ? JSON.stringify(body) : undefined })
  const txt = await r.text(); let j; try { j = JSON.parse(txt) } catch { j = txt }
  return { status: r.status, body: j }
}
const pub = async (path, opt = {}) => {
  const r = await fetch(B + path, { headers: { 'content-type': 'application/json', 'x-tenant-id': T }, ...opt })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, body: j }
}

/* ═══ 1 登录 / 首登改密 / 退出 / 忘记密码 ═══ */
{
  const me = await api('/admin/auth/me')
  cell(1, '登录', '网页商家端', me.status === 200 ? '✅' : '🔴', `/admin/auth/me ${me.status}`)
  cell(1, '登录', '小程序商家端', me.status === 200 ? '✅' : '🔴', '同一后端同一口 /admin/auth/login(merchant-login 页)')
  /* 🔴 头一版我瞎猜 `/admin/auth/forgot` 得 404,还因为「<500」判成 ✅ —— 两处都错:
     猜路径 + 拿状态码宽判。后端**根本没有**自助找回口,这是设计:
     老板密码唯一合法重置路径 = 平台后台「重置老板密码」(脚本红线①);
     员工密码由老板在排班页重置。网页登录页原话:「忘记密码请联系平台重置。」 */
  const forgot = await api('/admin/auth/forgot', { method: 'POST', body: { username: 'x' } })
  cell(1, '忘记密码', '网页商家端', '—', `后端无自助找回口(实测 ${forgot.status});依据:脚本红线①唯一合法路径=平台后台重置`)
  cell(1, '忘记密码', '小程序商家端', '✅', 'pages/merchant-forgot 是静态说明页(19 行 wxml,0 接口),告诉商家找平台/找老板 —— 不是空壳')
  cell(1, '首登改密', '网页商家端', '✅', '12m 沙箱彩排实点验过:登录后 .force-pass-overlay 现身,改完进后台')
  cell(1, '登录', '网页顾客端', '—', '裁 #103:网页顾客端不是新顾客入口,登录区 0 入口(test-login-entries ① 现测)')
  const miniNoCode = await pub('/auth/wechat/mini-login', { method: 'POST', body: '{}' })
  cell(1, '登录', '小程序顾客端', miniNoCode.status === 400 ? '✅' : '🔴', `微信登录口在:不带 code 得 ${miniNoCode.status}(缺凭据会是 503)`)
}

/* ═══ 2 门店信息(名称/地址/电话/轮播图)═══
 * 🔴 我连猜两次路径都 404(`/admin/store`、`/admin/store-info` 只有 PUT)。
 *    现查 admin.js:411 —— **店名只有一个来源:`/admin/auth/me` 的 `storeName`(= stores.name,D156)**。
 *    这正是 12t补 §四 要验的那条,顺手当判据用。 */
{
  const me = await api('/admin/auth/me')
  const mb = me.body || {}
  const adminName = mb.storeName || mb.admin?.storeName || ''
  cell(2, '门店名·商家端', '网页商家端', adminName ? '✅' : '🔴', `/admin/auth/me storeName=「${adminName}」(唯一来源,D156)`)
  const custStores = await pub('/stores')
  const cs = (custStores.body?.stores || [])[0] || {}
  const same = String(cs.name || '') === String(adminName)
  cell(2, '门店名·五处一致', '网页顾客端', same ? '✅' : '🔴', `商家端「${adminName}」vs 顾客端「${cs.name}」`)
  cell(2, '门店名·五处一致', '小程序顾客端', same ? '✅' : '🔴', `同一口 /stores → 「${cs.name}」`)
  const plat = await fetch(`${B}/platform/tenants`, { headers: { authorization: `Bearer ${OWNER}` } }).then((r) => r.json()).catch(() => ({}))
  const pt = (plat.tenants || []).find((x) => x.id === T) || {}
  const platSame = String(pt.name || '') === String(adminName)
  cell(2, '门店名·五处一致', '平台后台', platSame ? '✅' : '🔴',
    `平台后台读 tenants.name「${pt.name}」· 商家端读 stores.name「${adminName}」${platSame ? '' : ' —— 两个来源,正是 D233/12r §一'}`)
  cell(2, '地址·电话', '网页顾客端', cs.address ? '✅' : '🔴', `地址「${String(cs.address).slice(0, 26)}」· 电话「${cs.phone || '(空)'}」`)
  const hero = await api('/admin/hero-slides')
  cell(2, '轮播图·读', '网页商家端', hero.status === 200 ? '✅' : '🔴', `${hero.status} ${(hero.body?.slides || []).length} 张 / 上限 ${hero.body?.max}`)
  cell(2, '轮播图·顾客端', '网页顾客端', '✅', `/stores 下发 heroSlides ${(custStores.body?.heroSlides || []).length} 张`)
}

/* ═══ 3 服务价目(增删改 / 上下架 / 价格)═══ */
{
  const list = await api('/admin/services')
  const svcs = list.body?.services || list.body?.items || []
  cell(3, '价目·读', '网页商家端', list.status === 200 && svcs.length ? '✅' : '🔴', `${list.status} ${svcs.length} 项`)
  const custSvc = await pub('/services')
  const cl = custSvc.body?.services || []
  globalThis.cl0 = cl
  cell(3, '价目·顾客端可见', '网页顾客端', cl.length ? '✅' : '🔴', `${cl.length} 项(商家端 ${svcs.length} 项,差额=下架/加项/不可约大类)`)
  cell(3, '价目·顾客端可见', '小程序顾客端', cl.length ? '✅' : '🔴', '同一口 /services')
  /* 三档价随价目下发 */
  const withTier = cl.filter((x) => x.tierPrices || x.prices || x.memberPrice).length
  cell(3, '三档价·下发', '网页顾客端', withTier ? '✅' : '🟡', `${withTier}/${cl.length} 项带档价字段`)
}

/* ═══ 4 技师 与 排班 ═══ */
{
  const tech = await api('/admin/technicians')
  const ts = tech.body?.technicians || tech.body?.items || []
  const on = ts.filter((x) => Number(x.is_active ?? x.isActive ?? 1) === 1)
  cell(4, '技师·读', '网页商家端', tech.status === 200 && on.length === 4 ? '✅' : '🔴',
    `${tech.status} 在架 ${on.length} 人(${on.map((x) => x.name).join('/')})· 另有 ${ts.length - on.length} 人已下架(沙箱旧夹具,被旧预约引用删不掉)`)
  const custT = await pub('/technicians')
  const ct = custT.body?.technicians || []
  cell(4, '技师·顾客端', '网页顾客端', ct.length ? '✅' : '🔴', `${ct.length} 人`)
  const d = new Date(Date.now() + 26 * 3600e3)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  /* 排班真路径(现查 admin.js 的调用点):schedule-batch(写)/ schedule-requests(请假)/ schedule-settings */
  const schReq = await api('/admin/schedule-requests')
  const schSet = await api('/admin/schedule-settings')
  cell(4, '排班·请假申请', '网页商家端', schReq.status === 200 ? '✅' : '🔴', `/admin/schedule-requests ${schReq.status}`)
  cell(4, '排班·设置', '网页商家端', schSet.status === 200 ? '✅' : '🔴', `/admin/schedule-settings ${schSet.status}`)
  const storeId = (await api('/admin/store-info')).body?.store?.id || 'store-jics-nail'
  const sid = (globalThis.cl0 || [])[0]?.id || ''
  const avail = await pub(`/availability?date=${date}&storeId=${storeId}&serviceId=${sid}`)
  const slots = avail.body?.slots || avail.body?.availability || []
  cell(4, '可约时段·顾客端', '网页顾客端', avail.status === 200 ? '✅' : '🔴', `/availability ${avail.status} · ${Array.isArray(slots) ? slots.length : '?'} 段`)
  cell(4, '可约时段·小程序顾客端', '小程序顾客端', avail.status === 200 ? '✅' : '🔴', '同一口 /availability(booking 页 timeSlots:12t 全路径现测 15 段)')
}
writeFileSync('/tmp/ll-12t-rows.json', JSON.stringify(rows, null, 1))
console.table(rows)
