/* 顾客侧「当前进的店」闸(D132 口径④,店主 04c 立 report-only → 04d 裁 fail-closed)

   ══ 病根 ══
   `resolveTenant` 原来是「拿不到就回落默认租户(旗舰店)」——
   与 D128 `users.tenant_id DEFAULT 'lucky-luxe'`、D130 身份表、D131 那 31 张表**同一根子**:
   **有默认值,打错了不报错**。落在顾客侧就是:小程序/网页忘带门店标识时,
   请求静默变成「在旗舰店」,别家店的顾客拿到旗舰店的数据。

   ══ 怎么定的 ══
   04c 那一轮**先 report-only**:整轮回归实测「没带 16 次 / 无效 0 次」,
   而两个真实顾客端一直带头(小程序 `utils/api.js`、网页 `customer.js`)—— 16 次全部来自夹具。
   数拿给店主看完,04d 裁:**放 fail-closed**,夹具同批补头(补的是请求,不是放宽判据)。

   ══ 计数为什么留着 ══
   它现在数的是**被拒的次数**,摆在 `/health.tenantFallback` 上让判据读得到:
   回归跑完三个 CI 服务进程都必须是 0/0。**读 health 不读日志** —— 日志会被下一次跑覆盖。 */

export function createTenantGate({ db, apiError, defaultTenantId }) {
  const tally = { missing: 0, invalid: 0 }

  /* 校验租户 id(存在且启用)。**这一层仍然可以回落** —— 它被后台/平台侧也用着;
     「不许回落」是 `resolveTenant` 这一层的事(顾客侧),两层分开。 */
  function validTenantId(raw) {
    const id = String(raw || '').trim()
    if (id) {
      try {
        const t = db.prepare("SELECT id FROM tenants WHERE id = ? AND status = 'active'").get(id)
        if (t) return t.id
      } catch { /* tenants 表异常时回退 */ }
    }
    return defaultTenantId
  }

  /* 顾客侧公开路由专用:缺失或无效 → 400 TENANT_REQUIRED,**不回落**。
     ⚠️ 只管顾客侧:调用点全在 `/stores` `/services` `/availability` `/my/*` `/auth/email/*` `/ai/*`
     这类公开路由上;后台走 adminSession、平台走 isPlatform,都不经这里。
     企微 webhook 那一条更早一步就按 D132 口径③ 由 `open_kfid` 定租户,也不经这里。 */
  function resolveTenant(req, query) {
    const raw = String((req && req.headers && req.headers['x-tenant-id']) || (query && query.tenantId) || '')
    if (!raw) {
      tally.missing += 1
      throw apiError(400, 'TENANT_REQUIRED', '请求没带门店标识(x-tenant-id)。顾客端一律要带,不再回落到默认门店。')
    }
    const resolved = validTenantId(raw)
    if (resolved !== raw) {
      tally.invalid += 1
      console.warn(`[tenant-fallback] kind=invalid raw=${raw.slice(0, 40)} path=${(req && req.url || '').split('?')[0]}`)
      throw apiError(400, 'TENANT_REQUIRED', '门店标识无效。')
    }
    return resolved
  }

  return { validTenantId, resolveTenant, tenantFallbackTally: tally }
}
