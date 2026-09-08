/* 05s §四 · 六通 v4 读出来的五病 + §二 D152 正面(店主 2026-09-08)

   五病都是**同一类**:机器把话说完了,却没说到顾客问的那件事上 ——
   要么答非所问(D158/D162)、要么答完还追着问表项(D159)、
   要么合并了却没答全(D160)、要么把告别当新问题(D161)。

   本刀两层:
   ① **纯函数逐句对** —— 出句的规矩都在模块里,喂进去比字;
   ② **行为层**(要测试库)—— 真发一句,看引擎走的是哪条路、答出来的是哪一句。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { assertTestTarget, isTestTarget } from './test-guard.mjs'
import { answered, reaskText, repeatPre, sameTopic } from './repeat-guard.mjs'
import { farewellText, hygiene, isFarewell, stripIntakeTail } from './reply-hygiene.mjs'
import { bestDiscount, fixedPriceSentence, matchService, quotePathDiscountLine } from './fixed-price-reply.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const money = (c) => `¥${(c / 100).toFixed(0)}`

/* ═══ D158 · D150 误伤:同一档 ≠ 同一件事 ═══
   v4 通二原文:「那个最便宜的是哪种」被当成复读,换成一句空话。 */
check('D158 ①「大概要多久」与「那个最便宜的是哪种」**不算同一件事**',
  sameTopic('大概要多久', '那个最便宜的是哪种') === false)
check('D158 ①b 真正同一件事仍然认得出来', sameTopic('做美睫多少钱', '美睫价格多少') === true)
check('D158 ② 上一答**本来就是个反问**时,顾客再问不算复读',
  answered('您最在意的是价格、时间,还是效果呢?') === false)
check('D158 ②b 上一答给了数字才算「答过」', answered('裸感自然睫 ¥198,大概 120 分钟') === true)
check('D158 ③ 🔴 换答法**必须仍然带着上一答**,不许把答案换成一句反问',
  reaskText('zh', '裸感自然睫 ¥198').startsWith('裸感自然睫 ¥198')
  && reaskText('zh', '裸感自然睫 ¥198').includes('最在意'),
  reaskText('zh', '裸感自然睫 ¥198'))

/* 🔴 K26 咬出来的判据缺口(刀落了却没红):上面几条验的是**纯函数**,
   而病在**接线**上 —— 把 `repeatPre` 里那句 `if (!sameTopic(...)) break` 删掉,
   纯函数照样对、判据照样绿。所以这里直接**跑 `repeatPre`**,用一个假 db 喂历史。
   判据律:验的必须是「病存在时会红」的那一层。 */
const fakeDb = (customerRows, assistantRows) => ({
  prepare: (sql) => ({
    all: () => (/role = 'assistant'/.test(sql) ? assistantRows : customerRows),
    get: () => (/role = 'assistant'/.test(sql) ? assistantRows[0] : customerRows[0]),
  }),
})
/* 🔴 两句必须**同一档**,不然断在档上、`sameTopic` 根本没被问到 ——
   第一版夹具就是这么白跑的:一句 question 一句 budget,刀落了判据照样绿。
   这里两句都判成 question,分不分得开只剩 `sameTopic` 说了算。 */
const kindOf = () => 'question'
check('D158 ④ 🔴 接线层:同档但换了话题 → run 回到 1(不再当复读)',
  repeatPre({ db: fakeDb([{ content: '大概要多久' }], [{ id: 'a1', content: '120 分钟' }]),
    conversationId: 'c', tenantId: 't', text: '你们几点关门', classifyTurn: kindOf }).run === 1)
check('D158 ④b 接线层:真的同一件事连着问 → run 累加(守还在)',
  repeatPre({ db: fakeDb([{ content: '做美睫多少钱' }], [{ id: 'a1', content: '裸感自然睫 198,大概 120 分钟' }]),
    conversationId: 'c', tenantId: 't', text: '美睫价格多少', classifyTurn: kindOf }).run === 2)

/* ═══ D159 · 答完不许再追着问表项 ═══ */
check('D159 ① 转人工句后面拼的采集问句被砍掉',
  stripIntakeTail('这个我帮您问一下技师~ 请问这次是否需要下睫毛服务?').text === '这个我帮您问一下技师~')
check('D159 ② 事实答句(带数字)后面的采集问句也砍',
  stripIntakeTail('120–150 分钟。 请问是否需要卸甲?').cut === true)
check('D159 ③ 🔴 反向守:**本来就只是一句采集问句**的,一个字都不许动',
  stripIntakeTail('请问这次是否需要卸甲?').cut === false)
check('D159 ④ 反向守:普通答句没有尾巴时不动它',
  stripIntakeTail('我们家周二到周日 10:00–19:00 营业。').cut === false)

/* ═══ D161 · 待人工态下的告别 ═══ */
check('D161 ①「谢谢」认得出是告别', isFarewell('谢谢') && isFarewell('好的谢谢') && isFarewell('bye'))
check('D161 ②「谢谢,那定金多少?」**不是**告别(带问号)', isFarewell('谢谢,那定金多少?') === false)
check('D161 ③ 🔴 待人工态 + 顾客告别 → 回告别句,**不再重复转人工**',
  (() => { const h = hygiene({ text: '这个我帮您问一下,确认清楚再回复您', customerText: '谢谢', status: 'needs_human' })
    return h.why === 'farewell-in-handoff' && h.text === farewellText('zh') && !/问一下/.test(h.text) })())
check('D161 ④ 反向守:不是待人工态就不改(正常聊天里说谢谢照常走)',
  hygiene({ text: '好的~', customerText: '谢谢', status: 'ai_replied' }).why === '')

