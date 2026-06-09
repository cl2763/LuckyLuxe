const params = new URLSearchParams(window.location.search)
const state = {
  lang: localStorage.getItem('lucky-share-lang') || 'zh',
  booking: null,
  selectedImage: Number(params.get('image') || 0),
  platform: params.get('platform') || 'xiaohongshu',
  copy: null
}

const els = {
  zh: document.querySelector('#shareZh'),
  en: document.querySelector('#shareEn'),
  eyebrow: document.querySelector('#shareEyebrow'),
  title: document.querySelector('#shareTitle'),
  subtitle: document.querySelector('#shareSubtitle'),
  mainImage: document.querySelector('#shareMainImage'),
  photoStrip: document.querySelector('#sharePhotoStrip'),
  originalGrid: document.querySelector('#shareOriginalGrid'),
  platformEyebrow: document.querySelector('#platformEyebrow'),
  platformTitle: document.querySelector('#platformTitle'),
  platformSelect: document.querySelector('#platformSelect'),
  copyBox: document.querySelector('#shareCopyBox'),
  copyButton: document.querySelector('#copyShareCaption'),
  openPlatform: document.querySelector('#openPlatform'),
  toast: document.querySelector('#shareToast')
}

const text = {
  zh: {
    eyebrow: '作品分享',
    subtitle: '选择平台，复制文案后即可发布。',
    platformEyebrow: '发布平台',
    platformTitle: '平台文案',
    copy: '复制文案',
    copied: '文案已复制。',
    open: '打开平台',
    original: '原图',
    edited: 'AI 修图版'
  },
  en: {
    eyebrow: 'Work Share',
    subtitle: 'Choose a platform, copy the caption, then publish.',
    platformEyebrow: 'Publish Platform',
    platformTitle: 'Platform Copy',
    copy: 'Copy Caption',
    copied: 'Caption copied.',
    open: 'Open Platform',
    original: 'Original',
    edited: 'AI Edited'
  }
}

function t(key) {
  return text[state.lang][key] || key
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function platformUrl(platform) {
  return {
    xiaohongshu: 'https://www.xiaohongshu.com/',
    douyin: 'https://www.douyin.com/',
    instagram: 'https://www.instagram.com/'
  }[platform] || 'https://www.xiaohongshu.com/'
}

function toast(message) {
  els.toast.textContent = message
  els.toast.classList.add('show')
  setTimeout(() => els.toast.classList.remove('show'), 2200)
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Request failed')
  return data
}

function applyLanguage() {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en'
  els.zh.classList.toggle('active', state.lang === 'zh')
  els.en.classList.toggle('active', state.lang === 'en')
  els.eyebrow.textContent = t('eyebrow')
  els.subtitle.textContent = t('subtitle')
  els.platformEyebrow.textContent = t('platformEyebrow')
  els.platformTitle.textContent = t('platformTitle')
  els.copyButton.textContent = t('copy')
  els.openPlatform.textContent = t('open')
}

function renderImages() {
  const images = state.booking?.workImages?.length ? state.booking.workImages : [state.booking?.service?.imageUrl || '/assets/images/nail-french.png']
  const safeIndex = Math.min(Math.max(0, state.selectedImage), images.length - 1)
  state.selectedImage = safeIndex
  els.mainImage.src = images[safeIndex]
  els.mainImage.alt = state.booking?.service?.name || 'Lucky Luxe work'
  els.photoStrip.innerHTML = images.map((image, index) => `
    <button class="${index === safeIndex ? 'active' : ''}" data-share-image="${index}" type="button">
      <img src="${image}" alt="Work ${index + 1}">
    </button>
  `).join('')
  els.originalGrid.innerHTML = images.map((image, index) => `
    <div class="gallery-image-pair">
      <figure>
        <img src="${image}" alt="${t('original')} ${index + 1}">
        <figcaption>${t('original')} ${index + 1}</figcaption>
      </figure>
      <figure>
        <img class="edited-preview" src="${image}" alt="${t('edited')} ${index + 1}">
        <figcaption>${t('edited')} ${index + 1}</figcaption>
      </figure>
    </div>
  `).join('')
}

function renderCopy() {
  const copy = state.copy || {}
  const title = state.lang === 'en' ? copy.titleEn : copy.titleZh
  const caption = state.lang === 'en' ? copy.captionEn : copy.captionZh
  els.copyBox.innerHTML = `
    <strong>${escapeHtml(title || '')}</strong>
    <p>${escapeHtml(caption || '')}</p>
    <small>${(copy.hashtags || []).map(escapeHtml).join(' ')}</small>
  `
  els.openPlatform.href = platformUrl(state.platform)
}

async function loadCopy() {
  const images = state.booking?.workImages || []
  const image = images[state.selectedImage] || state.booking?.service?.imageUrl || ''
  const data = await request('/ai/social-copy', {
    method: 'POST',
    body: JSON.stringify({
      lang: state.lang,
      bookingId: state.booking?.id,
      image,
      platform: state.platform
    })
  })
  state.copy = data.copy?.data || data.copy
  renderCopy()
}

async function loadShare() {
  applyLanguage()
  const bookingId = params.get('bookingId')
  if (bookingId) {
    const data = await request(`/bookings/${encodeURIComponent(bookingId)}?lang=${state.lang}`)
    state.booking = data.booking
  } else {
    state.booking = {
      id: 'demo',
      service: { name: 'Lucky Luxe Archive', imageUrl: '/assets/images/nail-french.png' },
      workImages: ['/assets/images/nail-french.png', '/assets/images/nail-luxe.png']
    }
  }
  els.title.textContent = state.booking.service?.name || 'Lucky Luxe'
  els.platformSelect.value = state.platform
  renderImages()
  await loadCopy()
}

els.zh.addEventListener('click', () => {
  state.lang = 'zh'
  localStorage.setItem('lucky-share-lang', state.lang)
  loadShare().catch((error) => toast(error.message))
})

els.en.addEventListener('click', () => {
  state.lang = 'en'
  localStorage.setItem('lucky-share-lang', state.lang)
  loadShare().catch((error) => toast(error.message))
})

els.platformSelect.addEventListener('change', () => {
  state.platform = els.platformSelect.value
  loadCopy().catch((error) => toast(error.message))
})

els.photoStrip.addEventListener('click', (event) => {
  const button = event.target.closest('[data-share-image]')
  if (!button) return
  state.selectedImage = Number(button.dataset.shareImage)
  renderImages()
  loadCopy().catch((error) => toast(error.message))
})

els.copyButton.addEventListener('click', async () => {
  const copy = state.copy || {}
  const title = state.lang === 'en' ? copy.titleEn : copy.titleZh
  const caption = state.lang === 'en' ? copy.captionEn : copy.captionZh
  await navigator.clipboard.writeText([title, caption, (copy.hashtags || []).join(' ')].filter(Boolean).join('\n\n'))
  toast(t('copied'))
})

loadShare().catch((error) => toast(error.message))
