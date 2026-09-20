/* 签署文件留档 —— 判据(10b §四)
 *
 * 🔴 这一件的全部价值在于**它能当证据**,所以判据不是附属品,是主体。
 * 七条底线每条**两面验**(J-91:夹具先证明自己能揭发;J-58①:造不出阳性 = 没验过)。
 *
 * corner case 覆盖(报告纪律:列出覆盖了哪几类):
 *   ① 边界:0 页 / 21 页 / 恰好 20 页 / title 61 字
 *   ② 空态:没有文件时列表回什么、空态句从哪来
 *   ③ 越权:🔴 跨店 · 技师越界 · 顾客令牌打 /admin · 不登录 —— 四种各一条,且各带阳性对照
 *   ④ 幂等:重复作废回 409,不产生第二条留痕
 *   ⑤ 异常输入:类型不在白名单 / other 不填名 / 非图片 / 空 data / 悬空 docId
 *   ⑥ 最低层:🔴 直连库 DELETE —— 触发器必须 ABORT(J-71 判别式)
 * 缺的:并发时序(这一件没有抢同一个资源的路径,两份文件互不影响)—— 如实写明。
 *
 * ⚠️ standalone:bash apps/api/run-all-tests.sh signed-docs
 */
import { assertTestTarget } from './test-guard.mjs'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const { requireOwnerToken } = await import('./owner-token.mjs')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const TOKEN = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const RUN = Date.now().toString(36)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, token = TOKEN, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra, ...(options.headers || {}) },
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}
const db = new DatabaseSync(process.env.TEST_DB_PATH || '')
/* 1×1 PNG —— 判据要的是「收不收得下、排不排得对」,不是图好不好看 */
/* 🔴 本批我在**同一个毛病上栽了三次**:⑥e(test-backup-wal)、④c3、⑨a ——
   都是「扫源码时把注释里的**提及**当成代码里的**执行**」(J-61①)。
   第三次就不再逐条打补丁了:所有源码扫描统一过 `codeOnly()`,注释先剥掉。
   注释里怎么写案底都不算数,**只有真会跑的那一行算**。 */
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const modSrcEarly = codeOnly(readFileSync(join(ROOT, 'apps/api/signed-docs.mjs'), 'utf8'))
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/* ══ 夹具:两家店(A 用来做正事,B 用来做跨店阳性)· 各一位顾客 · A 店一位技师+账号 ══ */
async function makeShop(tag) {
  const tid = `sd-${tag}-${RUN}`
  const made = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `签档测试店${tag}${RUN}`, plan: 'chain' }) })
  if (made.status !== 201) throw new Error(`建店失败 ${JSON.stringify(made.data)}`)
  const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
  const tech = await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `技师${tag}${RUN}`, isActive: true }) }, TOKEN, H)
  const catId = ((await request('/admin/pricing/categories', {}, TOKEN, H)).data.categories || [])[0]?.id
  const svc = await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `签档项目${tag}${RUN}`, nameEn: 'x', priceCents: 18000, baseDurationMin: 60, categoryId: catId }) }, TOKEN, H)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
  const bk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `签档顾客${tag}${RUN}`, phone: `139${tag.charCodeAt(0)}${RUN.slice(-6)}`, serviceId: svc.data.service.id, technicianId: tech.data.technician.id, date: today, time: '10:00' }) }, TOKEN, H)
  const userId = bk.data.booking?.user?.id || bk.data.booking?.userId || ''
  return { tid, H, technicianId: tech.data.technician.id, serviceId: svc.data.service.id, userId, today }
}
const A = await makeShop('a')
const B = await makeShop('b')
check('夹具:两家店各一位顾客(A 用来做正事,B 用来做跨店阳性)', Boolean(A.userId && B.userId), `${A.userId} / ${B.userId}`)

