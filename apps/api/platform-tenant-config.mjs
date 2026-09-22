/* 平台端 · 每店配置三条口(公约②「边改边拆」,2026-09-22 由 11m 这一批搬出)
 *
 * 搬的是三条口:企微客服号 `wecom-kfid` · **AI 修图三态 `ai-retouch`(本批新加)** · 会员配置 `membership-config`。
 * 🔴 **逐字搬,行为一个字没改**(J-107:抽取必须行为等价)——
 *    三段代码与搬出前完全相同,只是从 `local-server.mjs` 挪到了这里,
 *    并按《代码结构公约》③ 的棘轮律:巨型文件只许降不许升,本批新加的那条口不许再往里堆。
 *
 * 为什么这三条能放一起:它们是同一件事的三面 —— **平台替商家设一个每店一份的值**,
 * 都走 `/platform/tenants/:id/xxx`,都要 `isPlatform()`,都先查租户在不在。 */
export function createPlatformTenantConfig(deps) {
  const { db, apiError, readBody, wecomRouting, aiRetouchGate,
    getMembershipConfig, setMembershipConfig, MEMBER_QUALIFY_MODES } = deps
  /* 🔴 主文件里的 `json()` **返回 undefined** —— 原来那三段是 `return json(...)` 直接从请求处理函数里出去,
     所以没人在乎它返回什么。搬进来之后 `route()` 的返回值成了「命中没命中」的信号,
     undefined 就是「没命中」⇒ 主路由继续往下走 ⇒ 第二次应答 ⇒ `ERR_HTTP_HEADERS_SENT` **把进程打死**。
     (实测:GET 看着是对的,其实那一下就崩了,后面的 PUT 全是连不上。)
     改法:**包一层返回哨兵**,路由体一个字不动 —— 这样 J-107「抽取必须行为等价」才成立。 */
  const HANDLED = Object.freeze({ handled: true })
  const json = (...args) => { deps.json(...args); return HANDLED }
  for (const [name, v] of Object.entries(deps)) {
    if (v === undefined || v === null) throw new Error(`createPlatformTenantConfig 缺依赖:${name}`)
  }
  /* 🔴 `isPlatform` 是**请求内的闭包**(它捕获 req),提不到模块级 —— 所以按请求传进来,
     不是建实例时传。搬代码时这种「看起来是全局、其实是闭包」的依赖最容易漏,漏了就是启动即崩。 */
  /** 命中就返回 json(...) 的结果;没命中返回 null,交回主路由继续往下走 */
  async function route({ req, res, path, isPlatform }) {
    if (path.startsWith('/platform/tenants/') && path.endsWith('/wecom-kfid') && (req.method === 'GET' || req.method === 'PUT')) {
      if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
      const id = path.split('/')[3]
      if (!db.prepare('SELECT id FROM tenants WHERE id = ?').get(id)) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
      if (req.method === 'GET') {
        const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'wecom_open_kfid'").get(id)
        return json(res, 200, { tenantId: id, openKfid: row?.value || '' })
      }
      const value = String((await readBody(req)).openKfid || '').trim().slice(0, 120)
      if (value) {
        const owner = wecomRouting.tenantForOpenKfid(value)
        if (owner && owner !== id) throw apiError(409, 'KFID_TAKEN', '这个企微客服账号已经绑在另一家门店上了。')
      }
      wecomRouting.setOpenKfidMapping(id, value)
      return json(res, 200, { tenantId: id, openKfid: value })
    }
    if (path.startsWith('/platform/tenants/') && path.endsWith('/ai-retouch') && (req.method === 'GET' || req.method === 'PUT')) {
      if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
      const tenantId = path.split('/')[3]
      if (!db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId)) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
      if (req.method === 'GET') {
        return json(res, 200, { tenantId, state: aiRetouchGate.get(tenantId), states: aiRetouchGate.AI_RETOUCH_STATES, onReady: aiRetouchGate.ON_READY })
      }
      const body = await readBody(req)
      return json(res, 200, { tenantId, state: aiRetouchGate.set(tenantId, body.state) })
    }
    if (path.startsWith('/platform/tenants/') && path.endsWith('/membership-config') && (req.method === 'GET' || req.method === 'PUT')) {
      if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
      const tenantId = path.split('/')[3]
      if (!db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId)) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
      if (req.method === 'GET') {
        return json(res, 200, { tenantId, config: getMembershipConfig(tenantId), qualifyModes: MEMBER_QUALIFY_MODES })
      }
      const body = await readBody(req)
      return json(res, 200, { tenantId, config: setMembershipConfig(tenantId, body.config && typeof body.config === 'object' ? body.config : body) })
    }
    return null
  }
  return { route }
}
