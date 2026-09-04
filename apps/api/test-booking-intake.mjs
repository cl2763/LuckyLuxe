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

console.log(`\n[③ 预约采集] 共 ${n} 项:状态机 + 规则补槽 + 配齐店走到 drafted + 空店零回落`)
if (fails.length) { console.error(`\n❌ test-booking-intake ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-booking-intake 通过 ${n} 项`)
