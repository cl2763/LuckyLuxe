/* D197 第一段 · 新店配置进度五步灯(店主 11s补 §二.3 · 11t §三,2026-09-23)
 *
 * ══ 案由 ══
 * 店主原话:「现在的配置界面我看不出商家配置到哪一环。」
 * 合同图《有迹新店入驻向导》(09b §一)画的是五步 + 每步状态灯 —— **至今一行代码没有**
 * (11e 盘点表现扫:`platform.html` 里「向导 / 进度 / wizard」0 命中)。
 * 本件只做**店主看得见的那一半**:一条五步状态栏。整个向导不在本批。
 *
 * ══ 三条形状 ══
 * 🔴 ① **灯由后端判,句子由后端出,前端零判断**(和 aiLabel 同款)——
 *      否则「怎么算配好了」会在两端各写一份,迟早分叉。
 * 🔴 ② **第五盏恒灰**(11t §三 明写):提审前置清单**只活在文档里,没有机器可读的来源**。
 *      **没有数据源的灯不许亮** —— 亮绿是撒谎,亮红是冤枉。灰 + 一句「尚未接入系统」才是实话。
 *      要让它能亮,得先把清单变成可查的(已登记,单独一批,先出图)。
 * 🔴 ③ 判据给每盏灯一条**阳性对照**,并给第五盏钉一条「恒灰」——
 *      哪天有人偷偷让它绿,当场红。 */

export const STEP_KEYS = ['store', 'pricing', 'owner', 'wecom', 'launch']
/* 三态。`pending` 是灰(还没做),`blocked` 是红(做了但不对),`done` 是绿。
   第五盏用的是第四态 `unavailable` —— 它不是「还没做」,是「这盏灯本身还没接上」。 */
export const STEP_STATES = ['done', 'pending', 'blocked', 'unavailable']

