/* 写口的**后端最终闸**(2026-08-28,《后端是最终闸律》落地件)。

   店主 08-28 的原话:**前端拦只算体验,不算数。**
   审计做法是反着数:机械扫两端 158 个写口调用点 → 挑出前端有拦的 54 处 →
   按「绕过前端会不会造成账错或越权」分 A/B 级 → A 级逐条在后端补闸。
   这一批补的三族(券面额 / 套餐售价与次数 / 项目价格)原来**只有前端拦着**,
   带合法凭证直接打接口就能写进去 —— 建出减 0 元的券、卖 0 元的套餐、负价的项目。

   为什么单独成模块:这三条是**判据**不是业务流程,散在一万八千行里改一处漏一处;
   而且 test-backend-gate.mjs 要对着它们逐条真打接口验(公约①②)。 */
export function createWriteGates({ apiError, db }) {
  /* 券:减 0 元的券发出去,顾客点了没反应,店里还以为发过了。折扣同理(0% 或 >100% 都不成立)。 */
  function assertCouponValueOk({ discountType, amountCents, percentOff }) {
    if (discountType === 'amount' && !(amountCents > 0)) {
      throw apiError(400, 'BAD_REQUEST', '券面额要大于 0(减 0 元的券等于没发)。')
    }
    if (discountType === 'percent' && !(percentOff > 0 && percentOff <= 100)) {
      throw apiError(400, 'BAD_REQUEST', '折扣要在 1–100 之间。')
    }
  }

  /* 套餐:0 元的储值套餐卖不了;0 次的次卡顾客买了等于白买,而账面确实"卖出去一份"。 */
  function assertPackageValueOk({ kind, priceCents, timesCount }) {
    if (!(priceCents > 0)) throw apiError(400, 'BAD_REQUEST', '套餐售价要大于 0(0 元的套餐卖不了)。')
    if (kind === 'times' && !(timesCount > 0)) throw apiError(400, 'BAD_REQUEST', '次卡的包含次数要大于 0。')
  }

  /* 项目价:它是报价、结算、业绩的基数,一处负数会一路负下去(小计、分成、积分)。
     NaN 同样拦 —— `Number('abc')` 落库后所有金额计算都变 NaN,比负数更难查。 */
  function assertServicePriceOk({ priceCents, depositCents, baseDurationMin }) {
    const bad = (n) => !Number.isFinite(n) || n < 0
    if (bad(priceCents)) throw apiError(400, 'BAD_REQUEST', '项目价格必须是不小于 0 的数字。')
    if (bad(depositCents)) throw apiError(400, 'BAD_REQUEST', '定金必须是不小于 0 的数字。')
    if (!Number.isFinite(baseDurationMin) || baseDurationMin <= 0) {
      throw apiError(400, 'BAD_REQUEST', '服务时长必须大于 0 分钟。')
    }
  }

  /* 分类唯一真相律(店主 2026-08-25)的两把闸,同族搬过来 ——
     它们和上面三条是一件事:**写口的最终判据**,不是业务流程。 */
  function assertCategoryOk(categoryId, tenantId) {
    if (!categoryId) {
      throw apiError(400, 'CATEGORY_REQUIRED',
        '这个项目没挂大类 —— 顾客端按大类分组,不挂就会一个项目自成一组。请先选一个大类。')
    }
    const cat = db.prepare('SELECT id FROM service_categories WHERE id = ? AND tenant_id = ?').get(categoryId, tenantId)
    if (!cat) throw apiError(400, 'BAD_REQUEST', '大类不存在或不属于本店。')
  }

  function assertProjectGroupValid(tenantId, group) {
    if (!group) return
    const hit = db.prepare('SELECT 1 FROM service_categories WHERE tenant_id = ? AND name = ?').get(tenantId, group)
    if (!hit) throw apiError(400, 'PROJECT_GROUP_INVALID', `项目组「${group}」不是本店现有的二级分类——请在表单下拉里改选(或选「不限」)。`)
  }

  return { assertCouponValueOk, assertPackageValueOk, assertServicePriceOk, assertCategoryOk, assertProjectGroupValid }
}
