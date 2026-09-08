/* D169 判据 · 三家 mock 店「灌满了没有」(店主 05t 段 2 第 7 条)
 *
 * ══ 这把刀验的是**效果**,不是「脚本跑完没报错」══
 * 判据一律打**活服务的接口**,读老板首页真正吃的那三个口 —— 脚本 exit 0 证明不了
 * 首页有东西看(L1 末端验证律:在店主会看到的那一层验)。
 *
 * ══ 为什么它**不进** `run-all-tests.sh` ══
 * 店主 05t 段 2 第 8 条:「回归不许依赖这批种子,否则以后删种子会连累回归」。
 * 回归跑的是自己新建的临时库,里面没有也不该有演示数据。
 * 这把刀是**沙箱专用**:`SEED_BASE=http://127.0.0.1:4310 node apps/api/test-seed-rich.mjs`。
 * 「回归没引用这把种子」由 `tools/pre-regression.sh` 里一条**静态判据**常驻守着。
 *
 * ══ 造病(店主《突变自检条》)══
 * `--knife=<tenantId>` 把那家店今天的种子单**临时挪走**(改 tenant_id 前缀,跑完原样还回去),
 * 断言这把刀当场变红且点得出是哪一家 —— 刀不咬人就不算刀。
 */
const BASE = process.env.SEED_BASE || ''
if (!BASE) {
  console.error('\n❌ 拒绝执行:要显式给 SEED_BASE(评测/走查只打沙箱)。\n   例:SEED_BASE=http://127.0.0.1:4310 node apps/api/test-seed-rich.mjs\n')
  process.exit(2)
}
const TOKEN = process.env.OWNER_TOKEN || 'owner-demo-token'
const TENANTS = ['lucky-luxe', 'jics-store', 'luvia-bj']
const PERIODS = ['today', 'week', 'month', 'year']

/* ══ 造病先落刀(店主《刀留痕律》:没有「刀已落」的凭据,「刀没红」一律按「刀没落」处理)══
   `--knife=<tenantId>`:把那家店的种子单临时挪到一个假租户名下,**再跑判据**,
   跑完不管红不红都原样还回去(finally 保底,J-34:还原不许靠 git)。 */
const KNIFE = (process.argv.find((a) => a.startsWith('--knife=')) || '').split('=')[1] || ''
let knifeDb = null
let knifeMoved = 0
if (KNIFE) {
  const { DatabaseSync } = await import('node:sqlite')
  const health = await fetch(`${BASE}/health`).then((r) => r.json())
  const path = health.dataFile
  if (!String(path).includes('/sandbox-data/')) { console.error(`造病只许在沙箱库上做,现在指的是 ${path}`); process.exit(2) }
  knifeDb = new DatabaseSync(path)
  knifeMoved = knifeDb.prepare("UPDATE bookings SET tenant_id = ? WHERE tenant_id = ? AND demo_seed = 'rich-v1'").run(`${KNIFE}--knife`, KNIFE).changes
  console.log(`[刀] 已把 ${KNIFE} 的 ${knifeMoved} 张种子单挪到 ${KNIFE}--knife 名下(落刀凭据) —— 这一跑**应该红**`)
  if (!knifeMoved) { console.error('[刀] 一张都没挪动 —— 刀没落下,这一跑不算验过'); knifeDb.close(); process.exit(2) }
}
const restoreKnife = () => {
  if (!knifeDb) return
  const back = knifeDb.prepare('UPDATE bookings SET tenant_id = ? WHERE tenant_id = ?').run(KNIFE, `${KNIFE}--knife`).changes
  console.log(`[刀] 已原样还回 ${KNIFE}:${back} 张(挪走 ${knifeMoved} 张)`)
  knifeDb.close(); knifeDb = null
}
process.on('exit', restoreKnife)

/* 库层只读句柄:小记没有读接口,只能开库数(见下面那一条的说明) */
const { DatabaseSync: RO } = await import('node:sqlite')
const dbFile = (await fetch(`${BASE}/health`).then((r) => r.json())).dataFile
const roDb = new RO(dbFile, { readOnly: true })
const noteCount = (tid) => roDb.prepare('SELECT COUNT(*) AS n FROM service_notes WHERE tenant_id = ?').get(tid).n

let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const storeToday = async (tid) => {
  const d = await req('/admin/store-clock', tid)
  return (d && d.today) || new Date().toISOString().slice(0, 10)
}
const req = async (path, tid) => {
  const r = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': tid, 'x-tenant-id': tid } })
  try { return await r.json() } catch { return null }
}

