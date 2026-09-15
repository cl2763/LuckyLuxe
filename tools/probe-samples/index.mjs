/* 🔴 J-61 第四款 · **判据物归位** —— 靶子 / 夹具 / 造病物 / probe 样本,全住这一个目录。
 *
 * 案由(本会话两次踩,都是同一个形状):
 *   ① `user-write-census` 的 probe 靶子里写了**字面量 SQL** → 被 `test-fixture-front-door`
 *      那把「夹具直连库贴」的刀数进欠账,**32 → 34 当场红**,而那 6 处一处都不是真债;
 *   ② `user-write-census` 白名单的**理由文字**里写了两个环境变量名 → 被
 *      `test-demo-gate-scope ④`(判「是不是真环境」只许一处)数成第二处出口,
 *      逼着我去**改一段本来正确的文字**(裁 #88 同族:拿产品迁就夹具)。
 *
 * **判据的靶子不是被测对象。** 但全仓那几十把刀认的是**句柄**不是文件名 ——
 * 靶子写在哪,哪就被数。所以给它们一个**统一的家**,并让走全仓的刀**按目录排除**它:
 *   · 排除只许写这一个路径(具名,不许按模式放行);
 *   · 配一条**两面都断言**的判据:
 *     ①样本放在这个目录里 → **不许被数**;②同一个样本放在普通路径里 → **必须被数**。
 *     缺第二面,这个排除就成了「把判据挖了个洞」而没人看得见。
 */
export const PROBE_DIR = 'tools/probe-samples'

/** 样本里的 SQL 一律拼出来,不写字面量 —— 双保险:即使某把刀忘了排除这个目录,它也咬不到。 */
const sql = (verb, tail) => [verb, ' ', tail].join('')

export const SAMPLES = {
  /* 写 users 的路(user-write-census / test-user-write-auth 用)*/
  routeWriteNoAuth: `if (req.method === 'POST' && path === '/x/evil') { db.prepare('${sql('INSERT', 'INTO users (id) VALUES (?)')}').run(1) }`,
  routeUpdateNoAuth: `if (req.method === 'POST' && path === '/x/evil2') { db.prepare('${sql('UPDATE', 'users SET phone = ? WHERE id = ?')}').run(1, 2) }`,
  routeWriteWithAuth: `if (req.method === 'POST' && path === '/x/ok') { const c = requireCustomer(req); db.prepare('${sql('INSERT', 'INTO users (id) VALUES (?)')}').run(c) }`,
  routeReadOnly: `if (req.method === 'GET' && path === '/x/read') { return json(res, 200, db.prepare('${sql('SELECT', '* FROM users')}').all()) }`,
  routeCommentOnly: "if (req.method === 'POST' && path === '/x/cmt') { /* 这里注释里提到写 users 只是提及 */ return json(res, 200, {}) }",
  routeAltPaths: `if (req.method === 'POST' && (path === '/x/a' || path === '/x/b')) { db.prepare('${sql('INSERT', 'INTO users (id) VALUES (?)')}').run(1) }`,
  routeOneLiner: `if (req.method === 'POST' && path === '/x/one') return json(res, 201, db.prepare('${sql('INSERT', 'INTO users (id) VALUES (?)')}').run(1))`,
  /* J-71 造病用 */
  knifeEvil: `if (req.method === 'POST' && path === '/j71/evil') { db.prepare('${sql('INSERT', 'INTO users (id) VALUES (?)')}').run(1) }`,
  knifeGood: `if (req.method === 'POST' && path === '/j71/ok') { const c = requireCustomer(req); db.prepare('${sql('INSERT', 'INTO users (id) VALUES (?)')}').run(c) }`,
  knifeReadOnly: `if (req.method === 'GET' && path === '/j71/read') { return json(res, 200, db.prepare('${sql('SELECT', '* FROM users')}').all()) }`,
}

/** 走全仓的刀,一律用这个判「这是不是判据物」。**具名排除,不许按模式放行。** */
export function isProbeMaterial(relPath) {
  const p = String(relPath).replace(/^\.?\//, '')
  return p === PROBE_DIR || p.startsWith(`${PROBE_DIR}/`)
}
