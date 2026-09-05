/* ④ 审样本页(图 v1.2 §四)—— 网页老板端「AI 客服 → 待审」

   ══ 为什么是独立文件、还自己挂自己 ══
   《代码结构公约》:`admin.js` **只许搬出、不许新增**(棘轮 8,550)。
   所以这一页不往 admin.js 里加一行:本文件在 DOMContentLoaded 时**自己**
   找到微信客服那一页(`#wechatMockPage`)把面板插进去。admin.html 只多一行 <script>。

   ══ 页上有什么(照图)══
   · 页顶三个数:本周模型放行 / 老板认可率 / 反问率
   · 一条一行:顾客原话 · AI 答的 · intent · confidence
   · 三个按钮:「对」「改一句」「不该答」

   ══ 三条口径 ══
   1. 三个数**一律后端出**(`/admin/ai/review/pending` 带回来),前端零计算 ——
      同一个事实不许在前端再算一遍(唯一出口纪律)。
   2. 认可率后端给 `null` 表示「还没人审过」,这里显示 **「—」**,**不显示 0%** ——
      0% 和「还没审」是两件事(零回落律)。
   3. 「改一句」必须真填了字才提交,空的按钮不发请求(后端也拦,前端拦只是体验)。 */

(function aiReviewPanel() {
  const API = (typeof window !== 'undefined' && window.LL_API_BASE) || ''
  const authHeaders = () => {
    const h = { 'content-type': 'application/json' }
    try {
      /* 用**这套后台自己的**那把钥匙:`lucky-owner-token`(admin.js 就存在这个键上)。
         头一版我照别处的习惯猜了个 `ll_admin_token` —— 页面当场 401,
         这也是为什么 UI 一定要在浏览器里看一眼:断言绿不代表老板打开是好的(L1)。 */
      const tok = localStorage.getItem('lucky-owner-token')
        || (typeof owner === 'object' && owner && owner.token) || ''
      if (tok) h.authorization = `Bearer ${tok}`
    } catch (e) { /* 没登录就不带,后端会回 401,页面如实说 */ }
    return h
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  /* 后端给 null = 还没人审过 → 「—」,不是 0%(零回落) */
  const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(0)}%` : '—')
  const conf = (v) => (typeof v === 'number' ? v.toFixed(2) : '—')

  let mounted = null

  async function load() {
    if (!mounted) return
    const body = mounted.querySelector('[data-ai-review-body]')
    const head = mounted.querySelector('[data-ai-review-stats]')
    try {
      /* 一律带窗:页面上写「近 7 天」,数就必须是近 7 天的(05k 那版写「本周」其实是全部历史) */
      const r = await fetch(`${API}/admin/ai/review/pending?since=7d`, { headers: authHeaders() })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      const s = data.stats || {}
      head.innerHTML = `
        <span class="pill">近 7 天模型放行 <b>${s.modelPassInWindow ?? s.modelPassThisWeek ?? '—'}</b></span>
        <span class="pill">老板认可率 <b>${pct(s.approvalRate)}</b></span>
        <span class="pill">反问率 <b>${pct(s.askBackRate)}</b></span>`
      const rows = data.pending || []
      if (!rows.length) {
        /* 空态如实说,不装作坏了(占位零回落同族) */
        body.innerHTML = '<p class="subtle">这一批没有待审的回复 —— 模型放行的每一轮都已经看过了。</p>'
        return
      }
      body.innerHTML = rows.map((it) => `
        <div class="admin-card ai-review-item" data-conv="${esc(it.conversationId)}" data-turn="${esc(it.turnIndex)}">
          <p class="subtle">顾客说:<b>${esc(it.customerMessage) || '(这一轮没抓到原话)'}</b></p>
          <p>AI 答:${esc(it.reply)}</p>
          <p class="subtle">intent: ${esc(it.intent) || '—'} · confidence: ${conf(it.confidence)}</p>
          <div class="row-actions">
            <button type="button" class="primary" data-verdict="ok">对</button>
            <button type="button" class="ghost" data-verdict="revised">改一句</button>
            <button type="button" class="ghost" data-verdict="rejected">不该答</button>
          </div>
          <textarea class="hidden" data-revise placeholder="改成该说的那句话"></textarea>
        </div>`).join('')
    } catch (e) {
      body.innerHTML = `<p class="subtle">待审列表没取到(${esc(e.message)})—— 刷新看看。</p>`
    }
  }

  async function judge(card, verdict) {
    const box = card.querySelector('[data-revise]')
    if (verdict === 'revised' && box.classList.contains('hidden')) {
      box.classList.remove('hidden')   // 头一下先把框亮出来,让老板写
      box.focus()
      return
    }
    const payload = {
      conversationId: card.dataset.conv,
      turnIndex: Number(card.dataset.turn),
      verdict,
      revisedReply: verdict === 'revised' ? box.value.trim() : '',
    }
    if (verdict === 'revised' && !payload.revisedReply) { box.focus(); return }
    const r = await fetch(`${API}/admin/ai/review/judge`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
    })
    if (!r.ok) {
      card.insertAdjacentHTML('beforeend', `<p class="subtle">没记上(HTTP ${r.status})—— 再点一次试试。</p>`)
      return
    }
    await load()   // 重新取:三个数与列表都由后端现算,前端不自己加减
  }

  function mount() {
    const page = document.getElementById('wechatMockPage')
    if (!page || document.getElementById('aiReviewPanel')) return
    const wrap = document.createElement('section')
    wrap.className = 'admin-card'
    wrap.id = 'aiReviewPanel'
    wrap.innerHTML = `
      <div class="section-row">
        <h2>待审 · 模型放行的回复</h2>
        <div class="pill-row" data-ai-review-stats></div>
      </div>
      <p class="subtle">这里只列**模型自己放行**的那些轮次;规则出的话(报价、预约、事实闸)不在这儿。</p>
      <div data-ai-review-body></div>`
    page.appendChild(wrap)
    mounted = wrap
    wrap.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-verdict]')
      if (!btn) return
      const card = btn.closest('.ai-review-item')
      if (card) judge(card, btn.dataset.verdict)
    })
    load()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()
  /* 切到这一页时刷新一次(老板可能刚在别处判过) */
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-admin-page="wechatMock"]')) setTimeout(load, 50)
  })
})()
