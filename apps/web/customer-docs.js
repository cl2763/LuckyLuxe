/* 签署文件留档 · 网页商家端(10b 第一步)
 *
 * 合同:Artifact「签署文件留档」v2。**文案逐字抄图**,不是我写的。
 * 🔴 为什么单独一个文件:`admin.js` 棘轮 7,928 只许降不许升(10b §二 裁:整块抽出来,挂载点留在 admin.js)。
 * 🔴 本文件只做商家端。顾客端只读是第二步,这里一个字都不碰。
 *
 * 所有**句子**都从后端拿(`emptyText` / `listMetaText` / `statusText` / `voidButtonText` …)——
 * 假数回落红线③:同一个事实在网页商家端、小程序商家端、将来顾客端必须说同一句话,前端零拼串。
 */
;(function () {
  const MAX_PAGES = 20
  const state = { userId: null, userName: '', pages: [], docType: 'rights', title: '', customerVisible: null, types: [] }

  const esc = (s) => window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  /* `owner` 是 `admin.js` 的词法全局,取不到时**不许当成"没切走"**(那会把守卫变成摆设);
     取不到就回 null,让上面那条判断照常成立 —— 而判据 ⑨ 盯着「这里不许再出现 window.owner」。 */
  const currentCustomerId = () => { try { return owner.selectedCustomerId } catch { return null } }
  const say = (m) => { if (typeof window.toast === 'function') window.toast(m); else console.warn(m) }

  /* ── 屏 1:顾客档案里的区块(两态)───────────────────────────── */
  window.renderSignedDocsBlock = function (customerId, customerName) {
    const host = document.querySelector('#signedDocsBody')
    if (!host) return
    state.userId = customerId; state.userName = customerName || '顾客'
    window.request(`/admin/customers/${encodeURIComponent(customerId)}/signed-docs`)
      .then((data) => {
        const target = document.querySelector('#signedDocsBody')
        /* 🔴 这里原来写的是 `window.owner && window.owner.selectedCustomerId !== customerId` ——
           **浏览器现测:`window.owner` 是 `undefined`**(`admin.js` 里 `owner` 是 `const`,
           词法全局,不挂到 `window` 上;而 `request` / `toast` / `escapeHtml` 是 `function` 声明,挂得上)。
           于是这条「用户已切走就丢弃」的守卫**一次都没生效** —— 静默失败器族的又一例:
           `&&` 短路把「守不住」悄悄变成了「不守」。邻居 `customer-notes.js` 用的就是裸 `owner`,照它。 */
        if (!target || currentCustomerId() !== customerId) return
        state.types = data.types || []
        const docs = data.docs || []
        const head = document.querySelector('#signedDocsMore')
        if (head) head.innerHTML = docs.length ? `${esc(data.moreText)} ›` : ''
        if (!docs.length) {
          /* 图:空态直接摆上传按钮,不用先点进去再找 */
          target.innerHTML = `
            <div class="signed-docs-empty">${esc(data.emptyText)}<br>${esc(data.emptyHint)}</div>
            <button class="primary slim" type="button" data-signed-upload="${esc(customerId)}">+ 上传文件</button>`
          return
        }
        target.innerHTML = `
          <div class="signed-docs-list">${docs.map((d) => `
            <button class="signed-doc-row${d.status === 'voided' ? ' is-voided' : ''}" type="button" data-signed-open="${esc(d.id)}">
              <span class="signed-doc-thumb" aria-hidden="true"></span>
              <span class="signed-doc-text">
                <span class="signed-doc-title">${esc(d.title)}</span>
                <span class="signed-doc-meta">${esc(d.profileMetaText)}</span>
              </span>
              <span class="signed-doc-pill ${d.status === 'voided' ? 'is-voided' : 'is-ok'}">${esc(d.statusText)}</span>
            </button>`).join('')}</div>
          <button class="ghost slim" type="button" data-signed-upload="${esc(customerId)}">+ 上传文件</button>`
      })
      .catch((e) => { const t = document.querySelector('#signedDocsBody'); if (t) t.innerHTML = `<p class="subtle">${esc(e.message || '加载失败')}</p>` })
  }

  /* ── 屏 2 + 屏 3:选类型 → 拍照/选图 → 多页 → 存 ────────────── */
  function openUpload() {
    state.pages = []; state.docType = 'rights'; state.title = ''; state.customerVisible = null
    const types = state.types.length ? state.types : [
      { key: 'rights', label: '会员充值权益确认书', customerVisible: true },
      { key: 'pricelist', label: '价格表确认书', customerVisible: true },
      { key: 'other', label: '其他 · 自己写名字', customerVisible: false }]
    const el = document.createElement('div')
    el.className = 'modal-backdrop'
    el.id = 'signedDocsModal'
    el.innerHTML = `
      <div class="modal-card" role="dialog" aria-label="上传签署文件">
        <div class="modal-head"><h3>上传签署文件</h3><button class="ghost slim" type="button" data-signed-cancel>取消</button></div>
        <p class="subtle">这是哪一份?</p>
        <div class="signed-type-list">${types.map((t) => `
          <label class="signed-type${t.key === 'rights' ? ' is-on' : ''}" data-signed-type="${esc(t.key)}">
            <span>${esc(t.label)}</span><input type="radio" name="signedDocType" value="${esc(t.key)}"${t.key === 'rights' ? ' checked' : ''}>
          </label>`).join('')}</div>
        <label class="signed-title-row" hidden><span>名字</span><input id="signedDocTitle" maxlength="60" placeholder="自己写个名字"></label>
        <label class="signed-visible-row"><input type="checkbox" id="signedDocVisible" checked> <span>给顾客看(顾客在自己那边能看到这一份)</span></label>
        <div class="signed-shots" id="signedShots"></div>
        <p class="subtle">多页的价格表可以连着拍,存成同一份。</p>
        <div class="modal-actions">
          <label class="btn-like">拍照<input type="file" accept="image/*" capture="environment" hidden id="signedShoot"></label>
          <label class="btn-like ghost">从相册选择<input type="file" accept="image/*" multiple hidden id="signedPick"></label>
        </div>
        <button class="primary" type="button" id="signedSave" disabled>存进${esc(state.userName)}的档案</button>
      </div>`
    document.body.appendChild(el)
    const sync = () => {
      const box = el.querySelector('#signedShots')
      /* 图屏3 标题栏有「重拍」。网页把屏2/屏3 合成了一个弹层(桌面上分两步反而绕),
         所以「重拍」落在每一页上:点哪一页就撤哪一页,重新拍进来。差异已写进本批差异说明。 */
      box.innerHTML = state.pages.map((p, i) => `<span class="signed-shot" data-signed-redo="${i}" title="点一下重拍这一页"><img src="${p}" alt=""><b>第 ${i + 1} 页 · 重拍</b></span>`).join('')
        + (state.pages.length && state.pages.length < MAX_PAGES ? '<span class="signed-shot is-add">+ 加一页</span>' : '')
      el.querySelector('#signedSave').disabled = !state.pages.length
    }
    const readFiles = (files) => {
      const list = Array.from(files || [])
      if (state.pages.length + list.length > MAX_PAGES) { say(`一份最多 ${MAX_PAGES} 页。`); return }
      list.forEach((f) => {
        const fr = new FileReader()
        fr.onload = () => { state.pages.push(String(fr.result)); sync() }
        fr.onerror = () => say('这张图读不出来,换一张试试。')     // 波及面回归律④:异步调用一律有 fail 处理
        fr.readAsDataURL(f)
      })
    }
    box_redo(el, sync)
    el.querySelector('#signedShoot').addEventListener('change', (e) => readFiles(e.target.files))
    el.querySelector('#signedPick').addEventListener('change', (e) => readFiles(e.target.files))
    el.querySelectorAll('[data-signed-type]').forEach((node) => node.addEventListener('click', () => {
      state.docType = node.dataset.signedType
      el.querySelectorAll('[data-signed-type]').forEach((n) => n.classList.toggle('is-on', n === node))
      el.querySelector('.signed-title-row').hidden = state.docType !== 'other'
      /* 图 v2:类型换了,「给顾客看」跟着回到该类型的默认值(other 默认不给看) */
      const def = (state.types.find((t) => t.key === state.docType) || {}).customerVisible
      el.querySelector('#signedDocVisible').checked = def === undefined ? state.docType !== 'other' : Boolean(def)
    }))
    el.querySelector('[data-signed-cancel]').addEventListener('click', () => el.remove())
    el.addEventListener('click', (e) => { if (e.target === el) el.remove() })
    el.querySelector('#signedSave').addEventListener('click', () => {
      const title = (el.querySelector('#signedDocTitle').value || '').trim()
      if (state.docType === 'other' && !title) { say('「其他」要自己写个名字。'); return }
      const btn = el.querySelector('#signedSave'); btn.disabled = true
      window.request(`/admin/customers/${encodeURIComponent(state.userId)}/signed-docs`, {
        method: 'POST',
        body: JSON.stringify({ docType: state.docType, title, pages: state.pages, customerVisible: el.querySelector('#signedDocVisible').checked }),
      }).then(() => { el.remove(); say('存好了。'); window.renderSignedDocsBlock(state.userId, state.userName) })
        .catch((err) => { btn.disabled = false; say(err.message || '没存上') })
    })
    sync()
  }

  /* 点某一页 = 撤掉它重拍(图屏3 的「重拍」)。挂在容器上,页数变了也不用重绑。 */
  function box_redo(el, sync) {
    el.querySelector('#signedShots').addEventListener('click', (e) => {
      const n = e.target.closest && e.target.closest('[data-signed-redo]')
      if (!n) return
      state.pages.splice(Number(n.dataset.signedRedo), 1)
      sync()
    })
  }

  /* ── 屏 4:详情 + 标为作废(🔴 没有删除按钮)──────────────── */
  function openDetail(docId) {
    window.request(`/admin/signed-docs/${encodeURIComponent(docId)}`).then((data) => {
      const d = data.doc
      const el = document.createElement('div')
      el.className = 'modal-backdrop'
      el.innerHTML = `
        <div class="modal-card" role="dialog" aria-label="${esc(d.title)}">
          <div class="modal-head"><h3>${esc(d.title)}</h3><button class="ghost slim" type="button" data-signed-cancel>关闭</button></div>
          <div class="signed-pages">${(data.pages || []).map((p) => window.ImgPlaceholder.tag(
              /* `url || data` 不是回落:COS 存的给 url、inline 存的给 data,**同一页的两种存法,不是两个语义**。
                 两个都空才是真的没有 —— 那时走唯一出口 `ImgPlaceholder.tag` 出占位(占位零回落律),
                 绝不留一个 `src=""` 让浏览器画个碎图图标,那看起来像「有图但坏了」。 */
              p.url || p.data, { alt: `第 ${p.pageNo} 页` })).join('')}</div>
          <div class="signed-kv"><span>顾客</span><span>${esc(state.userName)}</span></div>
          <div class="signed-kv"><span>上传</span><span>${esc(d.uploadedText)}</span></div>
          <div class="signed-kv"><span>页数</span><span>${esc(d.pageCountText)}</span></div>
          <div class="signed-kv"><span>状态</span><span class="${d.status === 'voided' ? 'is-voided' : 'is-ok'}">${esc(d.statusText)}</span></div>
          ${d.status === 'voided'
            ? `<p class="subtle">${esc(d.listMetaText)}${d.voidReason ? ` · ${esc(d.voidReason)}` : ''}</p>`
            : `<button class="ghost" type="button" data-signed-void="${esc(d.id)}">${esc(data.voidButtonText)}</button>`}
        </div>`
      document.body.appendChild(el)
      el.querySelector('[data-signed-cancel]').addEventListener('click', () => el.remove())
      el.addEventListener('click', (e) => { if (e.target === el) el.remove() })
      const vb = el.querySelector('[data-signed-void]')
      if (vb) vb.addEventListener('click', async () => {
        /* 🔴 原因必填 —— 前端问一句只是体验,后端才是最终闸(判据五)。
           🔴 走 `window.UIDialog.text`,不许用原生 `prompt`:全仓 44 个 apps/web/*.js 的
           原生对话框早就清到 **0 残留**了(34 → 0),白名单也是 0。
           我第一版随手写了 `window.prompt`,`test-native-dialog` ① 当场把它揪出来 ——
           原生弹窗在真机/内嵌浏览器里可能**根本不弹**,而 fail 是静默的(弹层实点律)。 */
        const reason = await window.UIDialog.text('为什么要作废这一份?(必填,会连同你的名字一起记下来)', '')
        if (reason === null || reason === undefined) return
        window.request(`/admin/signed-docs/${encodeURIComponent(d.id)}/void`, { method: 'POST', body: JSON.stringify({ reason: String(reason || '').trim() }) })
          .then(() => { el.remove(); say('已标为作废,原件还在。'); window.renderSignedDocsBlock(state.userId, state.userName) })
          .catch((err) => say(err.message || '没作废成'))
      })
    }).catch((e) => say(e.message || '打不开'))
  }

  document.addEventListener('click', (e) => {
    const up = e.target.closest && e.target.closest('[data-signed-upload]')
    if (up) { e.preventDefault(); openUpload(); return }
    const open = e.target.closest && e.target.closest('[data-signed-open]')
    if (open) { e.preventDefault(); openDetail(open.dataset.signedOpen) }
  })
})()
