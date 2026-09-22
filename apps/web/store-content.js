/* 网页商家后台 · 门店内容域(2026-08-28 D78 批,公约②「边改边拆」)。

   两件事住在这里:
     ① **搬**:门店信息三件(renderStoreInfo / renderStoreProfile / saveStoreProfile)整块从 admin.js 搬出,
        **只搬不改行为**,依赖(owner / els / t / request / escapeHtml / toast 等全局)在运行期解析,
        admin.html 里本文件排在 admin.js 之前加载 —— 与 ai-desk.js 同一套做法。
     ② **加**:D78 顾客首页轮播的商家自管面板(上传 / 排序 / 文案 / 启停)。

   为什么新面板不写进 admin.js:《棘轮律》—— 那两个巨型文件只许降不许升;
   而且轮播这件事本来就属于"门店内容",与门店信息同域。

   ⚠️ 这一屏**没有设计图**(L3 无图不结案律):结构与样式一律照抄同页现有的
   settings-item / kb-facts-grid 写法,不另起一套;像素级验收挂 ⬜ 等 Cowork 补图。 */

function renderStoreInfo() {
  if (!els.storeInfoSummary || !els.storeInfoBody) return
  // 🔴 永久律(店主 08-23):拿不到就显示「—」,绝不回落成旗舰店 id ——
  // 非旗舰商家会在自己的后台看到别人家的商户 ID。
  const tenantId = owner.tenantPlan?.tenantId || ''
  const store = (owner.businessHoursStores || [])[0]
  els.storeInfoSummary.textContent = tenantId || '—'
  const rows = [
    [owner.lang === 'zh' ? '商户 ID' : 'Tenant ID', tenantId || '—'],
    [owner.lang === 'zh' ? '门店 ID' : 'Store ID', store?.id || '-'],
    [owner.lang === 'zh' ? '门店名称' : 'Store name', store?.name || '-'],
    [owner.lang === 'zh' ? '当前套餐' : 'Plan', owner.tenantPlan?.plan || '-']
  ]
  els.storeInfoBody.innerHTML = `
    <table class="store-info-table">
      ${rows.map(([label, value]) => `
        <tr>
          <td>${escapeHtml(label)}</td>
          <td><code>${escapeHtml(String(value))}</code></td>
          <td><button class="ghost slim" data-copy-value="${escapeHtml(String(value))}" type="button">${owner.lang === 'zh' ? '复制' : 'Copy'}</button></td>
        </tr>`).join('')}
    </table>
    <p class="subtle">${owner.lang === 'zh' ? '联系技术支持或反馈问题时，提供商户 ID 和门店 ID 可以快速定位你的数据。' : 'Share the tenant and store IDs with support to locate your data quickly.'}</p>
  `
}

function renderStoreProfile() {
  const body = document.querySelector('#storeProfileBody')
  const summary = document.querySelector('#storeProfileSummary')
  if (!body || !summary) return
  const store = (owner.businessHoursStores || [])[0]
  if (!store) {
    summary.textContent = '-'
    body.innerHTML = ''
    return
  }
  /* 🔴 11k 出口普查抓到的第 11、12 处:这两行原来各手写一份 `/tbd/i` —— 只认三个字母。
     而这里是**输入框**:「待补充」这类值会被预填进去,商家一点保存就**存成了真地址**。
     换成两端同源的词表出口(placeholder-words.js),admin.html 里已排在本文件之前加载。 */
  const addressUsable = window.LLPlaceholder.realValue(store.address)
  summary.textContent = addressUsable || (owner.lang === 'zh' ? '⚠ 地址未设置' : '⚠ Address not set')
  summary.classList.toggle('plan-expired', !addressUsable)
  body.innerHTML = `
    <div class="kb-facts-grid">
      <label><span>${owner.lang === 'zh' ? '门店名称' : 'Store name'}</span><input id="storeProfileName" value="${escapeHtml(store.name || '')}"></label>
      <label><span>${owner.lang === 'zh' ? '门店地址' : 'Address'}</span><input id="storeProfileAddress" value="${escapeHtml(addressUsable)}"></label>
      <label><span>${owner.lang === 'zh' ? '联系电话' : 'Phone'}</span><input id="storeProfilePhone" value="${escapeHtml(window.LLPlaceholder.realValue(store.phone))}"></label>
    </div>
    <button class="primary slim" data-store-profile-save type="button">${owner.lang === 'zh' ? '保存门店信息' : 'Save store info'}</button>
    <p class="subtle">${owner.lang === 'zh' ? '保存后同步到订单系统和 AI 知识库——顾客问路、预约确认、AI 回答三处永远一致。' : 'Saved info syncs to bookings and the AI knowledge base so all three stay consistent.'}</p>
  `
}