for (const tid of TENANTS) {
  /* ① 四个维度的营收都得有数 —— 「今天有、本年空」那种是折线画不出来的 */
  for (const p of PERIODS) {
    const d = await req(`/admin/dashboard/pulse?period=${p}`, tid)
    const ms = (d && d.metrics) || []
    const rev = ms.find((m) => m.key === 'revenue')
    check(`${tid} · ${p} 营业收入 > 0`, Number(rev && rev.value) > 0, JSON.stringify(rev && rev.value))
    /* ② 六个指标里至少五个非 0(店主原话:「六个指标与五项待办都要非 0」,
       留一格余量是因为「总卡耗」在没有耗卡的店天然可以是 0) */
    if (p === 'today') {
      const nonZero = ms.filter((m) => Number(m.value) > 0).length
      check(`${tid} · 今日六指标里非 0 的 ≥5`, nonZero >= 5, `现是 ${nonZero}/${ms.length}`)
    }
    /* ③ 本年折线 12 个点不许是一条平的 0 线 */
    if (p === 'year') {
      const sp = (rev && rev.spark) || []
      const hit = sp.filter((x) => Number(x) > 0).length
      check(`${tid} · 本年折线 12 点,非 0 的 ≥8`, sp.length === 12 && hit >= 8, `${hit}/${sp.length}`)
    }
  }
  /* ④ 此刻三态各有、下一位非空 */
  const now = await req('/admin/dashboard/now', tid)
  check(`${tid} · 今日在做 ≥1`, Number(now && now.doing) >= 1, JSON.stringify(now && now.doing))
  check(`${tid} · 今日待到店 ≥2`, Number(now && now.waiting) >= 2, JSON.stringify(now && now.waiting))
  check(`${tid} · 今日已完成 ≥3`, Number(now && now.done) >= 3, JSON.stringify(now && now.done))
  check(`${tid} · 「下一位」有人`, Boolean(now && now.next && now.next.customer), JSON.stringify(now && now.next))
  /* D174:下一位的时间必须是**门店时区**的钟点。判据不锚具体几点(那随跑的时间变),
     锚的是「它落在营业时间那一段」—— UTC 原文会把北京店 10:00 说成 02:00,当场露馅。 */
  const hh = Number(String((now && now.next && now.next.time) || '').slice(0, 2))
  check(`${tid} · 下一位的钟点落在 08–22 点(不是 UTC 原文)`, hh >= 8 && hh <= 22, String(now && now.next && now.next.time))

  /* ⑤ 五项待办里至少三项有数;并且**每一项的来源表都得在**(D172 例外单独点名) */
  const todo = await req('/admin/dashboard/todo', tid)
  const items = (todo && todo.items) || []
  check(`${tid} · 五项待办恒返回`, items.length === 5, `现是 ${items.length} 项`)
  check(`${tid} · 待办里 >0 的 ≥3 项`, items.filter((x) => Number(x.n) > 0).length >= 3,
    items.map((x) => `${x.key}=${x.n}`).join(' '))
  /* 🔴 「≥3 项」这条**太松**:现测过 —— 把 quotePending 退回旧写法(数 'pending'),
     它掉到 0,而另外三项撑着,这条照样绿(店主《刀落了不红,先怀疑判据和夹具》)。
     所以逐项点名:种子保证这四项每一项都有数,少哪一项就点哪一项。
     `shiftApproval` 不在其中 —— 那张表本来就不存在(D172,待裁 #12),上面单独有一条守它。 */
  for (const key of ['aiHandoff', 'quotePending', 'notePending', 'dailyClose']) {
    const it = items.find((x) => x.key === key)
    check(`${tid} · 待办 ${key} > 0`, Number(it && it.n) > 0, JSON.stringify(it))
  }
  const dead = items.filter((x) => x.available === false).map((x) => x.key)
  check(`${tid} · 没有「表都不在」的待办项(例外只许 shiftApproval,待裁 #12)`,
    dead.every((k) => k === 'shiftApproval') && dead.length <= 1, dead.join(','))

  /* ⑥ AI 今日一句:落库了、而且是**今天**那条 */
  const ai = await req('/admin/dashboard/ai-line', tid)
  check(`${tid} · AI 今日一句有内容`, Boolean(ai && ai.line && ai.line.text), JSON.stringify(ai))

  /* ⑦ 顾客 ≥30 / 小记 ≥10 / 作品 ≥6 —— 顾客端与图库页也得有东西看 */
  const cus = await req('/admin/customers', tid)
  check(`${tid} · 顾客 ≥30`, ((cus && cus.customers) || []).length >= 30, String(((cus && cus.customers) || []).length))
  const gal = await req('/portfolio', tid)
  const works = (gal && (gal.works || gal.items)) || []
  check(`${tid} · 作品 ≥6`, works.length >= 6, String(works.length))
  /* ══ D170(店主 05u §四 + 夜班令6 段 1):**演示面必须干净** ══
     店主亲看旗舰店首页:「待报价 162」、下一位卡是「运营字段测试-mrm0lewr」、
     台面里是「闸测未来」「演示2-lucky-美睫储值户」。页面没错,是库里的垃圾被显示出来了。
     判据按**店主会看到的那几处**逐处扫:下一位卡 / 今日预约前三条 / 今日台面整份。
     🔴 认的是**痕迹形状**(测试/演示/闸测/mock/名字后面挂随机段),不是一份名单。 */
  const DIRTY = /(测试|演示|闸测|mock|storeless|-mr[a-z0-9]{6,}|[\u4e00-\u9fa5A-Za-z]-m[a-z0-9]{7,})/
  /* 🔴 只扫**店主眼睛看得到的那几个字段**,不扫整份 JSON:
     现测第一版把整份响应扔进正则,咬中的是 `tech_mt4ma32n_qiqibc` / `lash-lash-mt4ma32u`
     —— 那是**内部 id**,页面上一个字都不显示。判据要对着「界面上出现的字」,
     不是对着「响应里的字节」(判据律:能验渲染结果就别验中间产物)。 */
  const board = await req(`/admin/schedule-day?date=${encodeURIComponent(await storeToday(tid))}`, tid)
  const seen = (o) => [o && o.customerName, o && o.serviceName, o && o.name, o && o.title].filter(Boolean)
  const boardText = [...((board && board.bookings) || []).flatMap(seen),
    ...((board && board.technicians) || []).flatMap(seen)].join(' | ')
  const nowText = [now && now.next && now.next.customer, now && now.next && now.next.service,
    now && now.next && now.next.tech].filter(Boolean).join(' | ')
  const dirtyIn = (txt) => (String(txt).match(new RegExp(DIRTY.source, 'g')) || []).slice(0, 3).join(' | ')
  check(`${tid} · 「下一位」与今日预约里 0 处夹具痕迹`, !DIRTY.test(nowText), dirtyIn(nowText))
  check(`${tid} · 今日台面整份 0 处夹具痕迹`, !DIRTY.test(boardText), dirtyIn(boardText))
  /* 待办数值要像一家店,不是像一个积压的收件箱(店主原话:报价 ≤ 20) */
  const q = items.find((x) => x.key === 'quotePending')
  check(`${tid} · 待报价 ≤ 20(162 那种是历次评测积压,不是店里真有人在等)`, Number(q && q.n) <= 20, JSON.stringify(q))

  /* 小记只有写口(`POST /admin/service-notes`),**没有读列表的接口** ——
     所以这一条只能落到库上数。如实说明:这是判据里唯一一条不在接口层的,
     等哪天有了读口就该搬上去(判据也该往「店主看得见那一层」走)。 */
  check(`${tid} · 服务小记 ≥10(库层数,因为没有读列表的接口)`, noteCount(tid) >= 10, String(noteCount(tid)))
}

restoreKnife()
if (KNIFE) {
  /* 带刀跑:**红才算对**。全绿说明判据根本没在看那家店的数据(判据律:
     这条判据在缺陷存在时会不会照样绿?会,就是废判据)。 */
  if (!fails.length) { console.error(`\n🔴 造病白造了:挪走 ${KNIFE} 的 ${knifeMoved} 张单,${n} 项判据**一条都没红** —— 判据没在守。`); process.exit(1) }
  console.log(`\n✅ 造病验红:挪走 ${KNIFE} 的种子单后,${fails.length}/${n} 项红,点名如下:\n  - ${fails.join('\n  - ')}`)
  process.exit(0)
}
if (fails.length) { console.error(`\n❌ test-seed-rich ${fails.length}/${n} 项未过:\n  - ${fails.join('\n  - ')}`); process.exit(1) }
console.log(`\n✅ test-seed-rich 通过 ${n} 项(打的是 ${BASE})`)
