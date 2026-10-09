(() => {
  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
  function render({root, portfolios, selectedPortfolioTechId, lang, t, brandName}) {
    const selected = portfolios.find(item => item.technician?.id === selectedPortfolioTechId)
    const sources = selected ? [selected] : portfolios
    const albums = sources.flatMap(portfolio => (portfolio.albums || (portfolio.images || []).map((image, i) => ({id: String(i), images:[image]}))).map(album => ({...album, technician:portfolio.technician, index:0}))).filter(album => album.images?.length)
    root.innerHTML = `<section class="portfolio-page-web">
      <button class="ghost back-btn" ${selected ? 'data-portfolio-back' : 'data-view-target="home"'} type="button">← ${esc(selected ? t('technicianPortfolio') : t('home'))}</button>
      <div class="section-row"><div><p class="eyebrow">${esc(brandName())}</p><h1>${esc(selected ? selected.technician?.name : t('technicianPortfolio'))}</h1><span class="subtle">${esc(t('portfolioIntro'))}</span></div></div>
      <div class="portfolio-tech-filter"><button class="ghost slim" type="button" data-portfolio-back>${lang === 'zh' ? '全部技师' : 'All technicians'}</button>${portfolios.map(item => `<button class="ghost slim" type="button" data-portfolio-tech="${esc(item.technician?.id)}">${esc(item.technician?.name)}</button>`).join('')}</div>
      ${!albums.length ? `<div class="empty-state">${lang === 'zh' ? '还没有作品' : 'No work yet'}</div>` : ''}
      <div class="service-album-grid">${albums.map((album, i) => `<article class="service-album-card" data-album="${i}">
        <div class="service-album-visual">
          <button type="button" class="service-album-open" aria-label="${lang === 'zh' ? '查看大图' : 'View photo'}"><img src="${esc(album.images[0])}" alt="${esc(album.serviceName || album.technician?.name)}"></button>
          ${album.images.length > 1 ? `<button type="button" class="portfolio-nav prev" data-album-step="-1" aria-label="${lang === 'zh' ? '上一张' : 'Previous photo'}">‹</button><button type="button" class="portfolio-nav next" data-album-step="1" aria-label="${lang === 'zh' ? '下一张' : 'Next photo'}">›</button><span class="album-photo-count"></span>` : ''}
        </div><div class="service-album-meta"><span>${esc(album.technician?.name || brandName())}</span><span>${esc(album.serviceName)}</span></div>
      </article>`).join('')}</div></section>`
    root.querySelectorAll('[data-album]').forEach(card => {
      const album = albums[Number(card.dataset.album)]
      const update = () => {
        card.querySelector('img').src = album.images[album.index]
        const count = card.querySelector('.album-photo-count')
        if (count) { count.textContent = `${album.index + 1} / ${album.images.length}`; card.querySelector('.prev').disabled = album.index === 0; card.querySelector('.next').disabled = album.index === album.images.length - 1 }
      }
      card.querySelectorAll('[data-album-step]').forEach(button => button.addEventListener('click', () => { album.index = Math.max(0, Math.min(album.images.length - 1, album.index + Number(button.dataset.albumStep))); update() }))
      card.querySelector('.service-album-open').addEventListener('click', () => window.openSnapViewer(album.images.map((url, i) => ({url, label:`${album.technician?.name || brandName()} · ${i + 1} / ${album.images.length}`})), album.index))
      update()
    })
  }
  window.PortfolioNavigation = {render}
})()