/* A 店再建一位「没服务过这位顾客」的技师 —— 技师锁要**造得出阳性**才算验过 */
const tech2 = await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `旁观技师${RUN}`, isActive: true }) }, TOKEN, A.H)
async function staffTokenFor(technicianId, H) {
  let c = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId }) }, TOKEN, H)
  if (c.status === 409) {
    const list = (await request('/admin/staff-accounts', {}, TOKEN, H)).data.accounts
    c = await request(`/admin/staff-accounts/${list.find((r) => r.technicianId === technicianId).id}/reset-password`, { method: 'POST' }, TOKEN, H)
  }
  const login = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: c.data.username, password: c.data.initialPassword }) }, null, H)
  const t0 = login.data.auth.accessToken
  const np = `Np-${RUN}-${technicianId.slice(-4)}`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: c.data.initialPassword, newPassword: np, confirmPassword: np }) }, t0, H)
  return (await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: c.data.username, password: np }) }, null, H)).data.auth.accessToken
}
const servedTok = await staffTokenFor(A.technicianId, A.H)      // 服务过 A.userId
const strangerTok = await staffTokenFor(tech2.data.technician.id, A.H)  // 没服务过任何人
check('夹具:两个员工令牌(一个服务过这位顾客,一个没有)', Boolean(servedTok && strangerTok))

/* ══ ② 空态(图:「还没有签署文件 / 拍照或从相册上传」)══ */
const empty = await request(`/admin/customers/${A.userId}/signed-docs`, {}, TOKEN, A.H)
check('②a 空态:列表回 0 份', empty.status === 200 && empty.data.docs.length === 0, JSON.stringify(empty.data).slice(0, 120))
check('②b 🔴 空态那两句由**后端**给(前端零拼串):「还没有签署文件」/「拍照或从相册上传」',
  empty.data.emptyText === '还没有签署文件' && empty.data.emptyHint === '拍照或从相册上传', JSON.stringify(empty.data).slice(0, 160))
check('②c 三种类型由后端下发,且显示名以合同图 v2 为准(价格表确认书,**不是护理同意书**)',
  empty.data.types.map((t) => t.key).join(',') === 'rights,pricelist,other'
  && empty.data.types[1].label === '价格表确认书'
  && empty.data.types[2].label === '其他 · 自己写名字', JSON.stringify(empty.data.types))

/* ══ ⑤ 异常输入 + ① 边界 ══ */
const mk = (body, token = TOKEN, H = A.H, uid = A.userId) =>
  request(`/admin/customers/${uid}/signed-docs`, { method: 'POST', body: JSON.stringify(body) }, token, H)
check('⑤a 类型不在白名单 → 400', (await mk({ docType: 'whatever', pages: [PNG] })).status === 400)
check('⑤b 🔴 `other` 不填名字 → 400(**后端是最终闸**,判据五;前端拦只算体验)',
  (await mk({ docType: 'other', pages: [PNG] })).status === 400)
check('①a 边界:0 页 → 400', (await mk({ docType: 'rights', pages: [] })).status === 400)
check('①b 边界:21 页 → 400', (await mk({ docType: 'rights', pages: Array(21).fill(PNG) })).status === 400)
check('⑤c 非图片的 data: → 400', (await mk({ docType: 'rights', pages: ['data:text/plain;base64,aGk='] })).status === 400)
check('⑤d 根本不是 data: → 400', (await mk({ docType: 'rights', pages: ['https://example.com/x.png'] })).status === 400)
check('①c 边界:title 61 字 → 400', (await mk({ docType: 'other', title: '名'.repeat(61), pages: [PNG] })).status === 400)
check('⑤e 悬空顾客 id → 404', (await mk({ docType: 'rights', pages: [PNG] }, TOKEN, A.H, `ghost-${RUN}`)).status === 404)

/* ══ 建三份:两种默认可见 + other 默认不可见 ══ */
const d1 = await mk({ docType: 'rights', pages: [PNG, PNG] })
check('建一份权益书(2 页)→ 201', d1.status === 201 && d1.data.doc.pageCount === 2, JSON.stringify(d1.data).slice(0, 160))
const d2 = await mk({ docType: 'pricelist', pages: [PNG] })
const d3 = await mk({ docType: 'other', title: `店里自己的表${RUN}`, pages: [PNG] })
check('⑤f 口径⑤「默认私密」落到库里:rights/pricelist → customer_visible=1,other → 0',
  d1.data.doc.customerVisible === true && d2.data.doc.customerVisible === true && d3.data.doc.customerVisible === false,
  JSON.stringify([d1.data.doc.customerVisible, d2.data.doc.customerVisible, d3.data.doc.customerVisible]))