async function saveStoreProfile() {
  const store = (owner.businessHoursStores || [])[0]
  if (!store) return
  await request('/admin/store-info', {
    method: 'PUT',
    body: JSON.stringify({
      storeId: store.id,
      name: document.querySelector('#storeProfileName')?.value.trim(),
      address: document.querySelector('#storeProfileAddress')?.value.trim(),
      phone: document.querySelector('#storeProfilePhone')?.value.trim()
    })
  })
  const refreshed = await request('/admin/business-hours')
  owner.businessHoursStores = refreshed.stores || []
  await refreshTenantKb().catch(() => {})
  renderStoreSettings()
  toast(owner.lang === 'zh' ? '门店信息已保存并同步到 AI 知识库' : 'Store info saved and synced')
}

/* ===== D78 · 顾客首页轮播(商家自管) =====
   数据只有一处真相:后端 /admin/hero-slides(读)与同一条路由的 PUT(写),
   顾客端读的是公开 /stores 的同一份数据 —— 前端零写死、零回落。 */

let heroSlidesDraft = null      // 草稿:改了还没保存的那份;null = 还没从后端取过

async function loadHeroSlides() {
  const data = await request('/admin/hero-slides')
  heroSlidesDraft = (data.slides || []).map((slide) => ({
    image: slide.image, labelZh: slide.labelZh || '', labelEn: slide.labelEn || '', isActive: slide.isActive !== false
  }))
  return heroSlidesDraft
}

