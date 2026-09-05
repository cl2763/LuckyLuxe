/* ③ 预约采集常驻套件(图 v1.2 §二;05h §三 定的合同)

   靶子是 05h 那三个基线数(12 通「想约」× 真模型):
   **到底 0/12 · 被丢 7 项表 10/12 · 中途进人工 7/12**。

   判据分两层(判据四:同一把刀要能分出哪层在守):
   ① 状态机层(纯模块,不起服务)—— 抽槽合并 / 只问缺的 / 一次一问 / 确认词形状
   ② 接线层(真起服务、真发消息)—— 查真可约 / 草稿只建一次 / 7 项表不许回来

   **造病三条**(05h 点名的):
   ㋐ 草稿改成每次新建 → 必须红
   ㋑ 去掉 `/availability` 直接 confirm → 必须红
   ㋒ 7 项表回来 → 必须红
   三条都在文件末尾,靠「刀留痕」打印注入点;刀没落 = 按没验过算。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertTestTarget } from './test-guard.mjs'
import { mergeSlots, nextMissing, isReadyToCheck, looksConfirm, looksReschedule, SLOT_KEYS,
  extractSlotsByRule, parseDate, parseTime, normalizeSlots, hasBookingSignal, periodOf } from './booking-intake.mjs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ══════════ ① 状态机层 ══════════ */

/* 合并:新句抽到的补进来,**抽不到的不许把已有的清掉**
   (顾客补一句「明天」不该把刚说的「美甲」冲没) */
check('①a 合并:新槽补入',
  mergeSlots({ serviceType: '美甲' }, { date: '周六' }).date === '周六')
check('①b 合并:空值不覆盖已有槽',
  mergeSlots({ serviceType: '美甲' }, { serviceType: '' }).serviceType === '美甲')
check('①c 合并:只认合同点名的五个槽',
  Object.keys(mergeSlots({}, { serviceType: '美甲', 乱来: 'x' })).every((k) => SLOT_KEYS.includes(k)))

/* 只问缺的、一次一问 —— **7 项表的反面**:任何一步只回一个待问槽 */
check('①d 一次一问:全空时只问 1 个',
  nextMissing({})?.key === 'serviceType')
check('①e 只问缺的:已有项目时跳到日期',
  nextMissing({ serviceType: '美甲' })?.key === 'date')
check('①f 三槽齐 → 不再问',
  nextMissing({ serviceType: '美甲', date: '周六', time: '15:00' }) === null)
check('①g 三槽齐才去 checking',
  isReadyToCheck({ serviceType: '美甲', date: '周六', time: '15:00' }) === true
  && isReadyToCheck({ serviceType: '美甲', date: '周六' }) === false)

/* 确认词:含糊的不算 —— 宁可多问一句,也不许替顾客把单建了 */
/* 顾客不会只回两个字 —— 「好的,就这个时间」这种带小尾巴的必须认得。
   现测栽过:整串锚定的 `^好的$` 让 12 通对话一张草稿都建不出来。 */
for (const yes of ['好的', '可以', '就这个', 'ok', '确认', '好的,就这个时间', '行,就这样吧', '好 就这个']) {
  check(`①h 确认词认得:「${yes}」`, looksConfirm(yes))
}
/* 反向守:开头像确认、其实在问事的,一律不许当确认(替顾客把单建了比多问一句坏得多) */
for (const no of ['嗯', '哦', '再说吧', '多少钱', '好的话要等多久', '好的话几点', '可以改时间吗']) {
  check(`①i 含糊/问句不当确认:「${no}」`, !looksConfirm(no))
}
check('①j 改期认得', looksReschedule('换个时间吧') && !looksReschedule('好的'))

/* 规则补槽:模型漏抽时兜底(也是 ㋐㋑ 两把刀能咬到 drafted 的前提) */
const T0 = '2026-09-04'
check('①k 补槽·项目', extractSlotsByRule('我想做个美甲', T0).serviceType === '美甲')
check('①l 补槽·相对日期', parseDate('明天', T0) === '2026-09-05')
check('①m 补槽·下午时间', parseTime('下午三点') === '15:00')
check('①n 补槽·半点', parseTime('晚上7点半') === '19:30')
check('①o 补槽·不许乱猜', parseDate('随便什么时候', T0) === '' && parseTime('看情况') === '')

/* 归一化:模型抽出来的槽是什么形状都得收得住。
   现测栽过 —— 模型把「周六」抽成 `"Saturday"`,原样喂给 /availability 就是 `Invalid time value`,
   12 通里 10 通因此转人工,而我自己的 catch 把原因吞了(静默失败器),只能靠猜。 */
for (const [raw, want] of [['Saturday', '2026-09-05'], ['tomorrow', '2026-09-05'], ['2026-09-08', '2026-09-08'], ['周六', '2026-09-05']]) {
  check(`①p 归一化日期:「${raw}」→ ${want}`, normalizeSlots({ date: raw }, T0).date === want,
    String(normalizeSlots({ date: raw }, T0).date))
}
for (const [raw, want] of [['15:00', '15:00'], ['下午三点', '15:00'], ['3pm', '15:00'], ['10 AM', '10:00']]) {
  check(`①q 归一化时间:「${raw}」→ ${want}`, normalizeSlots({ time: raw }, T0).time === want,
    String(normalizeSlots({ time: raw }, T0).time))
}
/* 反向守:归一不出来的**必须丢掉重问**,不许原样传给下游 */
check('①r 归一不出来的槽要丢掉(不许把垃圾传给 /availability)',
  normalizeSlots({ date: '胡说八道', time: '乱写' }, T0).date === undefined
  && normalizeSlots({ date: '胡说八道', time: '乱写' }, T0).time === undefined)

