/* 员工端「我的客人」(2026-08-27,店主走查回执 ④)。

   两条道理写在这儿,免得下次有人往这页加东西:
   ①**看不到的东西不该出现在菜单里** —— 会员套餐/券那处「点了才报错」就是反面教材;
   ②但也不能全藏 —— 技师看自己服务过的客人是干活要用的,所以给这一页:
     只列他服务过的、**只读**、**零金额编辑入口**(改余额、退卡是老板的口)。
   判据里数的就是第 ② 条:这页上账户调整/充值类按钮数必须为 0。 */
window.MyCustomers = (function () {
  async function render(box, { zh, request, escapeHtml, dateOnly, toast }) {
    if (!box) return
    box.innerHTML = `<h2>${zh ? '我的客人' : 'My clients'}</h2><p class="subtle">${zh ? '读取中…' : 'Loading…'}</p>`
    try {
      const d = await request('/admin/my-customers')
      const list = d.customers || []
      box.innerHTML = `
        <h2>${zh ? '我的客人' : 'My clients'}</h2>
        <p class="subtle">${escapeHtml(d.note || '')}</p>
        ${list.length ? list.map((c) => `
          <article class="customer-profile-card card" data-my-customer="${escapeHtml(c.id)}" style="cursor:pointer">
            <div class="customer-avatar">${escapeHtml(String(c.displayName || '?').slice(0, 1).toUpperCase())}</div>
            <div>
              <h3>${escapeHtml(c.displayName)}</h3>
              <p class="subtle">${escapeHtml(c.memberCode || '')}${c.phoneMasked ? ` · ${escapeHtml(c.phoneMasked)}` : ''}</p>
            </div>
            <div class="customer-stats">
              <span>${zh ? '服务次数' : 'Visits'} <strong>${c.visits}</strong></span>
              <span>${zh ? '最近' : 'Last'} <strong>${escapeHtml(dateOnly(c.lastVisitAt))}</strong></span>
            </div>
          </article>`).join('')
        : `<div class="empty-state"><strong>${zh ? '还没有服务过的客人' : 'No clients yet'}</strong></div>`}`
      box.onclick = (e) => {
        const card = e.target.closest('[data-my-customer]')
        if (card) open(box, card.dataset.myCustomer, { zh, request, escapeHtml, dateOnly, toast })
      }
    } catch (e) {
      box.innerHTML = `<h2>${zh ? '我的客人' : 'My clients'}</h2><div class="empty-state"><strong>${escapeHtml(e.message)}</strong></div>`
    }
  }
  /* 点开一位客人:基本信息 / 到店记录 / 服务历史 / 偏好 + 能写服务小记。
     🔴 这一页**不许出现任何钱的入口**(余额·充值·赠送·退卡·冲销·会员等级)——
     判据两向:钱的按钮数 = 0(负向)且 写小记接口 200(正向)。
     偏好不用人另填:服务小记本来就会被 AI 拆成 偏好/款式/安全项,这里直接显示那份结果。 */
  async function open(box, userId, { zh, request, escapeHtml, dateOnly, toast }) {   // dateOnly 只列表页用;详情页的日期与状态都由后端出句
    box.innerHTML = `<p class="subtle">${zh ? '读取中…' : 'Loading…'}</p>`
    try {
      const d = await request(`/admin/my-customers/${encodeURIComponent(userId)}`)
      const c = d.customer
      box.innerHTML = `
        <button class="ghost slim" data-my-back type="button">← ${zh ? '我的客人' : 'Back'}</button>
        <h2>${escapeHtml(c.displayName)}</h2>
        <p class="subtle">${escapeHtml(c.memberCode || '')}${c.phoneMasked ? ` · ${escapeHtml(c.phoneMasked)}` : ''}</p>
        <p class="subtle">${escapeHtml(d.note || '')}</p>
        ${(c.tags || []).length ? `<div class="customer-tags">${c.tags.map((t) => `<span class="customer-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <h3>${zh ? '服务历史' : 'Service history'}</h3>
        ${(d.bookings || []).length ? (d.bookings || []).map((b) => `
          <div class="info-card-web card">
            <p><span>${escapeHtml(b.atText || '')}</span><strong>${escapeHtml(b.serviceName || '')}</strong></p>
            <p class="subtle">${escapeHtml(b.statusText || '')}</p>
          </div>`).join('') : `<p class="subtle">${zh ? '还没有记录' : 'None yet'}</p>`}
        ${(d.safetyFlags || []).length ? `<p class="subtle">${zh ? '安全项' : 'Safety'}:${escapeHtml((d.safetyFlags || []).join('、'))}</p>` : ''}
        ${(d.preferences || []).length ? `<h3>${zh ? '偏好' : 'Preferences'}</h3><div class="customer-tags">${(d.preferences || []).map((t) => `<span class="customer-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <h3>${zh ? '服务小记' : 'Notes'}</h3>
        <textarea id="myNoteBody" rows="2" placeholder="${zh ? '例:偏爱裸色、指甲偏薄,卸甲要轻' : 'Notes'}"></textarea>
        ${/* 小记图片(08-30f):≤9 张,拍照/相册;空态=只剩添加钮,零占位假图;已存小记只追加不可删改 */''}
        <div class="mn-imgrow" id="mnImgRow"></div>
        <div class="inline-actions">
          <button class="ghost slim" data-my-imgs type="button">${zh ? '＋ 添加图片(最多9张)' : '+ Images (max 9)'}</button>
          <input id="mnImgFile" type="file" accept="image/*" multiple style="display:none">
          <button class="ghost slim" data-my-note="1" type="button">${zh ? '记一条小记' : 'Add note'}</button>
        </div>
        ${(d.notes || []).map((n) => `
          <div class="info-card-web card">
            <p><span>${escapeHtml(n.serviceName || (zh ? '小记' : 'Note'))}</span><span class="subtle">${escapeHtml(n.createdText || '')}</span></p>
            <p>${escapeHtml(n.body)}</p>
            ${(n.images || []).length ? `<div class="mn-thumbs">${n.images.map((im) => `<img class="mn-thumb" src="${im}" alt="小记图片">`).join('')}</div>` : ''}
          </div>`).join('')}`
      let draftImages = []
      const drawDraft = () => {
        const row = document.querySelector('#mnImgRow')
        if (row) row.innerHTML = draftImages.map((im, i) => `<span class="mn-tile"><img class="mn-thumb" src="${im}"><button class="mn-del" data-my-imgdel="${i}" type="button">✕</button></span>`).join('')
      }
      box.onclick = async (e) => {
        if (e.target.closest('[data-my-back]')) { render(box, { zh, request, escapeHtml, dateOnly, toast }); return }
        if (e.target.closest('[data-my-imgs]')) { document.querySelector('#mnImgFile')?.click(); return }
        const del = e.target.closest('[data-my-imgdel]')
        if (del) { draftImages.splice(Number(del.dataset.myImgdel), 1); drawDraft(); return }   // 草稿可移;已存只追加
        const btn = e.target.closest('[data-my-note]')
        if (!btn) return
        const body = (document.querySelector('#myNoteBody') || {}).value || ''
        try {
          // 写口复用现成的服务小记接口(它带 AI 结构化,偏好就是从这里拆出来的);不另开第二个口
          await request('/admin/service-notes', { method: 'POST', body: JSON.stringify({ userId, rawText: body, images: draftImages }) })
          draftImages = []
          open(box, userId, { zh, request, escapeHtml, dateOnly, toast })
        } catch (err) { toast(err.message) }
      }
      box.addEventListener('change', (e) => {
        if (e.target.id !== 'mnImgFile') return
        const files = [...(e.target.files || [])].slice(0, 9 - draftImages.length)
        files.forEach((f) => {
          const rd = new FileReader()
          rd.onload = () => { if (draftImages.length < 9) { draftImages.push(String(rd.result)); drawDraft() } }
          rd.readAsDataURL(f)
        })
        e.target.value = ''
      })
    } catch (e) {
      box.innerHTML = `<div class="empty-state"><strong>${escapeHtml(e.message)}</strong></div>`
    }
  }

  return { render, open }
})()