function renderHeroSlidesPanel() {
  const body = document.querySelector('#heroSlidesBody')
  const summary = document.querySelector('#heroSlidesSummary')
  if (!body || !summary) return
  if (heroSlidesDraft === null) {
    // 首次进设置页:先取一次,取回来再画(取数失败照实说,不画一个空面板骗人)
    loadHeroSlides().then(renderHeroSlidesPanel).catch(() => {
      summary.textContent = owner.lang === 'zh' ? '读取失败' : 'Load failed'
      body.innerHTML = `<div class="empty-state small-empty">${owner.lang === 'zh' ? '轮播图读取失败,刷新页面重试。' : 'Failed to load carousel.'}</div>`
    })
    summary.textContent = owner.lang === 'zh' ? '读取中…' : 'Loading…'
    return
  }
  const zh = owner.lang === 'zh'
  const activeCount = heroSlidesDraft.filter((slide) => slide.isActive).length
  summary.textContent = heroSlidesDraft.length
    ? (zh ? `${activeCount} 张展示中 / 共 ${heroSlidesDraft.length} 张` : `${activeCount} live / ${heroSlidesDraft.length} total`)
    : (zh ? '未设置(顾客首页不出轮播)' : 'Not set (no carousel shown)')
  body.innerHTML = `
    <p class="subtle">${zh
      ? '这些图显示在顾客首页最上方的轮播里。<strong>一张都不放也可以</strong>——那样顾客端就只出店卡,不会显示别家店的图。最多 6 张。'
      : 'These images show in the carousel on the customer home page. Leaving it empty is fine — customers then see the store card only. Up to 6.'}</p>
    <div class="hero-slide-admin-list">
      ${heroSlidesDraft.map((slide, index) => `
        <div class="hero-slide-admin-row card">
          <img src="${slide.image}" alt="${escapeHtml(slide.labelZh || '')}">
          <div class="kb-facts-grid">
            <label><span>${zh ? '文案(中)' : 'Label (zh)'}</span><input data-hero-label-zh="${index}" value="${escapeHtml(slide.labelZh)}" maxlength="40"></label>
            <label><span>${zh ? '文案(英)' : 'Label (en)'}</span><input data-hero-label-en="${index}" value="${escapeHtml(slide.labelEn)}" maxlength="40"></label>
          </div>
          <div class="hero-slide-admin-actions">
            <button class="ghost slim" data-hero-up="${index}" type="button" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button class="ghost slim" data-hero-down="${index}" type="button" ${index === heroSlidesDraft.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="ghost slim" data-hero-toggle="${index}" type="button">${slide.isActive ? (zh ? '展示中' : 'Live') : (zh ? '已停用' : 'Hidden')}</button>
            <button class="ghost slim" data-hero-remove="${index}" type="button">${zh ? '删除' : 'Remove'}</button>
          </div>
        </div>`).join('')}
    </div>
    ${heroSlidesDraft.length ? '' : `<div class="empty-state small-empty">${zh ? '还没有轮播图。' : 'No carousel images yet.'}</div>`}
    <div class="hero-slide-admin-footer">
      <label class="ghost slim hero-slide-upload">${zh ? '添加图片' : 'Add image'}
        <input type="file" accept="image/*" multiple id="heroSlideFile" hidden>
      </label>
      <button class="primary slim" data-hero-save type="button">${zh ? '保存轮播图' : 'Save carousel'}</button>
    </div>
  `
  bindHeroSlidesPanel(body)
}

function bindHeroSlidesPanel(body) {
  const rerender = () => renderHeroSlidesPanel()
  body.querySelectorAll('[data-hero-up]').forEach((btn) => btn.addEventListener('click', () => {
    const i = Number(btn.dataset.heroUp)
    ;[heroSlidesDraft[i - 1], heroSlidesDraft[i]] = [heroSlidesDraft[i], heroSlidesDraft[i - 1]]
    rerender()
  }))
  body.querySelectorAll('[data-hero-down]').forEach((btn) => btn.addEventListener('click', () => {
    const i = Number(btn.dataset.heroDown)
    ;[heroSlidesDraft[i + 1], heroSlidesDraft[i]] = [heroSlidesDraft[i], heroSlidesDraft[i + 1]]
    rerender()
  }))
  body.querySelectorAll('[data-hero-toggle]').forEach((btn) => btn.addEventListener('click', () => {
    const i = Number(btn.dataset.heroToggle)
    heroSlidesDraft[i].isActive = !heroSlidesDraft[i].isActive
    rerender()
  }))
  body.querySelectorAll('[data-hero-remove]').forEach((btn) => btn.addEventListener('click', () => {
    heroSlidesDraft.splice(Number(btn.dataset.heroRemove), 1)
    rerender()
  }))
  /* 文案改动**边输边存进草稿**,不重画 —— 重画会打断输入(店主 08-27 立的「输入过程中不许重画」同族)。 */
  body.querySelectorAll('[data-hero-label-zh]').forEach((input) => input.addEventListener('input', () => {
    heroSlidesDraft[Number(input.dataset.heroLabelZh)].labelZh = input.value
  }))
  body.querySelectorAll('[data-hero-label-en]').forEach((input) => input.addEventListener('input', () => {
    heroSlidesDraft[Number(input.dataset.heroLabelEn)].labelEn = input.value
  }))
  const file = body.querySelector('#heroSlideFile')
  if (file) file.addEventListener('change', () => {
    const picked = Array.from(file.files || [])
    file.value = ''
    picked.forEach((f) => {
      const reader = new FileReader()
      reader.onload = () => {
        heroSlidesDraft.push({ image: String(reader.result || ''), labelZh: '', labelEn: '', isActive: true })
        rerender()
      }
      reader.readAsDataURL(f)
    })
  })
  const save = body.querySelector('[data-hero-save]')
  if (save) save.addEventListener('click', async () => {
    try {
      const data = await request('/admin/hero-slides', { method: 'PUT', body: JSON.stringify({ slides: heroSlidesDraft }) })
      heroSlidesDraft = (data.slides || []).map((slide) => ({
        image: slide.image, labelZh: slide.labelZh || '', labelEn: slide.labelEn || '', isActive: slide.isActive !== false
      }))
      renderHeroSlidesPanel()
      toast(owner.lang === 'zh' ? '轮播图已保存,顾客端刷新即可看到' : 'Carousel saved')
    } catch (error) {
      // 后端才是最终闸:它拒了就照它的话说,不在前端另编一套理由
      toast((error && error.message) || (owner.lang === 'zh' ? '保存失败' : 'Save failed'))
    }
  })
}
