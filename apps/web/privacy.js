/* Same policy asset as the mini-program. Public; no customer session required. */
(() => {
  const root = document.documentElement
  let mode = 'system'
  try { mode = localStorage.getItem('ll-admin-theme') || 'system' } catch {}
  const apply = () => { root.dataset.theme = mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode }
  apply()
  document.querySelector('#themeToggle').addEventListener('click', () => { mode = root.dataset.theme === 'dark' ? 'light' : 'dark'; apply() })
  const target = document.querySelector('#policy'), retry = document.querySelector('#retry')
  const text = (tag, value, cls) => { const el = document.createElement(tag); el.textContent = value; if (cls) el.className = cls; return el }
  async function load() {
    target.replaceChildren(text('div', '正在加载隐私政策…', 'card')); target.setAttribute('aria-busy', 'true'); retry.hidden = true
    try {
      const prefix = location.pathname.startsWith('/experience/') ? '/experience' : ''
      const response = await fetch(`${prefix}/assets/privacy-policy.json`, { cache: 'no-store' })
      if (!response.ok) throw new Error('policy unavailable')
      const policy = await response.json()
      if (!policy.operator || !policy.phone || !Array.isArray(policy.sections) || !policy.sections.length) throw new Error('policy incomplete')
      const summary = text('section', '', 'card')
      summary.append(text('h1', policy.title), text('p', policy.operator, 'meta'), text('p', `生效日期：${policy.effectiveDate}`, 'meta'))
      const contact = text('a', `隐私咨询 / 删除 / 撤回申请：${policy.phone}`, 'contact'); contact.href = `tel:${policy.phone.replace(/[^+\d]/g, '')}`; summary.append(contact)
      const sections = policy.sections.map(section => { const box = text('section', '', 'card'); box.append(text('h2', section.title), ...section.paragraphs.map(paragraph => text('p', paragraph))); return box })
      target.replaceChildren(summary, ...sections)
    } catch { target.replaceChildren(text('div', '隐私政策加载失败，请重试。隐私咨询电话：+86 18536823102', 'card')); retry.hidden = false }
    finally { target.setAttribute('aria-busy', 'false') }
  }
  retry.addEventListener('click', load); load()
})()
