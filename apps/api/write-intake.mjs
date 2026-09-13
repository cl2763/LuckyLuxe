/* 写入口的两条纪律(店主 07j 裁 #84 · 07k 裁 #88,2026-09-14)
 *
 * ══ 为什么单开一个模块(裁 #89)══
 * 这两件我第一版是**塞进 `local-server.mjs`** 的:先写了 6 行,顶破了 17,707 那个行数棘轮,
 * 我就**把六行压成一行**让它过。店主的定性我收下:
 *   **那个棘轮要的不是「行数别涨」,是「别再往这个巨型文件里倒东西」。**
 *   压行之后行数达标了,而那六行的内容一行没少,只是更难读了 —— **判据满意了,判据要防的事照样发生。**
 * 顶破棘轮的正确反应只有三个:**摘出去 / 请裁 / 说明非加不可**。压行不在里面。
 * 所以这里是「摘出去」,形状照 `secret-gate.mjs` / `party.js` 那两次做对的。
 *
 * ══ 一 · 缺手机号不许静默建档(裁 #84)══
 * D190 把手机号定成身份锚之后,**一个没有手机号的顾客档案就是一个永远认不出来的人** ——
 * 两端对不上号,也进不了撞车队列:它不撞车,它根本不存在于身份体系里。
 * 商家现场排单确实可能还没问到号,所以**不拒绝**,而是**落一个后台看得见的标记**。「静默」这一项没得选。
 *
 * ══ 二 · 未知字段:开发期拒绝,生产忽略但留痕(裁 #88)══
 * 🔴 **这才是让我栽跤的那个东西。** 我把 `newCustomerPhone` 传给了只认 `phone` 的口,
 * 它**一声不吭地忽略**,照建档,手机号丢了。
 * 我当时的「治法」是**给那个错名字加了个别名** —— 店主撤掉了,理由三条,每条都对:
 *   ① 一件事两处真相(这个仓一整月都在拔这个,这里反手加了一个);
 *   ② 它把发现病的信号关掉了 —— 下一个人写 `customerPhone` 照样静默,
 *      而我们等于教会了自己「传错名字就加别名」;**别名不是治法,是把一个病扩散成一族**;
 *   ③ **传错名字的是夹具,不是顾客。改产品去迁就夹具,方向反了。**
 * 真治法:
 *   · `ci` / `sandbox` 库域 → **直接拒绝并点名是哪个字段**;
 *   · 生产 / 本机 → **忽略,但记一条**(日志看得见)。
 * 为什么两档不同:生产上真拒绝可能把老客户端弄崩;
 * 但**开发期一声不吭地忽略,等于把每一个拼写错误都变成一次静默的数据丢失**。
 */
import { DEV_SCOPES } from './secret-gate.mjs'

/** 缺手机号时打的标记 —— 后台的顾客标签里看得见 */
export const NO_PHONE_TAG = '无手机号'

/* `POST /admin/bookings/direct` 认得出的字段。**逐个现读那个处理块自己用到的**,不是凭印象列 ——
   多一个少一个都会让那道闸变成误伤或空转。新加字段要同步加进来(ci 档会当场把漏的点出来)。
   放在这里而不是 `local-server.mjs`:清单和用它的那道闸是同一件事(一件事一处真相)。 */
export const DIRECT_BOOKING_FIELDS = ['userId', 'newCustomerName', 'phone', 'serviceId', 'serviceName',
  'technicianId', 'technicianName', 'date', 'time', 'durationMin', 'depositPaid', 'notes', 'images',
  'rawText', 'storeId', 'bookingId', 'backfill']

/**
 * 新建顾客档案时的两个字段。**只认 `phone` 一个拼法**(裁 #88:别名已撤)。
 * @returns {{ phone: string, tagsJson: string }}
 */
export function newCustomerFields(body = {}) {
  const phone = String(body.phone || '').trim()
  return { phone, tagsJson: phone ? '[]' : JSON.stringify([NO_PHONE_TAG]) }
}

/**
 * 未知字段闸。`ci`/`sandbox` 拒绝并点名;其余库域忽略但记一条。
 * @param {{ body: object, allowed: string[], scopeName: string, where: string, apiError: Function }} o
 * @returns {string[]} 认不出来的字段名(生产档也回,方便调用方自己再决定)
 */
export function guardUnknownFields({ body = {}, allowed = [], scopeName = 'unknown', where = '', apiError }) {
  const ok = new Set(allowed)
  const unknown = Object.keys(body).filter((k) => !ok.has(k))
  if (!unknown.length) return []
  if (DEV_SCOPES.has(scopeName)) {
    throw apiError(400, 'UNKNOWN_FIELD',
      `${where} 收到认不出来的字段:${unknown.join(' / ')}。`
      + `这个口只认:${allowed.join(' / ')}。`
      + '(开发期直接拒绝并点名 —— 一声不吭地忽略,等于把每个拼写错误变成一次静默的数据丢失。'
      + '生产库域不拒绝,只记一条。)')
  }
  console.warn(`[unknown-field] ${where} 忽略了认不出来的字段:${unknown.join(' / ')}(库域 ${scopeName})`)
  return unknown
}

/**
 * 建一条新顾客档案。**整条 INSERT 也搬到这里**——
 * 不是为了少写一行,是因为「缺号落标记」这条纪律和这条 INSERT 是同一件事,
 * 拆在两个文件里下一个人改 SQL 时看不见纪律(一件事一处真相)。
 * 顺带的结果是 `local-server.mjs` 一行换一行,棘轮不涨 —— 那是**摘出去**的副产品,不是目的。
 */
export function insertNewCustomer(db, { id, displayName, body, tenantId }) {
  const nf = newCustomerFields(body)
  db.prepare('INSERT INTO users (id, display_name, phone, tenant_id, tags_json) VALUES (?, ?, NULLIF(?, \'\'), ?, ?)')
    .run(id, String(displayName || '').slice(0, 40), nf.phone, tenantId, nf.tagsJson)
  return nf
}

/**
 * 直排单那一口的「拿到顾客」整段:**认字段 → 没有就建 → 建的时候守缺号纪律**。
 * 三件本来就是一件事,拆在两处下一个人只会看见其中一件。
 * (裁 #89 的「摘出去」:`local-server.mjs` 那边从 8 行变 1 行,棘轮跟着降 —— 那是副产品,不是目的。)
 */
export function intakeCustomerForDirectBooking(db, { body, tenantId, userId, randomId, apiError, scopeName }) {
  guardUnknownFields({ body, allowed: DIRECT_BOOKING_FIELDS, scopeName, where: 'POST /admin/bookings/direct', apiError })
  const newName = String(body.newCustomerName || '').trim()
  if (userId || !newName) return { userId, createdUserId: '' }
  const id = randomId('user')
  insertNewCustomer(db, { id, displayName: newName, body, tenantId })
  return { userId: id, createdUserId: id }
}