/* ── 边界:③ 什么时候该从报价采集手里接管 ──────────────────
   🔴 护栏(复发登记):头一版把「哈喽,想做美甲」也抢了 —— 而美甲是**需报价项目**,
   图 §二 明写「需报价的项目 → 转报价采集」。`test-working-memory` 当场咬红。
   这一组正反断言就是那次的永久护栏:**再想放宽接管条件,先在这里红一次。** */
const TB = '2026-09-04'
const takes = (t) => hasBookingSignal(t, TB, /想做|要做|做个/.test(t))
for (const t of ['我想预约', '想约个时间', '能约明天吗', '这周还有位子吗?', '帮我约个时间做美睫',
  '我想约周六做美甲',            // 弱信号 + 具体日期 = 真在挑时间
  '明天下午三点有空吗?']) {
  check(`①s 该接管:「${t}」`, takes(t))
}
/* 反向守:带「约」字但在问价/问时长的,一律不许抢 */
for (const t of ['哈喽,想做美甲', '想做美甲', '美甲多少钱', '大约多少钱', '延长大约要多久', '你们几点关门',
  /* 三条都是全量回归一刀一刀咬出来的,不是我自查出来的 —— 原样留在这儿当账 */
  '请问你们门店的营业时间是什么时候?地址在哪里?',   // test-business-hours
  '预约需要付定金吗?定金多少?',                     // test-intent-guards
  '你们店地址在哪里?怎么走?',                       // test-intent-guards
  /* 只报了项目、没给时间的「想约 X」——**需报价的项目先走报价采集**(图 §二) */
  '哈喽 想约美甲', '想约美甲,这款可以做吗', '你们周日营业吗?我想周日来做美甲']) {
  check(`①t 不许抢:「${t}」`, !takes(t))
}
check('①u 时段词认得', periodOf('周五下午都行') === '下午' && periodOf('随便') === '')

/* ══════════ ② 接线层(真服务) ══════════
   两店各跑,但两店**不是同一种景**(造景律:走查单要看的状态,自己造出来):
   · 配齐的店(lucky-luxe:有服务/技师/营业时间)—— 走到 drafted,验草稿与时段
   · 光店没配的店(本套件现建)—— 验它**不编时段、不建草稿**,如实转人工(空态) */
