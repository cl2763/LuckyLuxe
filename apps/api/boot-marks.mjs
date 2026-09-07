/* 开机留痕 —— 拍板/改判落地后写在库里的那几行「这条口径已经生效了」的标记。

   为什么单独一个文件(公约②边改边拆):05r 补一 动到了这个域,就把它从
   `local-server.mjs` 搬出来;巨型文件适用「只许搬出、不许新增」。

   ══ 这里唯一要小心的事:留痕必须幂等 ══
   留痕原来是每次开机 `INSERT OR REPLACE` 一遍 —— 值一个字没变,只有 `updated_at`
   跟着当前时刻走。数据不算错,**坏的是「未动」这句话永远证不了**:
   逐行指纹每重启一次就报「每个租户各消失 1 行」(J-29 那把刀看的正是这一类),
   于是任何一批交付都没法拿指纹证明自己没动过库。
   判据按「**做过没有**」判(值一模一样就是做过了),不按「现在还剩多少」判(幂等判据律)。
   归族:测试标准⑤「数据迁移重跑一遍,数字一分不动」—— 这条以前只在纸上。
   常驻断言:`test-perf-base-migration` 那两条「开机留痕」。 */

/* 改判①(店主 2026-08-12 二次/三次拍板):积分历史全量追溯 —— 累计获得≡累计消费;
   「不追溯」作废,切换时点常量已拆除。留痕升 v2(REPLACE 覆盖拍板①旧行)。 */
const POINTS_POLICY = JSON.stringify({
  policy: 'subtotal_full_retro',
  decidedBy: '店主 2026-08-12 改判①(二次+三次拍板)',
  note: '积分历史全量追溯:累计获得≡累计消费(Σ已签档位小计);余额=获得−已兑换;硬守恒 余额≤累计消费;混合口径负余额钳 0 留痕',
})

/** 给每个租户写一行 `points_policy` 留痕;**值没变就一个字都不写**(连 updated_at 都不动)。
 *  @returns {{ tenants: number, written: number }} 写了几个租户 —— 稳态下 written 必须是 0 */
export function writePointsPolicyMark(db, nowIso) {
  const tenantIds = db.prepare('SELECT DISTINCT tenant_id AS t FROM tenant_settings UNION SELECT DISTINCT tenant_id FROM bookings').all().map((r) => r.t)
  const readMark = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'points_policy'")
  const mark = db.prepare("INSERT OR REPLACE INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'points_policy', ?, ?)")
  let written = 0
  for (const t of tenantIds) {
    const row = readMark.get(t)   // 没有这一行是正常的(第一次开机),照写
    if (row && row.value === POINTS_POLICY) continue
    mark.run(t, POINTS_POLICY, nowIso)
    written += 1
  }
  return { tenants: tenantIds.length, written }
}
