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
  emptyNote: document.querySelector('#shareEmptyNote'),
  imageArea: document.querySelector('#shareImageArea'),
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

function shareVisibleImages() {
  if (state.booking?.galleryStatus !== 'approved') return []
  return Array.isArray(state.booking?.approvedWorkImages) ? state.booking.approvedWorkImages : []
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
  const approvedImages = shareVisibleImages()
  /* 裁定二(店主 02e 退回重修):我上一版注释写对了、下一行没照做 ——
     `service.imageUrl` 就是**服务目录上挂的示例图**,同样不是这一单顾客的作品,
     只是把"写死的一张平台图"换成"另一张平台图的变量写法",原地转了一圈。
     《作品上墙两道闸》口径是「没审核通过=没有」,不是「换一张顶上」→ **空就是空**,
     由调用方按三态第三态整块不出现。 */
  const images = approvedImages
  /* 三态第三态:没有审核通过的作品 → **整块不出现**(不是空图、不是拿别的图顶),
     并明说一句;分享/复制/下载按钮同步不出 —— 没东西可分享就别给按钮。 */
  if (!images.length) {
    /* 退回三(02f):**不整块重写 innerHTML** —— 那会抹掉同一 section 里的标题与平台选择器,
       并把 els.mainImage 的引用打空(中英切换再跑 renderImages 就落到已移除的节点上,
       与 01t 弹层 bookingId 被整对象重建冲掉是同一族)。
       改成:图区整块 hidden + 专用空态节点说话,DOM 结构不动、引用不失效。 */
    if (els.mainImage) els.mainImage.removeAttribute('src')
    if (els.imageArea) els.imageArea.classList.add('hidden')
    if (els.emptyNote) {
      els.emptyNote.textContent = state.lang === 'zh' ? '这一单还没有可分享的作品图。' : 'No approved work photo for this order yet.'
      els.emptyNote.classList.remove('hidden')
    }
    if (els.photoStrip) els.photoStrip.innerHTML = ''
    if (els.originalGrid) els.originalGrid.innerHTML = ''
    document.querySelectorAll('[data-share-copy],[data-share-download],[data-share-go]')
      .forEach((b) => { b.disabled = true; b.classList.add('hidden') })
    return
  }
  /* 有图:空态必须复位 —— 中英切换/换单重渲染时不能留着上一次的空态(同族回归) */
  if (els.imageArea) els.imageArea.classList.remove('hidden')
  if (els.emptyNote) els.emptyNote.classList.add('hidden')
  document.querySelectorAll('[data-share-copy],[data-share-download],[data-share-go]')
    .forEach((b) => { b.disabled = false; b.classList.remove('hidden') })
  const safeIndex = Math.min(Math.max(0, state.selectedImage), images.length - 1)
  state.selectedImage = safeIndex
  els.mainImage.src = images[safeIndex]
  els.mainImage.alt = state.booking?.service?.name || ''   /* 02v 拔回落:拿不到服务名就空 alt,不贴店名 */
  els.photoStrip.innerHTML = images.map((image, index) => `
    <button class="${index === safeIndex ? 'active' : ''}" data-share-image="${index}" type="button">
      ${image ? `<img src="${image}" alt="Work ${index + 1}">` : ''}
    </button>
  `).join('')
  els.originalGrid.innerHTML = images.map((image, index) => `
    <div class="gallery-image-pair">
      <figure>
        ${image ? `<img src="${image}" alt="${t('original')} ${index + 1}">` : ''}
        <figcaption>${t('original')} ${index + 1}</figcaption>
      </figure>
      <figure>
        ${image ? `<img class="edited-preview" src="${image}" alt="${t('edited')} ${index + 1}">` : ''}
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
  const images = shareVisibleImages()
  const image = images[state.selectedImage] || ''   // 裁定二②:同刀 —— 这里也不许拿服务示例图顶作品
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

/* 退回二(02f):缺订单信息 = 整页不渲染内容,只说一句真话。
   不给图、不给"已审核通过"、不给分享按钮 —— 没有订单就没有作品可分享。 */
function renderMissingBooking() {
  if (els.title) els.title.textContent = state.lang === 'zh' ? '这个链接缺少订单信息' : 'This link is missing order info'
  if (els.emptyNote) {
    els.emptyNote.textContent = state.lang === 'zh'
      ? '这个链接缺少订单信息,打不开作品。请从订单页重新分享。'
      : 'This link has no order info. Please re-share from the order page.'
    els.emptyNote.classList.remove('hidden')
  }
  if (els.imageArea) els.imageArea.classList.add('hidden')
  document.querySelectorAll('[data-share-copy],[data-share-download],[data-share-go]')
    .forEach((b) => { b.disabled = true; b.classList.add('hidden') })
}

async function loadShare() {
  applyLanguage()
  const bookingId = params.get('bookingId')
  if (bookingId) {
    const data = await request(`/bookings/${encodeURIComponent(bookingId)}?lang=${state.lang}`)
    state.booking = data.booking
  } else {
    /* 🔴 退回二(店主 02f):我上一版给它加了「明标」,把一处**真回落**从红改成了判据豁免项 ——
       判据认了,顾客照样被骗:任何人打开 share.html 不带参数,看到的就是平台示例图,
       而且挂着 galleryStatus:'approved'(以"已审核通过的作品"的名义)。
       **白名单是放行真正无害的东西,不是把红变绿的手段;明标是给判据看的,不是给顾客看的。**
       裁:demo 分支不许在真环境出现 —— 缺订单参数就整页说真话,不编内容。 */
    renderMissingBooking()
    return
  }
  els.title.textContent = state.booking.service?.name || (state.store?.storeName || '')   /* 02v:退到本店名,不写死 */
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