/* ═══ D152 正面 · fixed 项目直接报价(§二 裁待裁 #8)═══ */
const svc = { id: 's1', name: '精致单色', priceCents: 29800, priceMode: 'fixed', durationMin: 90 }
const coup = [{ name: '新客首单立减 50', off: '立减 ¥50', minSpend: 0 }]
check('D152 ① 命中项目名', matchService('精致单色多少钱?', [svc]).id === 's1')
check('D152 ①b 去掉修饰也命中(「单色」→「精致单色」)', matchService('单色多少钱', [svc]) !== null)
check('D152 ② 🔴 三段顺序:折扣 → 原价 → 折后价,数字对得上账',
  (() => { const s = fixedPriceSentence({ service: svc, discounts: coup, money })
    return s.indexOf('立减') < s.indexOf('原价') && s.indexOf('原价') < s.indexOf('券后')
      && s.includes('¥298') && s.includes('¥248') })(),
  fixedPriceSentence({ service: svc, discounts: coup, money }))
check('D152 ③ 🔴 无券只说原价,**一个「券」字都不出现**',
  (() => { const s = fixedPriceSentence({ service: svc, discounts: [], money })
    return s.includes('¥298') && !/券|折扣|优惠|折后/.test(s) })(),
  fixedPriceSentence({ service: svc, discounts: [], money }))
check('D152 ④ 门槛够不着的券**不算**(满 300 减 50 用不到 ¥298 的单上)',
  bestDiscount(29800, [{ name: '满300减50', off: '立减 ¥50', minSpend: 30000 }]) === null)
check('D152 ⑤ 折后价算不准就不给(off 解不出数额时不返回)',
  bestDiscount(29800, [{ name: '神秘券', off: '看心情', minSpend: 0 }]) === null)
check('D152 ⑥ `quote` 那条路只说有券、**不出数字**',
  (() => { const s = quotePathDiscountLine(coup)
    return s.includes('新客首单立减 50') && !/\d+\s*元|¥\s*\d{2,}/.test(s.replace('立减 ¥50', '')) })(),
  quotePathDiscountLine(coup))

/* 接线:那条路真的排在报价采集**之前** */
const srv = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
check('D152 ⑦ 接线排在报价采集之前(不然照旧被采集吃掉)',
  srv.indexOf('fixedPriceAnswer(') > 0 && srv.indexOf('fixedPriceAnswer(') < srv.indexOf('quoteIntakeReply(\'manual_special_review\''))

/* ═══ 行为层 ═══ */
const onTest = await isTestTarget(BASE_URL)
if (!onTest) {
  console.log(`⚠️  [v4-five-fixes] ${BASE_URL} 不是测试库 —— **行为层本轮未跑**(不是通过)`)
} else {
  await assertTestTarget(BASE_URL)
  const db = new DatabaseSync(process.env.TEST_DB_PATH)
  const RUN = `v5-${Date.now().toString(36)}`
  const say = (uid, msg) => fetch(`${BASE_URL}/admin/wechat/mock-chat-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ message: msg, lang: 'zh', externalUserId: uid }),
  }).then((r) => r.json()).then((j) => ({ src: j?.reply?.source || '', text: String(j?.reply?.data?.answerZh || ''), status: j?.conversation?.status || '' }))

  /* 造景:本轮专用的一个 fixed 项目(名字带执行随机段,跑完删掉) */
  const tid = db.prepare('SELECT tenant_id FROM services WHERE is_active = 1 LIMIT 1').get()?.tenant_id
  check('造景自证:测试库里取得到一家有项目的店', Boolean(tid), String(tid))
  if (tid) {
    const sid = `svc-${RUN}`
    const name = `判据单色${RUN.slice(-4)}`
    /* 🔴 **整行照抄一条现成的**再改四个字段 —— 判据不猜 schema。
       前两次就是靠猜列名栽的(先缺 `type`、再缺 `category`);
       services 有几十列、还有 NOT NULL,一列一列补必然还漏。 */
    const src0 = db.prepare("SELECT * FROM services WHERE tenant_id = ? AND is_active = 1 AND (item_kind IS NULL OR item_kind = 'main') LIMIT 1").get(tid)
    const cols = Object.keys(src0)
    const row = { ...src0, id: sid, name_zh: name, price_cents: 29800, base_duration_min: 90, price_mode: 'fixed', sort_order: 999 }
    db.prepare(`INSERT INTO services (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((c) => row[c]))
    const r1 = await say(`${RUN}-a`, `${name}多少钱?`)
    /* 🔴 判据不锚币符:CI 那家店是加元、沙箱北京店是人民币 —— 锚 `¥` 就等于把币种写进判据。
       要证的是「走了直报那条路 + 报的是库里那个价」,所以只看**路**与**数字**。 */
    check('行为 ① 🔴 问 fixed 项目的价 → **直接报**,不进报价采集',
      r1.src === 'fixed_price_direct' && /298/.test(r1.text) && /原价/.test(r1.text), JSON.stringify(r1))
    check('行为 ①b 那一句里没有采集问句的尾巴', !/是否需要卸甲|本甲还是延长/.test(r1.text), r1.text)
    /* 收尾:判据自己造的项目自己删(夹具不收尾 = 判据非幂等) */
    db.prepare('DELETE FROM services WHERE id = ?').run(sid)
    check('行为 ②收尾:造的项目已删干净',
      db.prepare('SELECT COUNT(*) AS n FROM services WHERE id = ?').get(sid).n === 0)
  }
  db.close()
}

console.log(`\n[v4 五病 + D152 正面] D158 误伤 · D159 尾巴 · D161 告别 · D152 三段式`)
if (fails.length) { console.error(`\n❌ test-v4-five-fixes ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-v4-five-fixes 通过 ${n} 项`)
