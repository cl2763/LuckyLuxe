(async () => {
  const R = { fam1: [], fam2: [], fam3: [], fam4: [], fam5: [] }
  const ok = (f, n) => R[f].push('✓' + n)
  const bad = (f, n, d) => R[f].push('✗' + n + (d ? ':' + String(d).slice(0, 60) : ''))
  const auth = JSON.parse(localStorage.getItem('lucky-owner-auth') || '{}')
  const tok = auth.accessToken || ''
  const api = async (p, opt) => { const r = await fetch(p, Object.assign({ headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' } }, opt)); let d = null; try { d = await r.json() } catch {} return { status: r.status, data: d } }
  const $ = (s) => document.querySelector(s)
  const $$ = (s) => [...document.querySelectorAll(s)]
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const clickMenu = async (label) => { const b = $$('.menu button, aside button').find((x) => (x.textContent || '').includes(label)); if (!b) return false; b.click(); await sleep(900); return true }

  /* ===== ① 三端同步性:界面显示值 === API 真值(API=小程序同读口) ===== */
  try {
    const qsApi = (await api('/admin/quote-settings')).data
    await clickMenu('门店设置')
    const t = $$('.settings-item-title').find((x) => x.textContent.includes('客服与报价'))
    if (t) {
      t.closest('details').open = true; await sleep(700)
      const gap = $('[data-qset="gapHours"]')?.value, valid = $('[data-qset="validHours"]')?.value
      if (String(qsApi.gapHours) === gap && String(qsApi.validHours) === valid) ok('fam1', '报价设置 UI=API(' + gap + '/' + valid + ')')
      else bad('fam1', '报价设置 UI≠API', gap + '/' + valid + ' vs ' + qsApi.gapHours + '/' + qsApi.validHours)
    } else bad('fam1', '客服与报价行缺')
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())
    const sd = (await api('/admin/schedule-day?date=' + today)).data
    await clickMenu('订单管理'); const tb = $$('button').find((x) => x.textContent.trim() === '今天'); if (tb) { tb.click(); await sleep(1000) }
    const pill = $('.tb-summary')
    if (sd && sd.hoursUnset) { ok('fam1', '台面=未设置墙(该店无时段,如实)') }
    else if (pill && sd) {
      const uiTotal = (pill.textContent.match(/今日\s*(\d+)/) || [])[1]
      if (String((sd.bookings || []).length) === uiTotal) ok('fam1', '台面单数 UI=API(' + uiTotal + ')')
      else bad('fam1', '台面单数 UI≠API', uiTotal + ' vs ' + (sd.bookings || []).length)
    } else if (!pill) ok('fam1', '台面无 summary(店休/未设置形态,如实)')
  } catch (e) { bad('fam1', '异常', e.message) }

  /* ===== ② 商家隔离:拿本店会话摸别店资产必须摸不到 ===== */
  try {
    const luckyCathy = 'user_mslqdy0b_xpogkb'
    const me = (await api('/admin/tenant/me').catch(() => null))
    const look = await api('/admin/customers/lookup?userId=' + luckyCathy)
    const isLucky = (window.__JURY_STORE === 'lucky-luxe')
    if (isLucky) { look.data && look.data.hit ? ok('fam2', '本店档案可查(lucky 自查)') : bad('fam2', 'lucky 自查竟无 hit') }
    else { look.data && !look.data.hit ? ok('fam2', '跨店档案查=null(' + ((look.data.reason || '').slice(0, 12) || '空') + ')') : bad('fam2', '跨店档案竟有 hit!') }
    const jicsBooking = 'booking_mti8w8wm_p9bnux'
    const bs = await api('/admin/settlements?bookingId=' + jicsBooking)
    const isJics = (window.__JURY_STORE === 'jics-nail')
    if (isJics) ok('fam2', '本店单可读(jics 自查)')
    else { (bs.status !== 200 || !(bs.data.settlements || bs.data.sheets || []).length) ? ok('fam2', '跨店单读不到') : bad('fam2', '跨店单读到了!') }
  } catch (e) { bad('fam2', '异常', e.message) }

  /* ===== ③ 会员隔离:别店会员码在本店必须查不到 ===== */
  try {
    const code = window.__LUCKY_MEMBERCODE || ''
    if (!code) bad('fam3', '缺 lucky 会员码夹具')
    else {
      const r = await api('/admin/customers/lookup?memberCode=' + encodeURIComponent(code))
      const isLucky = (window.__JURY_STORE === 'lucky-luxe')
      if (isLucky) { r.data && r.data.hit ? ok('fam3', '本店会员码可查') : bad('fam3', 'lucky 自查会员码无 hit') }
      else { r.data && !r.data.hit ? ok('fam3', '跨店会员码=null') : bad('fam3', '跨店会员码查到了!') }
    }
  } catch (e) { bad('fam3', '异常', e.message) }

  /* ===== ④ 财务链:充值 $1 → 冲销(UI 真点账调弹层) ===== */
  try {
    await clickMenu('客户档案'); await sleep(600)
    const adj = $$('button').find((b) => b.textContent.trim() === '账户调整' && b.offsetParent)
    if (!adj) bad('fam4', '无账调按钮(无顾客?)')
    else {
      adj.click(); await sleep(1000)
      const amt = $('[data-aa-amount], .aa-field input[inputmode], input[data-aa-recharge-amt]')
      const before = (await api('/admin/stored-value/txns?month=' + new Date().toISOString().slice(0, 7))).data
      const beforeN = (before.txns || []).length
      const amtIn = $$('input').find((i) => i.offsetParent && /金额|amount/.test(i.placeholder || '') ) || amt
      if (!amtIn) bad('fam4', '充值金额框没找到')
      else {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(amtIn, '1'); amtIn.dispatchEvent(new Event('input', { bubbles: true }))
        const submit = $$('button').find((b) => /确认到账|充值到账|确认充值/.test(b.textContent) && b.offsetParent)
        if (!submit) bad('fam4', '充值提交钮没找到')
        else {
          const oldConfirm = window.confirm; window.confirm = () => true
          submit.click(); await sleep(1400); window.confirm = oldConfirm
          const after = (await api('/admin/stored-value/txns?month=' + new Date().toISOString().slice(0, 7))).data
          const rows = (after.txns || [])
          const mine = rows.filter((t2) => t2.type === 'recharge' && t2.amountCents === 100)
          if (rows.length > beforeN && mine.length) {
            ok('fam4', 'UI 充值 $1 落账')
            const rid = mine[mine.length - 1].id
            const rev = await api('/admin/stored-value/txns/' + rid + '/reverse', { method: 'POST', body: JSON.stringify({ reason: 'UI 轮测冲销' }) })
            rev.status === 200 ? ok('fam4', '冲销回 200(红字反向)') : bad('fam4', '冲销失败', rev.status)
          } else bad('fam4', '充值后账本行没长', rows.length + '<=' + beforeN)
        }
      }
      $$('button').filter((b) => /^[×✕]$/.test(b.textContent.trim()) && b.offsetParent).forEach((b) => b.click()); await sleep(300)
    }
  } catch (e) { bad('fam4', '异常', e.message) }

  /* ===== ⑤ 排班链:点空档直排(真点)→ API 见单;值日开→勾→关 ===== */
  try {
    await clickMenu('订单管理'); const tb2 = $$('button').find((x) => x.textContent.trim() === '今天'); if (tb2) { tb2.click(); await sleep(1100) }
    const free = $('.tb-blk.free')
    if (!free) ok('fam5', '无空档可点(未设置/店休形态,如实)')
    else {
      free.click(); await sleep(900)
      const q = $('[data-tbf-q]')
      if (!q) bad('fam5', '直排面板没开')
      else {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(q, 'UI轮测客' + Date.now().toString(36).slice(-4)); q.dispatchEvent(new Event('input', { bubbles: true })); await sleep(500)
        const svcChip = $$('[data-tbf-svc]').find((c) => c.offsetParent)
        if (svcChip) { svcChip.click(); await sleep(400) }
        const sub = $('[data-tbf-submit]')
        sub.click(); await sleep(1500)
        const today2 = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())
        const sd2 = (await api('/admin/schedule-day?date=' + today2)).data
        const hasNew = (sd2.bookings || []).some((b) => true)
        hasNew ? ok('fam5', '真点直排落单(板上可见)') : bad('fam5', '直排后板上无单')
      }
    }
    const duty0 = (await api('/admin/duty-setting')).data
    await api('/admin/duty-setting', { method: 'PUT', body: JSON.stringify({ enabled: true }) })
    const today3 = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())
    const sdD = (await api('/admin/schedule-day?date=' + today3)).data
    if (sdD && sdD.duty && sdD.duty.enabled !== undefined) ok('fam5', '值日开=响应带 duty 块')
    else if (sdD && sdD.hoursUnset) ok('fam5', '值日:无时段店如实无台面')
    else bad('fam5', '值日开了响应没 duty')
    await api('/admin/duty-setting', { method: 'PUT', body: JSON.stringify({ enabled: Boolean(duty0 && duty0.enabled) }) })
  } catch (e) { bad('fam5', '异常', e.message) }

  return JSON.stringify({ store: window.__JURY_STORE, r: R })
})()