const api = async (p, tid, o = {}) => {
  const r = await fetch(`${BASE_URL}${p}`, {
    ...o,
    /* ⚠️ 换店的开关是 `x-admin-tenant-id`(闸门取 admin.tenantId),**不是** `x-tenant-id`。
       只发后者时请求照样按令牌那家店跑 —— 现测过:给空店发的话,
       conversationId 回来是 `wecom:lucky-luxe:...`,于是"空店"判据验的其实是配齐的店。 */
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner-demo-token',
      'x-admin-tenant-id': tid, 'x-tenant-id': tid, ...(o.headers || {}) },
  })
  return r.ok ? r.json().catch(() => null) : null
}
const plat = async (p, o = {}) => {
  const r = await fetch(`${BASE_URL}${p}`, {
    ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OWNER_TOKEN || 'owner-demo-token'}`, ...(o.headers || {}) },
  })
  return r.status
}
/* 端点是 `/admin/wechat/mock-chat-message`(matrix 那 66 项走的同一个口)。
   第一版我写的是 `/wecom/inbound` —— **那个路由根本不存在**,回 404,
   于是「不发 7 项表」靠着「回复是空串」一路绿着 —— 典型的零命中废判据。 */
const sayTo = async (tid, cid, content) =>
  api('/admin/wechat/mock-chat-message', tid, {
    method: 'POST',
    body: JSON.stringify({ externalUserId: cid, message: content, lang: 'zh', forceAi: true }),
  })
/* 草稿:全仓**没有** GET 列表口,拿计数验永远是 0(第一版就是这么绿的)——
   改成认回复里带的 `draftId`,再用真存在的 `GET /booking-drafts/:id` 回读一次。 */
const draftIdOf = (r) => r?.reply?.data?.draftId || null

/* 7 项表判据:**一句回复里同时问 ≥3 个槽 = 表**。
   不锚具体文案(判据不许锚在会变的字面量上),锚的是「一句话里塞了几个问题」。 */
const ASK_MARKS = [/几点|什么时间|时间/, /哪天|日期|哪一天/, /美甲还是美睫|做什么项目|项目/, /技师|指定/, /卸甲|延长|加项/]
const formLike = (t) => ASK_MARKS.filter((re) => re.test(String(t || ''))).length >= 3

const BARE = `bi3-${RUN}`
const bareOk = await plat('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: BARE, name: `预约采集空店${BARE}`, plan: 'chain' }) }) === 201
check('②0 造景:空配置店建出来了(造不出来按红,不许「造不出来就当过了」)', bareOk, BARE)

const RICH = 'lucky-luxe'

let sid = '', vid = '', dat = ''
/* ── 配齐的店:一句一问 → checking → 确认 → drafted ── */
{
  const tid = RICH
  const cid = `bi-${RUN}-r`
  const said = []
  let lastId = null
  const say = async (t) => {
    const r = await sayTo(tid, cid, t)
    lastId = draftIdOf(r)
    const txt = r?.reply?.data?.answerZh || ''
    said.push(txt)
    return { txt, r }
  }
  const a1 = await say('我想预约')
  check('②a 头一句不发 7 项表', !formLike(a1.txt), a1.txt.slice(0, 70))
  check('②b 头一句有回复(先证刀能咬)', Boolean(a1.txt))
  check('②c 头一句不建草稿', lastId === null)
  await say('做美甲')
  await say('明天')
  const a4 = await say('下午三点')
  check('②d 四轮都不发 7 项表', said.filter(formLike).length === 0, said.find(formLike)?.slice(0, 70) || '')
  check('②e 三槽齐后进 checking(报时段或如实说满)',
    /\d{1,2}[::]\d{2}|没位|约满|同事/.test(a4.txt), a4.txt.slice(0, 90))
  check('②f 未确认不建草稿', lastId === null, `id=${lastId}`)

  const ok = await say('好的')
  const id1 = lastId
  check('④a 确认后建了草稿', Boolean(id1), `答:${ok.txt.slice(0, 70)}`)
  const got = id1 ? (await api(`/booking-drafts/${encodeURIComponent(id1)}`, tid))?.bookingDraft : null
  check('④b 草稿能回读到', Boolean(got && got.id === id1), JSON.stringify(got || {}).slice(0, 80))

  /* 用**草稿自己**的门店/服务/日期去查 —— 拿「服务列表第一条」查等于查了另一个项目,
     集合永远空,判据就永远绿(第一版正是这么废掉的)。 */
  sid = got?.storeId || got?.store_id || ''
  vid = got?.serviceId || got?.service_id || ''
  dat = String(got?.date || got?.startsAt || '').slice(0, 10)
  const av = sid && vid && dat
    ? await api(`/availability?storeId=${encodeURIComponent(sid)}&serviceId=${encodeURIComponent(vid)}&date=${encodeURIComponent(dat)}`, tid)
    : null
  const times = new Set((av?.slots || []).flatMap((t) => (t.slots || []).map(String)))
  check('④c 可约集合非空(先证刀能咬)', times.size > 0, `store=${sid} service=${vid} date=${dat}`)
  const said15 = ok.txt.match(/([01]?\d|2[0-3]):(\d{2})/)
  check('④d 报出的时段在可约集合里', Boolean(said15) && times.has(said15[0]),
    said15 ? `说的 ${said15[0]},集合前四 ${[...times].slice(0, 4).join('/')}` : `回复里没时段:${ok.txt.slice(0, 60)}`)

  /* ㋐:再确认两次,拿到的必须是**同一个** id */
  const again = draftIdOf((await say('好的')).r)
  const yet = draftIdOf((await say('确认')).r)
  check('④e 复确认不复建草稿', Boolean(id1) && again === id1 && yet === id1, `id1=${id1} again=${again} yet=${yet}`)
}

/* ── 反向守:要一个**根本不可约**的钟点(凌晨三点),不许确认下来 ──
   没有这一条,「跳过 /availability 直接 confirm」那把刀砍下去毫无动静:
   顺路那通对话要的 15:00 本来就有位,查不查都一样。
   判据要能证伪你要证的那件事 —— 要证「真查了」,就得给一个查了才会拒的时间。 */
{
  const tid = RICH
  const cid = `bi-${RUN}-bad`
  for (const m of ['我想预约', '做美甲', '明天']) await sayTo(tid, cid, m)
  const r = await sayTo(tid, cid, '凌晨三点')
  const txt = r?.reply?.data?.answerZh || ''
  const ok2 = await sayTo(tid, cid, '好的')
  const txt2 = ok2?.reply?.data?.answerZh || ''
  const madeDraft = draftIdOf(ok2)

  /* 先证景造对了:拿**真**可约集合证明 03:00 确实不在里面,否则这条判据是空转的。
     (直接问集合,不去问营业时间表 —— 能验渲染结果就别验中间产物) */
  const av0 = sid && vid ? await api(`/availability?storeId=${encodeURIComponent(sid)}`
    + `&serviceId=${encodeURIComponent(vid)}&date=${encodeURIComponent(dat)}`, tid) : null
  const t0 = new Set((av0?.slots || []).flatMap((t) => (t.slots || []).map(String)))
  check('④f 造景可信:集合非空且 03:00 确实不在里面', t0.size > 0 && !t0.has('03:00'),
    `size=${t0.size} 前四 ${[...t0].slice(0, 4).join('/')}`)

  check('④g 不可约的钟点:不许建草稿', madeDraft === null, `draftId=${madeDraft} 答=${txt2.slice(0, 70)}`)
  check('④h 不可约的钟点:不许把 03:00 说成有位',
    !/0?3[::]00/.test(txt) || /没位|约满|同事|查不到|还剩/.test(txt), txt.slice(0, 90))
}

/* ── 光店没配的店:空态 —— 不许编时段、不许建草稿 ── */
if (bareOk) {
  const cid = `bi-${RUN}-b`
  let last = null
  for (const m of ['我想预约', '做美甲', '明天', '下午三点', '好的']) {
    last = await sayTo(BARE, cid, m)
  }
  const txt = last?.reply?.data?.answerZh || ''
  check('②g 空店:不建草稿', draftIdOf(last) === null, `id=${draftIdOf(last)}`)
  check('②h 空店:不编时段(零回落)—— 要么说查不到/转同事,要么不报具体钟点',
    !/\d{1,2}[::]\d{2}/.test(txt) || /查不到|同事|约满|排班/.test(txt), txt.slice(0, 90))
}

/* ══════════ ⑫ 采集中不许见谁都复读(⑤ 像人五通咬出来的)══════════
   🔴 案底:一进 collecting,顾客说什么都回「想约哪天呢?」——
   「我第一次来,有点紧张」「大概要多久」「谢谢你啦」全是这一句。
   规矩:**这一句没给出新槽,就不是在答我的问题** —— 让开,交回原流程去答。 */
{
  const tid = RICH
  const uid = `parrot-${RUN}`
  const a1 = (await sayTo(tid, uid, '我想预约'))?.reply?.data?.answerZh || ''
  const a2 = (await sayTo(tid, uid, '我第一次来,有点紧张'))?.reply?.data?.answerZh || ''
  const a3 = (await sayTo(tid, uid, '大概要多久'))?.reply?.data?.answerZh || ''
  check('⑫0 前置:第一句确实进了采集(问了个槽)', Boolean(a1), a1.slice(0, 40))
  check('⑫1 🔴 顾客说别的事,**不许原样复读同一句**', a2 !== a1, `两次都是:${a1.slice(0, 30)}`)
  check('⑫2 🔴 顾客问「大概要多久」,不许拿采集问题顶回去', a3 !== a1, `又是:${a1.slice(0, 30)}`)
  /* 反向守:真给了槽还是要接着采集(让开不等于把采集丢了) */
  const a4 = (await sayTo(tid, uid, '做美甲'))?.reply?.data?.answerZh || ''
  check('⑫3 反向守:真答了槽就接着往下问(让开没把采集状态丢掉)',
    Boolean(a4) && a4 !== a1, a4.slice(0, 40))
}

/* ══════════ ⑪ 30 分钟保留到期 → 回 idle 并留痕(图 §二)══════════
   到期不是「悄悄忘了」:状态回 idle,但**留下痕迹**(什么时候过的、从哪个态过的),
   下次才说得清「上次那单没留住」。 */
{
  const tid = RICH
  const uid = `stale-${RUN}`
  for (const m of ['我想预约', '做美甲', '明天']) await sayTo(tid, uid, m)
  const conv = `wecom:${tid}:${uid}`
  const { DatabaseSync } = await import('node:sqlite')
  const d5 = new DatabaseSync(process.env.TEST_DB_PATH || '/tmp/ll-ci-data.knife/lucky-luxe.sqlite')
  const before = JSON.parse(d5.prepare('SELECT state_json FROM ai_conversation_states WHERE conversation_id = ?').get(conv)?.state_json || '{}')
  check('⑪0 前置:采集中且盖了时间戳(没戳就无从判过期)',
    before.bookingStage === 'collecting' && Boolean(before.bookingTouchedAt),
    `stage=${before.bookingStage} at=${before.bookingTouchedAt}`)

  /* 把时间戳拨回 31 分钟前 —— 读时判,不等真时钟 */
  const stale = { ...before, bookingTouchedAt: new Date(Date.now() - 31 * 60000).toISOString() }
  d5.prepare('UPDATE ai_conversation_states SET state_json = ? WHERE conversation_id = ?').run(JSON.stringify(stale), conv)
  d5.close()

  const r = await sayTo(tid, uid, '下午三点')
  const txt = r?.reply?.data?.answerZh || ''
  const d6 = new DatabaseSync(process.env.TEST_DB_PATH || '/tmp/ll-ci-data.knife/lucky-luxe.sqlite')
  const after = JSON.parse(d6.prepare('SELECT state_json FROM ai_conversation_states WHERE conversation_id = ?').get(conv)?.state_json || '{}')
  d6.close()
  check('⑪1 过期后回 idle,旧槽清空(不拿半小时前的意向接着往下走)',
    after.bookingStage === 'idle' && !after.bookingSlots?.date,
    `stage=${after.bookingStage} slots=${JSON.stringify(after.bookingSlots)}`)
  check('⑪1b 如实告诉顾客「没留住」,不是装作无事发生',
    /留|放开|重新约|30 分钟/.test(txt), txt.slice(0, 60))
  check('⑪2 🔴 留痕在:记下了什么时候过的、从哪个态过的(不是悄悄抹掉)',
    Boolean(after.bookingExpiredAt) && after.bookingExpiredFrom === 'collecting',
    `at=${after.bookingExpiredAt} from=${after.bookingExpiredFrom}`)
  check('⑪3 反向守:过期不等于哑巴,这一句照样有回复', Boolean(txt), txt.slice(0, 50))
}

/* ══════════ ⑩ 店休 ≠ 约满(现测挖出来的:那天门店没开门,机器说「已经约满了」)══════════
   对顾客说不实的话比不回答更坏。店休就说店休,并且**把人留在对话里**(回 collecting 重问日期),
   不推给人工 —— 换一天就能约上的事,没必要惊动同事。 */
{
  const tid = RICH
  const { DatabaseSync } = await import('node:sqlite')
  const d4 = new DatabaseSync(process.env.TEST_DB_PATH || '/tmp/ll-ci-data.knife/lucky-luxe.sqlite')
  const store = d4.prepare('SELECT id FROM stores WHERE tenant_id = ? AND is_active = 1 LIMIT 1').get(tid)?.id || ''
  const closedRow = d4.prepare('SELECT weekday FROM business_hours WHERE store_id = ? AND is_closed = 1 LIMIT 1').get(store)
  d4.close()
  check('⑩0 前置:这店有休息日(没有就造不出这个态)', Boolean(store) && Boolean(closedRow), `store=${store} closed=${closedRow?.weekday}`)

  if (closedRow) {
    /* 找出下一个落在休息日的日期(按门店时区的星期几,不猜) */
    let target = ''
    for (let k = 1; k <= 8; k += 1) {
      const dt = new Date(Date.now() + k * 86400000)
      const wd = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', weekday: 'short' })
        .formatToParts(dt).find((x) => x.type === 'weekday')?.value
        .replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, (m) => ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[m])))
      if (wd === closedRow.weekday) { target = dt.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }); break }
    }
    check('⑩1 前置:找到了下一个休息日', Boolean(target), target)

    const uid = `closed-${RUN}`
    await sayTo(tid, uid, '我想预约')
    await sayTo(tid, uid, '做美甲')
    await sayTo(tid, uid, target)
    /* 三槽齐了才会去查可约 —— 只给日期的话机器还在问「几点」,压根走不到店休那一步 */
    const r = await sayTo(tid, uid, '下午三点')
    const txt = r?.reply?.data?.answerZh || ''
    check('⑩2 🔴 店休日:说的是「门店休息」,**不许说「约满了」**',
      /休息|不营业|没开门/.test(txt) && !/约满/.test(txt), txt.slice(0, 80))
    check('⑩3 店休不推人工(换一天就能约的事,别惊动同事)',
      r?.reply?.data?.handoffRequired !== true, `handoff=${r?.reply?.data?.handoffRequired}`)
    const r2 = await sayTo(tid, uid, '那明天呢')
    const txt2 = r2?.reply?.data?.answerZh || ''
    check('⑩4 反向守:换一天后照常往下走(没把人卡死在店休那句上)', Boolean(txt2) && txt2 !== txt, txt2.slice(0, 70))
  }
}

/* ══════════ ⑥ D135 三句反面(图 §六;05j 自述没逐条回归,05l 定为合同项)══════════
   报价段(quoted / expired)里顾客随口一句,**不许把状态带歪**:
   ① quoted 段问地址 → 只答地址,**不出草稿、报价状态不变**;
   ② expired 段问价   → 重新报价,`expires_at` **逐字节不变**(顾客的话不许改有效期);
   ③ 「周六可以吗」   → 先 checking 查真有位才 confirm,不许直接甩草稿。 */
{
  const { DatabaseSync } = await import('node:sqlite')
  const dbf = new DatabaseSync(process.env.TEST_DB_PATH || '/tmp/ll-ci-data.knife/lucky-luxe.sqlite')
  const tid = RICH
  const uid = `d135-${RUN}`
  await sayTo(tid, uid, '我想做美甲')                       // 让会话与报价单先存在
  const convId = `wecom:${tid}:${uid}`

  let qr = dbf.prepare('SELECT id FROM quote_requests WHERE conversation_id = ? AND tenant_id = ?').get(convId, tid)
  if (!qr) {
    const qid = `qr-d135-${RUN}`
    const now = new Date().toISOString()
    dbf.prepare(`INSERT INTO quote_requests (id, tenant_id, conversation_id, service_type, status, customer_message, created_at, updated_at)
      VALUES (?, ?, ?, 'nail', 'PENDING_STAFF', '想做手部美甲', ?, ?)`).run(qid, tid, convId, now, now)
    qr = { id: qid }
  }
  check('⑥0 造景:报价单挂上了这通会话(造不出来按红)', Boolean(qr?.id), String(qr?.id || ''))

  /* —— A 态 quoted —— */
  const mk = await api(`/admin/quote-requests/${qr.id}/mark-quoted`, tid, {
    method: 'POST', body: JSON.stringify({ priceCents: 128800, note: 'D135 夹具' }),
  })
  check('⑥1 前置:mark-quoted 成功(否则下面两条空转)', Boolean(mk?.expiresAt || mk?.quoteRequest), JSON.stringify(mk || {}).slice(0, 70))

  const beforeExp = dbf.prepare('SELECT expires_at FROM quote_requests WHERE id = ?').get(qr.id)?.expires_at || ''
  const addrReply = await sayTo(tid, uid, '你们店地址在哪里?')
  const addrData = addrReply?.reply?.data || {}
  check('⑥2 D135①:quoted 段问地址 → **不出草稿**', !addrData.draftId, `draftId=${addrData.draftId}`)
  const afterAddrExp = dbf.prepare('SELECT expires_at FROM quote_requests WHERE id = ?').get(qr.id)?.expires_at || ''
  check('⑥3 D135①:问地址不改报价有效期(逐字节)', afterAddrExp === beforeExp, `${beforeExp} → ${afterAddrExp}`)

  /* —— B 态 expired:把 expires_at 拨到过去(读时判,不等真时钟)—— */
  dbf.prepare('UPDATE quote_requests SET expires_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 3600000).toISOString(), qr.id)
  const expBefore = dbf.prepare('SELECT expires_at FROM quote_requests WHERE id = ?').get(qr.id)?.expires_at || ''
  const priceReply = await sayTo(tid, uid, '同款现在多少钱?')
  const priceText = priceReply?.reply?.data?.answerZh || ''
  const expAfter = dbf.prepare('SELECT expires_at FROM quote_requests WHERE id = ?').get(qr.id)?.expires_at || ''
  check('⑥4 🔴 D135②:expired 段问价,`expires_at` **逐字节不变**(顾客的话不许改有效期)',
    expAfter === expBefore, `${expBefore} → ${expAfter}`)
  check('⑥5 D135②:expired 段问价 → 不出草稿', !priceReply?.reply?.data?.draftId,
    `draftId=${priceReply?.reply?.data?.draftId}`)

  /* —— ③「周六可以吗」:必须先 checking —— */
  const satReply = await sayTo(tid, uid, '周六可以吗')
  const satData = satReply?.reply?.data || {}
  const satText = satData.answerZh || ''
  check('⑥6 D135③:「周六可以吗」→ 先查可约(报时段/说满/问缺项),**不直接甩草稿**',
    !satData.draftId, `draftId=${satData.draftId} 答=${satText.slice(0, 60)}`)
  dbf.close()
}

/* ══════════ ⑦ 无位分支:必须给「最近 3 个」且都在集合里 ══════════
   ②e 原来写的是「报时段**或**如实说满」—— 两头都算过,不可证伪。这里拆成各自可证的两条。 */
{
  const tid = RICH
  const uid = `full-${RUN}`
  for (const m of ['我想预约', '做美甲', '明天']) await sayTo(tid, uid, m)
  const r = await sayTo(tid, uid, '凌晨三点')        // 铁定不可约的钟点 → 必走无位分支
  const txt = r?.reply?.data?.answerZh || ''
  const times = [...txt.matchAll(/([01]?\d|2[0-3]):([0-5]\d)/g)].map((m) => m[0])
  check('⑦a 无位时**给出了**替代时段(不是只说一句"约满了")', times.length >= 1, txt.slice(0, 90))
  check('⑦b 替代时段**最多 3 个**(合同写的是最近 3 个)', times.length <= 3, `给了 ${times.length} 个:${times.join('/')}`)

  const conv = `wecom:${tid}:${uid}`
  const { DatabaseSync } = await import('node:sqlite')
  const d2 = new DatabaseSync(process.env.TEST_DB_PATH || '/tmp/ll-ci-data.knife/lucky-luxe.sqlite')
  const st = d2.prepare('SELECT state_json FROM ai_conversation_states WHERE conversation_id = ?').get(conv)
  d2.close()
  let slots = {}
  try { slots = JSON.parse(st?.state_json || '{}')?.bookingSlots || {} } catch { slots = {} }
  /* 🔴 `/admin/stores` **这个接口根本不存在**(回 NOT_FOUND)—— 我一直拿空 storeId 去查,
     于是集合恒空、⑦d 恒真。所以门店与服务都从库里现取,并且取**美甲**那条 ——
     机器走的是 `firstActiveService('nail')`,拿「列表第一条」会查成美睫,集合照样空。 */
  const d3 = new DatabaseSync(process.env.TEST_DB_PATH || '/tmp/ll-ci-data.knife/lucky-luxe.sqlite')
  const sid = d3.prepare('SELECT id FROM stores WHERE tenant_id = ? AND is_active = 1 ORDER BY name ASC LIMIT 1').get(tid)?.id || ''
  const vid = d3.prepare("SELECT id FROM services WHERE tenant_id = ? AND is_active = 1 AND UPPER(type) = 'NAIL' ORDER BY sort_order ASC LIMIT 1").get(tid)?.id || ''
  d3.close()
  const av = sid && vid && slots.date
    ? await api(`/availability?storeId=${encodeURIComponent(sid)}&serviceId=${encodeURIComponent(vid)}&date=${encodeURIComponent(slots.date)}`, tid)
    : null
  const set = new Set((av?.slots || []).flatMap((t) => (t.slots || []).map(String)))
  check('⑦c 先证刀能咬:那天的可约集合非空', set.size > 0, `date=${slots.date} size=${set.size}`)
  check('⑦d 🔴 报出来的每一个时段都在 `/availability` 集合里(一个不在就红)',
    times.length > 0 && times.every((t) => set.has(t)),
    `报 ${times.join('/')} · 集合前四 ${[...set].slice(0, 4).join('/')}`)
}

/* ══════════ ⑧ drafted 之后问别的:答得出,草稿仍只有一张 ══════════ */
{
  const tid = RICH
  const uid = `after-${RUN}`
  for (const m of ['我想预约', '做美甲', '明天', '下午三点']) await sayTo(tid, uid, m)
  const ok = await sayTo(tid, uid, '好的')
  const id1 = draftIdOf(ok)
  check('⑧0 前置:先建出一张草稿', Boolean(id1), `id=${id1}`)
  if (id1) {
    const addr = await sayTo(tid, uid, '你们店地址在哪里?')
    const hours = await sayTo(tid, uid, '营业时间是几点到几点')
    const aTxt = addr?.reply?.data?.answerZh || ''
    const hTxt = hours?.reply?.data?.answerZh || ''
    check('⑧a drafted 后问地址:**答得出**(不是沉默,也不是又建一张)', Boolean(aTxt) && !draftIdOf(addr),
      `draftId=${draftIdOf(addr)} 答=${aTxt.slice(0, 40)}`)
    check('⑧b drafted 后问营业时间:答得出且不复建', Boolean(hTxt) && !draftIdOf(hours),
      `draftId=${draftIdOf(hours)} 答=${hTxt.slice(0, 40)}`)
    const again = await sayTo(tid, uid, '好的')
    check('⑧c 问完别的再确认,拿到的还是**同一张**草稿', draftIdOf(again) === id1,
      `id1=${id1} again=${draftIdOf(again)}`)
  }
}

/* ══════════ ⑨ 每轮 aiUsage.calls 增量 = 1(反问档也是 1)══════════
   🔴 这条**不在这个套件里断言**,原因写清楚:回归跑的是 `AI_MODE=mock`,
   而 mock 这一路**根本不产生 usage**(`ai-utils` 里就是这么写的),计数恒为 0 ——
   在这里断言「增量 = 1」只会是一条永远红、或者被我改成永远绿的废判据。
   **真正的断言放在 ⑤ 正式评测那一跑**(真模型、沙箱库),那里 usage 是真的。
   这里只守住**管道还在**:`/health` 得给得出这个数,不然 ⑤ 到时候无从数起。 */
{
  const h = await (await fetch(`${BASE_URL}/health`)).json()
  check('⑨a 用量管道在:/health.aiUsage.calls 是个数(⑤ 真模型那跑才断言增量=1)',
    typeof h?.aiUsage?.calls === 'number', JSON.stringify(h?.aiUsage || {}))
}

/* ══════════ ⑭ 病6/病7:两处文案与「打听不是要约」(⑤ 像人五通读出来的)══════════ */
{
  const tid = RICH
  /* 病7:「想问问美甲」是来打听的,不许上来就追日期 —— **模型说 booking 也不算** */
  const uid = `browse-${RUN}`
  const r1 = await sayTo(tid, uid, '你好呀,想问问美甲')
  const t1 = r1?.reply?.data?.answerZh || ''
  check('⑭a 🔴 病7:「想问问美甲」不进采集(不许回「想约哪天呢?」)',
    !/想约哪天|大概几点|做美甲还是美睫/.test(t1), t1.slice(0, 60))
  check('⑭b 反向守:但它得**答点什么**,不是沉默', Boolean(t1), '(空回复)')
  /* 同一句加上具体时间,就该按约时间办 */
  const r2 = await sayTo(tid, `${uid}-2`, '想问问美甲,明天下午三点有位吗')
  const t2 = r2?.reply?.data?.answerZh || ''
  check('⑭c 反向守:打听里带了具体时间,照样进采集/查可约',
    /\d{1,2}[::]\d{2}|没位|约满|休息|几点|哪天/.test(t2), t2.slice(0, 60))

  /* 病6:确认后不许说「留着了」—— 05l 刚裁「草稿不占位,占位在落单」 */
  const bk = `hold-${RUN}`
  for (const m of ['我想预约', '做美甲', '明天', '下午三点']) await sayTo(tid, bk, m)
  const ok = await sayTo(tid, bk, '好的')
  const okTxt = ok?.reply?.data?.answerZh || ''
  check('⑭d 🔴 病6:确认后不许承诺「留着了」(草稿不占位)',
    Boolean(draftIdOf(ok)) && !/留着了/.test(okTxt), okTxt.slice(0, 70))
  check('⑭e 病6:得说清什么时候才算留位', /定金.*才算留位|记下了/.test(okTxt), okTxt.slice(0, 70))
}

/* ══════════ ⑬ 并发的两层底(05n 裁 (6) + 05l 那个错结论的更正)══════════
   🔴 我在 05l 报过「`booking_slots` 没有唯一索引,数据库拦不住」—— **错的**。
   它有内联 `UNIQUE (technician_id, starts_at)`;SQLite 为内联约束建的是**自动索引**,
   `sqlite_master.sql` 是 **NULL**,而我当初正是拿「sql 里含 UNIQUE」去筛的 ——
   **判据结构上看不见它要找的东西,我却拿空结果下了结论。**
   所以这条改用 `PRAGMA index_list`(它看得见自动索引),把这个教训钉住:
   谁要是哪天把这个约束去掉,这里立刻红。 */
{
  const { DatabaseSync } = await import('node:sqlite')
  const d5 = new DatabaseSync(process.env.TEST_DB_PATH || '/tmp/ll-ci-data.knife/lucky-luxe.sqlite')
  const idx = d5.prepare("PRAGMA index_list('booking_slots')").all()
  let hit = null
  for (const i of idx) {
    if (!i.unique) continue
    const cols = d5.prepare(`PRAGMA index_info('${i.name}')`).all().map((x) => x.name)
    if (cols.includes('technician_id') && cols.includes('starts_at')) hit = { name: i.name, cols }
  }
  d5.close()
  check('⑬a 🔴 双占的库层底还在:booking_slots 上有 (technician_id, starts_at) 唯一约束',
    Boolean(hit), `index_list 里没找到;现有:${idx.map((i) => `${i.name}(u=${i.unique})`).join(' ')}`)
  check('⑬b 这条底是**自动索引**(所以只查 sqlite_master.sql 的判据看不见它 —— 05l 那个错就出在这)',
    Boolean(hit) && /^sqlite_autoindex_/.test(hit.name), hit ? hit.name : '')

  /* 05n 裁 (6):多 writer 起手式落没落,从 /health 看得见 */
  const h = await (await fetch(`${BASE_URL}/health`)).json()
  check('⑬c 🔴 WAL 已开(没有它,两进程抢同一时段输的那个直接 500 database is locked)',
    String(h?.dbConcurrency?.journalMode || '').toLowerCase() === 'wal', JSON.stringify(h?.dbConcurrency || {}))
  check('⑬d 🔴 busy_timeout ≥ 5 秒(撞锁要等,等到了才轮到人话 409)',
    Number(h?.dbConcurrency?.busyTimeout || 0) >= 5000, JSON.stringify(h?.dbConcurrency || {}))
}

/* ══════════ ⑤ 并发:草稿不占位,占位在落单那一刻(店主 05l 裁 (1))══════════
   口径:`drafted` 是**意向**,两个人同时确认同一时段 → **允许两张草稿都建出来**。
   真正不许双占的是**落单**:必须在 `BEGIN IMMEDIATE` 事务里同事务复查可约,
   两人抢同一时段 → **恰好一个成功**,另一个 409。

   🔴 现测(改之前):`assertBookable` 在事务**外面**跑,而 `booking_slots` **没有唯一索引** ——
   两单双双落库。这一组就是冲那个来的。 */
const jreq = async (path, opts = {}, token = null, extraHeaders = {}) => {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json',
      authorization: `Bearer ${token || (process.env.OWNER_TOKEN || 'owner-demo-token')}`,
      ...extraHeaders, ...(opts.headers || {}) },
  })
  let d = null
  try { d = await r.json() } catch { d = null }
  return { status: r.status, data: d }
}
{
  const id = `bkc-${RUN}`
  const made = await jreq('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `并发店${RUN}`, plan: 'chain' }) })
  let fixtureOk = made.status === 201
  let techId = '', serviceId = '', userToken = ''
  if (fixtureOk) {
    await jreq(`/platform/tenants/${id}/business-hours`, { method: 'PUT',
      body: JSON.stringify({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, openTime: '00:00', closeTime: '23:30', isClosed: false })) }) })
    const tech = await jreq(`/platform/tenants/${id}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技师${RUN}`, isActive: true }) })
    const svc = await jreq(`/platform/tenants/${id}/services`, { method: 'POST',
      body: JSON.stringify({ type: 'NAIL', nameZh: `并发项目${RUN}`, nameEn: 'item', priceCents: 40000, depositCents: 5000, baseDurationMin: 60, isActive: true }) })
    techId = tech.data?.technician?.id || ''
    serviceId = svc.data?.service?.id || ''
    /* 注册口要 `displayName`(不是 name),且**必须带 `x-tenant-id`** ——
       顾客侧一律要带,不回落默认门店(现测回的就是 `TENANT_REQUIRED`)。 */
    const reg = await jreq('/auth/email/register', { method: 'POST',
      body: JSON.stringify({ email: `bkc-${RUN}@example.com`, displayName: `并发客${RUN}` }) }, null, { 'x-tenant-id': id })
    userToken = reg.data?.auth?.accessToken || ''
    fixtureOk = Boolean(techId && serviceId && userToken)
  }
  check('⑤0 造景:并发店(营业时间/技师/项目/顾客)齐 —— 造不出来按红', fixtureOk,
    `tech=${techId} svc=${serviceId} token=${userToken ? 'ok' : '空'}`)

  if (fixtureOk) {
    const date = new Date(Date.now() + 2 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
    const book = () => jreq('/bookings', { method: 'POST',
      body: JSON.stringify({ storeId: `store-${id}`, serviceId, technicianId: techId, date, time: '10:00' }) },
    userToken, { 'x-tenant-id': id })

    /* 真并发:两个请求同时发出去,不排队 */
    const [r1, r2] = await Promise.all([book(), book()])
    const oks = [r1, r2].filter((r) => r.status === 201).length
    const conflicts = [r1, r2].filter((r) => r.status === 409).length
    check('⑤a 🔴 两人抢同一时段:**恰好一张成功**', oks === 1, `201×${oks} / 409×${conflicts} (${r1.status}/${r2.status})`)
    check('⑤b 另一张是 409,且话说得像人(不是数据库报错)', conflicts === 1
      && /约走|被占|换一个|已经过去|时段/.test(String([r1, r2].find((r) => r.status === 409)?.data?.error?.message || '')),
      String([r1, r2].find((r) => r.status === 409)?.data?.error?.message || '').slice(0, 60))

    /* 反向守:换一个时段就该落得下去(拦双占不等于把功能拦没) */
    const other = await jreq('/bookings', { method: 'POST',
      body: JSON.stringify({ storeId: `store-${id}`, serviceId, technicianId: techId, date, time: '14:00' }) },
    userToken, { 'x-tenant-id': id })
    check('⑤c 反向守:换个时段照样约得上', other.status === 201, `status=${other.status}`)
  }
}

console.log(`\n[③ 预约采集] 共 ${n} 项:状态机 + 规则补槽 + 配齐店走到 drafted + 空店零回落`)
if (fails.length) { console.error(`\n❌ test-booking-intake ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-booking-intake 通过 ${n} 项`)