export function createOnboardingSteps(deps) {
  const { db, json, apiError, localParts, localDateTime, iso } = deps
  if (!db) throw new Error('createOnboardingSteps 缺依赖:db')

  const one = (sql, ...a) => { try { return db.prepare(sql).get(...a) } catch (e) { return null } }
  const PLACEHOLDER = /TBD|placeholder|N\/A|待填|待补充|占位|未填|待定/i

  /* ① 建店:门店资料齐不齐。**按占位词表判**,不是按「非空」——
     `Address TBD` 不是空,但它也不是地址(11j/11k 那条律)。 */
  function stepStore(tid) {
    const s = one('SELECT name, address, phone, timezone, currency FROM stores WHERE tenant_id = ? LIMIT 1', tid)
    if (!s) return { state: 'blocked', note: '这家店还没有门店记录' }
    const missing = []
    for (const [k, label] of [['name', '店名'], ['address', '地址'], ['phone', '电话'], ['timezone', '时区'], ['currency', '币种']]) {
      const v = String(s[k] || '').trim()
      if (!v || PLACEHOLDER.test(v)) missing.push(label)
    }
    return missing.length
      ? { state: 'pending', note: `还差:${missing.join(' · ')}` }
      : { state: 'done', note: '门店资料齐了' }
  }

  /* ② 经营规则:价目 ≥ 1 且无占位值。 */
  function stepPricing(tid) {
    const n = one('SELECT COUNT(*) n FROM services WHERE tenant_id = ? AND is_active = 1', tid)?.n || 0
    if (!n) return { state: 'pending', note: '还没有服务项目' }
    const bad = one("SELECT COUNT(*) n FROM services WHERE tenant_id = ? AND (name_zh LIKE '%TBD%' OR name_zh LIKE '%待补充%' OR price_cents <= 0)", tid)?.n || 0
    return bad
      ? { state: 'blocked', note: `${n} 个项目里有 ${bad} 个还没填好(名字是占位值,或价格是 0)` }
      : { state: 'done', note: `${n} 个服务项目` }
  }

  /* ③ 老板账号:建了没有 + 改过密没有。
     🔴 「建了但没改密」是 pending 不是 done —— 初始密码还在用,等于门还没交出去。 */
  function stepOwner(tid) {
    const a = one("SELECT username, must_change_password FROM admin_accounts WHERE tenant_id = ? AND role = 'owner' LIMIT 1", tid)
    if (!a) return { state: 'blocked', note: '这家店还没有老板账号' }
    return a.must_change_password === 1
      ? { state: 'pending', note: `账号 ${a.username} 已建,商家还没首登改密` }
      : { state: 'done', note: `账号 ${a.username} 已启用` }
  }

  /* ④ 企微接入:`open_kfid` 填了没有。
     🔴 空格不算填(D132 口径:未填则该店进线一律拒收,不许放松)。 */
  function stepWecom(tid) {
    const r = one("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'wecom_open_kfid'", tid)
    const v = String(r?.value || '').trim()
    return v
      ? { state: 'done', note: '企微客服号已填' }
      : { state: 'pending', note: '还没填企微客服号(不填的话这家店的企微进线会被拒收)' }
  }

  /* ⑤ 上线检查:🔴 **恒灰**。
     提审前置清单只活在文档里,没有任何机器可读的来源 ——
     **没有数据源的灯不许亮**。这一行不是占位,是实话。 */
  function stepLaunch() {
    return { state: 'unavailable', note: '提审清单尚未接入系统' }
  }

  const LABEL = { store: '建店', pricing: '经营规则', owner: '老板账号', wecom: '企微接入', launch: '上线检查' }

  /** 一家店的五盏灯 —— 前端拿到就渲染,不判断、不拼串 */
  function stepsOf(tenantId) {
    const raw = { store: stepStore(tenantId), pricing: stepPricing(tenantId), owner: stepOwner(tenantId), wecom: stepWecom(tenantId), launch: stepLaunch() }
    const steps = STEP_KEYS.map((k, i) => ({ key: k, index: i + 1, label: LABEL[k], ...raw[k] }))
    /* 「配到哪一环」那句话也在后端出:第一个没 done 的那一步就是答案。
       第五盏不参与 —— 它还没接上,不该把别人卡在那儿。 */
    const firstOpen = steps.find((s) => s.state !== 'done' && s.state !== 'unavailable')
    const doneN = steps.filter((s) => s.state === 'done').length
    return {
      steps,
      doneCount: doneN,
      totalCount: STEP_KEYS.length,
      /* 🔴 这一句是店主要的那句「配到哪一环」 */
      summary: firstOpen ? `配到第 ${firstOpen.index} 环:${firstOpen.label} —— ${firstOpen.note}` : '前四环都配完了(上线检查尚未接入系统)',
    }
  }

  /* 🔴 平台概览整条口搬进来(公约②「边改边拆」):它现在的主要内容就是这张进度表。
     `isPlatform` 是**请求内的闭包**(捕获 req),按请求传进来 —— 11m 那次抽取踩过这个坑。
     `json()` 在主文件里返回 undefined,所以包一层哨兵,否则主路由会二次应答把进程打死(同一次踩过)。 */
  const HANDLED = Object.freeze({ handled: true })
  const j = (...a) => { json(...a); return HANDLED }
  async function overviewRoute({ req, res, path, isPlatform }) {
    if (req.method === 'GET' && path === '/platform/overview') {
      if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
      const monthStart = `${localParts(new Date()).date.slice(0, 7)}-01`
      const monthBookings = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE appointment_start >= ?').get(iso(localDateTime(monthStart, '00:00'))).n
      const pendingConfig = db.prepare(`SELECT t.id, t.name FROM tenants t WHERE t.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM services s WHERE s.tenant_id = t.id AND s.is_active = 1)`).all()
      /* D197 第一段:概览原来只看「有没有价目表」一件事,现在连五步进度一起下发。
         收的是「不是演示店」而非 kind='real' —— 测试库建的店 kind='test',写死 real 会整批漏掉(理由见 onboarding-steps.mjs)。 */
      const progress = db.prepare("SELECT id, name FROM tenants WHERE status = 'active' AND COALESCE(kind,'real') <> 'demo'").all()
        .map((t) => ({ id: t.id, name: t.name, ...stepsOf(t.id) }))
      return j(res, 200, { monthBookings, pendingConfig: pendingConfig.map((r) => ({ id: r.id, name: r.name })), progress })
    }
    return null
  }

  return { stepsOf, overviewRoute, STEP_KEYS, STEP_STATES }
}
