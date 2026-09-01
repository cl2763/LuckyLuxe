/* 「本租户之外的所有店名」现取件(店主 02v 裁定五《判据不许锚在会变的业务字面量上》)

   立件背景:四条守多租户隔离与零回落的刀,原来都靠「结果里不许出现 `Lucky Luxe` 字样」判。
   **店名一改,这个词全仓消失,四条断言必然绿,而它们守的那件事没人守了** ——
   恒真兜底同族,而且是最难发现的那一种:不是写死 `true`,是写死了一个**迟早会消失的词**。

   改法(店主钉死):**不许换成新词**(那只是把定时炸弹的引信重设一遍),
   而要**锚在关系上** —— 从数据现取「当前租户之外的所有店名」,断言结果里不含其中任何一个。
   店名再改多少次刀都还在守;新开一家店,它**自动纳入被测集合**。
   配套**反向守**:集合必须非空,取空即红(防"扫描面缩水成零")。 */
import { DatabaseSync } from 'node:sqlite'

export function otherTenantNames(dbPath, selfTenantId) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const rows = [
    ...db.prepare('SELECT tenant_id AS t, name AS n FROM stores').all(),
    ...db.prepare('SELECT id AS t, name AS n FROM tenants').all(),
    ...db.prepare("SELECT tenant_id AS t, value AS n FROM tenant_kb_facts WHERE key = 'brandName'").all(),
  ]
  db.close()
  const self = new Set(rows.filter((r) => r.t === selfTenantId).map((r) => r.n))
  /* 只留别家的名字;把本店也叫得出的名字剔掉(同名不算泄漏),太短的剔掉(避免误伤) */
  const names = [...new Set(rows.filter((r) => r.t !== selfTenantId).map((r) => r.n))]
    .filter((n) => n && String(n).trim().length >= 3 && !self.has(n))
  return names
}

/* 在一坨响应文本里找别家店名;返回命中的名字与上下文,便于报里指名道姓 */
export function findForeignNames(blob, names) {
  const text = typeof blob === 'string' ? blob : JSON.stringify(blob)
  const hit = []
  for (const n of names) {
    const i = text.indexOf(n)
    if (i >= 0) hit.push({ name: n, ctx: text.slice(Math.max(0, i - 60), i + 60) })
  }
  return hit
}