check('⑤g 上传那一格的开关能当场改(图 v2:`other` 也能手动给看)',
  (await mk({ docType: 'other', title: `给顾客看的${RUN}`, pages: [PNG], customerVisible: true })).data.doc.customerVisible === true)
check('⑤h `other` 的显示名取 title(不是写死「其他」)', d3.data.doc.title === `店里自己的表${RUN}`, d3.data.doc.title)

/* ══ ⑦ 多页顺序稳定 ══ */
const add = await request(`/admin/signed-docs/${d1.data.doc.id}/pages`, { method: 'POST', body: JSON.stringify({ page: PNG }) }, TOKEN, A.H)
check('⑦a 加一页 → page_count 2→3', add.status === 201 && add.data.doc.pageCount === 3, JSON.stringify(add.data).slice(0, 120))
const det = await request(`/admin/signed-docs/${d1.data.doc.id}`, {}, TOKEN, A.H)
check('⑦b 🔴 页按 page_no 顺序出,且页数对得上(不是靠插入顺序碰巧对)',
  det.data.pages.length === 3 && det.data.pages.map((p) => p.pageNo).join(',') === '1,2,3', JSON.stringify(det.data.pages.map((p) => p.pageNo)))
check('⑦c 取第 2 页拿到的就是第 2 页', (await request(`/admin/signed-docs/${d1.data.doc.id}/pages/2`, {}, TOKEN, A.H)).data.pageNo === 2)
check('⑦d 取第 9 页 → 404(不许回落到第 1 页)', (await request(`/admin/signed-docs/${d1.data.doc.id}/pages/9`, {}, TOKEN, A.H)).status === 404)

/* ══ ③ 越权四种,每种都带阳性对照 ══ */
check('③a 🔴 不登录 → 拿不到(D194/D201 同族)',
  [401, 403].includes((await request(`/admin/signed-docs/${d1.data.doc.id}`, {}, null, A.H)).status))
check('③a反 **反向守**:同一条请求带 owner 令牌 → 200(否则上面那个拒是「口不存在」不是「守住了」)',
  (await request(`/admin/signed-docs/${d1.data.doc.id}`, {}, TOKEN, A.H)).status === 200)
check('③b 🔴 跨店:B 店的头去取 A 店的 doc → 404(措辞:那个东西对他不该存在)',
  (await request(`/admin/signed-docs/${d1.data.doc.id}`, {}, TOKEN, B.H)).status === 404)
check('③b反 **反向守**:B 店取自己的 doc → 201/200(证明 B 这条路本身是通的)',
  (await mk({ docType: 'rights', pages: [PNG] }, TOKEN, B.H, B.userId)).status === 201)
check('③c 🔴 技师越界:没服务过这位顾客的员工 → 404',
  (await request(`/admin/signed-docs/${d1.data.doc.id}`, {}, strangerTok, A.H)).status === 404)
check('③c反 **反向守**:服务过这位顾客的员工 → 200(口径④:技师也能传能看)',
  (await request(`/admin/signed-docs/${d1.data.doc.id}`, {}, servedTok, A.H)).status === 200)
/* 🔴 判据二「读写两道闸」:上面三条验的是**读**,下面三条验**写** —— service_notes 正是写口漏了一整批 */
check('③d 🔴 写口同样守:没服务过的员工**建**一份 → 404', (await mk({ docType: 'rights', pages: [PNG] }, strangerTok)).status === 404)
check('③d反 **反向守**:服务过的员工建一份 → 201', (await mk({ docType: 'rights', pages: [PNG] }, servedTok)).status === 201)
check('③e 🔴 写口跨店:B 店的头往 A 店顾客身上建 → 404', (await mk({ docType: 'rights', pages: [PNG] }, TOKEN, B.H, A.userId)).status === 404)

