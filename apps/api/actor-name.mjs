/* 留痕里的「谁」—— **唯一出口**(J-105,店主 10d 立)
 *
 * 🔴 J-105 原文:**留痕里的「谁」,在涉钱的路径上必须是一个人,不能是一个角色。**
 * 「`owner`」回答的是「用哪把钥匙」,不是「哪个人」。**出了纠纷要找的是人。**
 *
 * 案底(10b→10c→10d 三批查出来的):
 * ① 10b:签署文件作废,`voided_by` 落库是**空串** —— 因为我写了 `|| ''`。
 * ② 10c 普查纠正:全仓主流写法其实是 `adminSession.email || 'owner'`,落的是**角色词**不是空。
 *    真正的病不是「空」,是「**说不出是哪一个人**」。
 * ③ 10c 甲档四处真空里**有两处是钱**:现金手记的建单与冲销 `createdBy`。
 *    **抽屉里的钞票动了,记不下是谁动的。**
 *
 * 🔴 为什么主钥匙那条路会没有名字(判据的地基,现读 `local-server.mjs:1349`):
 *   `OWNER_TOKEN` 分支回的是 `{ role:'owner', provider:'demo-token', technicianId:null, tenantId }`
 *   —— **一个身份字段都不带**。所以 `adminSession.email` 是 `undefined`。
 *
 * 规矩:**说得出是谁就写谁;主钥匙那条路明写「平台主钥匙」(它说的是哪条路,不是哪个角色);
 * 连这都说不出来就报错,不许静默写空。**
 * 静默失败器族(判据一):`|| ''` 会把「记不下」悄悄变成「记了个空的」,而那比不记更坏 ——
 * 因为那一栏看起来是填过的。
 */
/* 🔴 优先级是 `email → username → displayName/name`,**顺序不许改**。
   案底(10e,全量回归当场咬出):我第一版写成 `displayName` 优先,
   于是员工代充的 `stored_value_transactions.created_by` 从账号名变成了显示名,
   `test-staff-portal ⑭` 当场红(`技代充mua0st0p` vs `mua0st0p`)。
   **那不是修缺陷,那是改口径** —— 全仓 70 处既有写法都是 `adminSession.email || …`,
   这个出口的职责是**把落空/落角色词的那一段补上**,不是重排已经对的那一段。
   (纪律:修复会改业务口径的,先改文档、先问;这一处我没改口径,是改回去。) */
export function makeActorOf({ apiError }) {
  return function actorOf(sess) {
    const name = String(sess?.email || sess?.username || sess?.displayName || sess?.name || '').trim()
    if (name) return name
    if (sess?.provider === 'demo-token') return '平台主钥匙'
    const id = String(sess?.id || sess?.technicianId || '').trim()
    if (id) return id
    throw apiError(500, 'ACTOR_UNKNOWN', '记不下是谁操作的 —— 这一步涉钱或涉凭证,不许在无名状态下发生。')
  }
}