/* ══ ④ 作废:留痕三样齐 · 原因必填 · 幂等 ══ */
check('④a 🔴 作废不写原因 → 400(后端拦,不是前端拦)',
  (await request(`/admin/signed-docs/${d2.data.doc.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '   ' }) }, TOKEN, A.H)).status === 400)
const voided = await request(`/admin/signed-docs/${d2.data.doc.id}/void`, { method: 'POST', body: JSON.stringify({ reason: `换了价格表${RUN}` }) }, TOKEN, A.H)
check('④b 作废成功,状态句由后端给:`已作废`', voided.status === 200 && voided.data.doc.statusText === '已作废', JSON.stringify(voided.data.doc).slice(0, 180))
const vrow = db.prepare('SELECT voided_at, voided_by, void_reason, status FROM signed_docs WHERE id = ?').get(d2.data.doc.id)
check('④c 🔴 留痕**三样都在**(少一样这条就该红)',
  vrow.status === 'voided' && Boolean(vrow.voided_at) && Boolean(vrow.voided_by) && vrow.void_reason === `换了价格表${RUN}`, JSON.stringify(vrow))
/* 🔴 复发登记的永久护栏:④c 第一次跑就咬出 `voided_by` 是空串(OWNER_TOKEN 那条路不带身份字段)。
   只修那一处不够 —— 下面两条守的是「这一类」:留痕字段**永不为空**,而且源头不许再用 `|| ''` 兜底。 */
check('④c2 🔴 同一族:`created_by_name` 也不许是空串(建的时候就得说得出是谁)',
  Boolean(db.prepare('SELECT created_by_name FROM signed_docs WHERE id = ?').get(d1.data.doc.id).created_by_name),
  JSON.stringify(db.prepare('SELECT created_by, created_by_name FROM signed_docs WHERE id = ?').get(d1.data.doc.id)))
/* 🔴 这条尺子我写错过一次,如实记:第一版扫的是「模块里任何 `|| ''`」,
   结果咬中的是 `shape()` 里的**读**路径(`uploadedBy: row.created_by_name || ''`)——
   而判据一管的是「**必须发生**的地方」,也就是**写**路径。**数错了对象,和 ⑥e 那次同一个毛病。**
   改成盯写路径:两处写留痕都必须过 `actorOf`,而 `actorOf` 说不出是谁时必须抛。 */
const writeSites = (modSrcEarly.match(/actorOf\(adminSession\)/g) || []).length
check(`④c3 🔴 两处写留痕都过 \`actorOf\`(建 2 处 + 作废 1 处 = 3,现为 ${writeSites})`,
  writeSites === 3 && /function actorOf/.test(modSrcEarly), String(writeSites))
check("④c4 🔴 而 `actorOf` 说不出是谁时**抛错**,不是写空串(判据一:要么显式报错,要么断言它真发生了)",
  /throw apiError\(500, 'ACTOR_UNKNOWN'/.test(modSrcEarly)
  && !/actorOf[\s\S]{0,400}?return\s*''/.test(modSrcEarly))
check('④c5 🔴 反向守:主钥匙那条路**确实**不带身份字段(否则上面两条是在守一个不存在的问题)',
  /provider: 'demo-token'/.test(readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8'))
  && /provider === 'demo-token'/.test(modSrcEarly))
check('④d 幂等:再作废一次 → 409,不产生第二条留痕',
  (await request(`/admin/signed-docs/${d2.data.doc.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '再来一次' }) }, TOKEN, A.H)).status === 409
  && db.prepare('SELECT void_reason FROM signed_docs WHERE id = ?').get(d2.data.doc.id).void_reason === `换了价格表${RUN}`)
check('④e 作废掉的不能再加页 → 400',
  (await request(`/admin/signed-docs/${d2.data.doc.id}/pages`, { method: 'POST', body: JSON.stringify({ page: PNG }) }, TOKEN, A.H)).status === 400)
check('④f 列表里作废那行的副文案由后端给(图:`YYYY-MM-DD · <人>作废`)',
  /^\d{4}-\d{2}-\d{2} · .+作废$/.test((await request(`/admin/customers/${A.userId}/signed-docs`, {}, TOKEN, A.H)).data.docs.find((d) => d.id === d2.data.doc.id).listMetaText),
  (await request(`/admin/customers/${A.userId}/signed-docs`, {}, TOKEN, A.H)).data.docs.find((d) => d.id === d2.data.doc.id).listMetaText)

/* ══ ⑥ 🔴 最低那一层:直连库删不掉(J-71 判别式)══ */
let delErr = ''
try { db.prepare('DELETE FROM signed_docs WHERE id = ?').run(d1.data.doc.id) } catch (e) { delErr = e.message }
check('⑥a 🔴 **绕过界面、绕过路由、直连库 DELETE —— 触发器 ABORT**(口径②:能删 = 能毁证)',
  /不许删/.test(delErr) && Boolean(db.prepare('SELECT id FROM signed_docs WHERE id = ?').get(d1.data.doc.id)), delErr || '(没抛错 —— 那一行真被删了)')
let delPageErr = ''
try { db.prepare('DELETE FROM signed_doc_pages WHERE doc_id = ?').run(d1.data.doc.id) } catch (e) { delPageErr = e.message }
check('⑥b 🔴 页也删不掉(只删页 = 留个空壳,照样是毁证)', /不许删/.test(delPageErr), delPageErr || '(页被删了)')
check('⑥c **反向守**:同一把 DELETE 打在一张没上锁的表上必须删得掉 —— 证明不是 db 句柄本身只读',
  (() => { try { db.exec('CREATE TABLE IF NOT EXISTS _sd_probe(id TEXT)'); db.prepare('INSERT INTO _sd_probe VALUES (?)').run('x'); db.prepare('DELETE FROM _sd_probe').run(); return true } catch { return false } })())
check('⑥d 没有任何 DELETE 路由(裁#104:守「不许存在」的合同,只断言它不存在)',
  !/method === 'DELETE'/.test(modSrcEarly))

/* ══ 🔴 红线:这 6 个口一行 `INSERT INTO users` 都没有 ══ */
const modSrc = modSrcEarly
check('🔴 红线:本模块**零** `INSERT INTO users` / `user_identities`(顾客端建号那条线一个字没碰)',
  !/INSERT\s+INTO\s+(users|user_identities)/i.test(modSrc))
/* 🔴 探针**拼出来**,不许在源码里留下一行长得像「真的在执行」的 SQL。
   第一版我直接写了完整那一行,`test-fixture-front-door` 把它数成了「夹具直连库贴」的第 24 处,
   把只许降的欠账棘轮顶破。**判据自己的探针不是被测对象**(J-61②)——
   仓里现成写法就是拆开再 join(`test-backup-wal` ②c 那条),照它。 */
const userInsertProbe = ['db.prepare(\'INSERT ', 'INTO ', 'users (id) VALUES (?)\')'].join('')
check('🔴 红线反向守:这把尺子咬得动(拿一行真的 INSERT 喂它必须中)',
  /INSERT\s+INTO\s+(users|user_identities)/i.test(userInsertProbe))
check('🔴 本模块一个公开口都不开(第二步才做顾客端):全部路径以 `/admin/` 开头',
  (modSrc.match(/path\.match\(\/\^\\\/([a-z]+)/g) || []).every((s) => s.includes('admin')), (modSrc.match(/\^\\\/[a-z-]+/g) || []).join(' '))

/* ══ ⑧ 分发契约:命中要回真值,否则同一个响应会被写两次 ══ */
check('⑧ 分发:不认的路径回 false(不吞别人的路由)',
  /return false/.test(modSrc) && /Boolean\(await handle/.test(modSrc))

/* ══ 表结构:两张表 + 两条触发器都真在库里 ══ */
const trg = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'signed_%' ORDER BY name").all().map((r) => r.name)
check('表结构:两条不许删触发器都在库里', trg.join(',') === 'signed_doc_pages_no_delete,signed_docs_no_delete', trg.join(','))
const cols = db.prepare("SELECT name FROM pragma_table_info('signed_docs')").all().map((r) => r.name)
check('表结构:`customer_visible` 列在(第二步顾客端要用,列先在,口径先定死)', cols.includes('customer_visible'), cols.join(','))

/* ══ ⑨ 前端那一层:浏览器现测抓到的两件,各配一条常驻护栏 ══
   🔴 这两条不是"顺手加的":都是**在店主会看到的那一层**(浏览器)跑出来才发现的(L1 末端验证律)。 */
const webSrc = codeOnly(readFileSync(join(ROOT, 'apps/web/customer-docs.js'), 'utf8'))
check('⑨a 🔴 不许再用 `window.owner` —— 浏览器现测它是 undefined(`admin.js` 里 owner 是词法全局,不挂 window)',
  !/window\.owner/.test(webSrc), '又出现了 window.owner,那条切走丢弃的守卫会再次变成摆设')
check('⑨b 🔴 反向守:这把尺子咬得动(喂它一行真的 window.owner 必须中)',
  /window\.owner/.test("if (window.owner && window.owner.selectedCustomerId !== id) return"))
check('⑨c 守卫仍然在(不是把 window.owner 删了了事):切走判断还在,且走的是裸 `owner`',
  /currentCustomerId\(\) !== customerId/.test(webSrc) && /try \{ return owner\.selectedCustomerId \}/.test(webSrc))
check('⑨d 🔴 前端零拼串:空态两句、状态句、列表副文案全部取后端字段,前端不许写死这些句子',
  !/还没有签署文件|拍照或从相册上传|已作废/.test(webSrc),
  '前端把后端该出的句子写死了(假数回落红线③)')
check('⑨e 🔴 前端**没有删除按钮**(口径②:只能作废)',
  !/删除|data-signed-delete/.test(webSrc))
check('⑨f `admin.js` 只留挂载点:签署文件的实现一行都不在巨型文件里',
  (() => { const a = codeOnly(readFileSync(join(ROOT, 'apps/web/admin.js'), 'utf8'))
    return /renderSignedDocsBlock\(customer\.id/.test(a) && !/data-signed-upload|openUpload|signed-doc-row/.test(a) })())

/* ══ ⑩ 双端同批律 + 一份数据两端渲染律 ══════════════════════════
   🔴 店主 08-28 立的双端同批律:「凡新做一个功能,若它在另一端也存在,必须同一批做完两端。
   不许网页先做、小程序后补 —— 后补 = 永远不补。」
   小程序商家端**确实有同一个页面**(`pages/merchant/customer-profile`),所以同批做了。
   这一组验的是**渲染链闭合**:api.js 映射 → 页面 setData 字段 → wxml `{{}}` 绑定,断一节就红。 */
const mpApi = codeOnly(readFileSync(join(ROOT, 'miniprogram/utils/api.js'), 'utf8'))
const mpJs = codeOnly(readFileSync(join(ROOT, 'miniprogram/pages/merchant/customer-profile/index.js'), 'utf8'))
const mpWxml = readFileSync(join(ROOT, 'miniprogram/pages/merchant/customer-profile/index.wxml'), 'utf8')
check('⑩a 🔴 小程序商家端**同一批做了**(双端同批律):四个口都在 api.js 且都导出了',
  ['getSignedDocs', 'createSignedDoc', 'getSignedDoc', 'voidSignedDoc']
    .every((f) => new RegExp(`function ${f}\\(`).test(mpApi) && new RegExp(`\\b${f},`).test(mpApi)))
check('⑩b 🔴 两端打的是**同一条**路径(不是各写一份)',
  /admin\/customers\/\$\{encodeURIComponent\(userId\)\}\/signed-docs/.test(mpApi)
  && /admin\/signed-docs\/\$\{encodeURIComponent\(docId\)\}\/void/.test(mpApi))
check('⑩c 渲染链闭合:页面真调了它 → setData 进了字段 → wxml 真绑了这些字段',
  /api\.getSignedDocs\(/.test(mpJs) && /docsEmptyText:/.test(mpJs)
  && /\{\{docsEmptyText\}\}/.test(mpWxml) && /\{\{item\.statusText\}\}/.test(mpWxml)
  && /\{\{item\.profileMetaText\}\}/.test(mpWxml))
check('⑩d 🔴 小程序端**也是零拼串**:空态句/状态句不许写死在页面里(两端必须说同一句话)',
  !/还没有签署文件|拍照或从相册上传|已作废|有效</.test(codeOnly(mpWxml)) && !/还没有签署文件/.test(mpJs))
check('⑩e 🔴 小程序端**也没有删除**(口径②两端同守)',
  !/删除|deleteSignedDoc/.test(mpJs) && !/删除/.test(codeOnly(mpWxml)) && !/deleteSignedDoc/.test(mpApi))
check('⑩f 🔴 `wx.*` 一律有 fail 处理(波及面回归律④):本页新增的两处异步调用都带了',
  (mpJs.match(/wx\.(chooseMedia|showModal)\(/g) || []).length === 2
  && (mpJs.match(/fail: ?\(/g) || []).length >= 2)
check('⑩g 小程序单页 ≤ 600 行(公约③):现为 ' + readFileSync(join(ROOT, 'miniprogram/pages/merchant/customer-profile/index.js'), 'utf8').split('\n').length,
  readFileSync(join(ROOT, 'miniprogram/pages/merchant/customer-profile/index.js'), 'utf8').split('\n').length <= 600)

/* ══ ⑪ 血缘护栏:搬出去的名字,调用方一个都不许掉队 ══════════════
   🔴 案底(本批,全量回归咬出来的,不是我自己想起来的):
   (甲) 抽取把 COS 那一族搬进 `cos-upload.mjs` 之后,我只解构了 `cosPutObject` ——
   而 `/admin/store-clock` 的自检块还在用 `cosConfigured()` / `cosUploadAllowed()`,
   那条接口当场 500 `cosConfigured is not defined`。
   **根因是我没做血缘清单**(波及面回归律①:改共享件必交「全仓使用方 + 逐个验证证据」)。
   这条判据把那一步变成机械的:模块导出的每个名字,只要 local-server 的**代码里**用到,
   就必须出现在解构里。下一次搬迁,漏一个就红。 */
const cosSrc = readFileSync(join(ROOT, 'apps/api/cos-upload.mjs'), 'utf8')
const srvCode = codeOnly(readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8'))
const exported = (cosSrc.match(/return \{([^}]*)\}/g) || []).pop()
  ?.replace(/[{}]|return /g, '').split(',').map((x) => x.trim()).filter(Boolean) || []
const destructured = (srvCode.match(/const \{([^}]*)\} = createCos\(/) || [])[1]
  ?.split(',').map((x) => x.trim()).filter(Boolean) || []
const usedButMissing = exported.filter((n) =>
  new RegExp(`\\b${n}\\s*\\(`).test(srvCode) && !destructured.includes(n))
check(`⑪a 🔴 血缘:cos-upload 导出 ${exported.length} 个;local-server **代码里**调到的都解构了(缺 ${usedButMissing.length} 个)`,
  usedButMissing.length === 0, usedButMissing.join(', '))
check('⑪b 🔴 反向守:这把尺子咬得动 —— 从解构里拿掉一个仍被调用的名字,必须报缺',
  (() => {
    const shrunk = destructured.filter((n) => n !== 'cosConfigured')
    return exported.filter((n) => new RegExp(`\\b${n}\\s*\\(`).test(srvCode) && !shrunk.includes(n)).length === 1
  })())
check(`⑪c 覆盖面:确实取到了导出名单与解构名单(两个都为空时上面那条会假绿)`,
  exported.length >= 3 && destructured.length >= 1, `导出 ${exported.length} · 解构 ${destructured.length}`)

console.log(`\n✅ 签署文件留档 ${checks} 条全过`)
