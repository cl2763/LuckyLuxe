/* Approved 2026-09-26 share contract: real approved images, explicit empty/error states. */
const params = new URLSearchParams(location.search)
const read = (key, storage = localStorage) => { try { return JSON.parse(storage.getItem(key) || 'null') } catch { return null } }
const ownerAuth = read('lucky-owner-auth') || read('lucky-owner-auth', sessionStorage)
const tenantAuth = read('lucky-web-auth')
const audience = params.get('audience') === 'customer' ? 'customer' : params.get('audience') === 'staff' ? 'staff' : ownerAuth?.accessToken ? 'staff' : 'customer'
const tenant = params.get('store') || (audience === 'staff' ? ownerAuth?.admin?.tenantId : tenantAuth?.__tenant) || ''
const auth = audience === 'staff' ? ownerAuth : tenantAuth?.__tenant === tenant ? tenantAuth.__value : null
const state = { lang: localStorage.getItem('lucky-share-lang') || 'zh', booking: null, platform: params.get('platform') || 'xiaohongshu', image: Number(params.get('image') || 0), serial: 0, busy: false }
const platforms = { xiaohongshu: ['小红书', 'RED', 'https://www.xiaohongshu.com/'], douyin: ['抖音', 'Douyin', 'https://www.douyin.com/'], meituan: ['美团／大众点评', 'Meituan / Dianping', 'https://www.meituan.com/'], instagram: ['Instagram', 'Instagram', 'https://www.instagram.com/'] }
if (!platforms[state.platform]) state.platform = 'xiaohongshu'
const $ = id => document.getElementById(id)
const tr = (zh, en) => state.lang === 'en' ? en : zh
const back = audience === 'staff' ? '/admin' : '/?store=' + encodeURIComponent(tenant)
$('shareReturn').href = window.WebScope?.path(back) || back; $('shareLogin').href = window.WebScope?.path(back) || back
async function request(path, options = {}) {
  const response = await fetch(window.WebScope?.path(path) || path, { ...options, headers: { 'content-type': 'application/json', 'x-tenant-id': tenant, ...(auth?.accessToken ? { authorization: `Bearer ${auth.accessToken}` } : {}), ...options.headers } })
  const data = await response.json()
  if (!response.ok) { const error = new Error(data.error?.message || tr('请求失败，请重试', 'Request failed. Please retry.')); error.status = response.status; throw error }
  return data
}
function toast(message) { $('shareToast').textContent = message; $('shareToast').classList.add('show'); setTimeout(() => $('shareToast').classList.remove('show'), 2400) }
function notice(title, text = '', login = false) { $('shareContent').hidden = true; $('shareNotice').hidden = false; $('noticeTitle').textContent = title; $('noticeText').textContent = text; $('shareLogin').hidden = !login }
function applyLanguage() {
  document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-CN'
  $('shareZh').setAttribute('aria-pressed', String(state.lang === 'zh')); $('shareEn').setAttribute('aria-pressed', String(state.lang === 'en'))
  for (const [id, zh, en] of [['shareEyebrow','作品分享','Work share'],['shareReturn','返回订单','Back to orders'],['shareLogin','前往登录','Sign in'],['platformTitle','发布平台','Publishing platform'],['shareCopyLabel','分享文案 · 可修改','Caption · editable'],['copyShareCaption','复制文案','Copy caption'],['retryCopy','重新生成','Retry'],['sharePhotoNote','点击缩略图切换预览；保留图片原始比例。','Select a thumbnail to preview. Original proportions are preserved.'],['shareActionNote','复制后前往平台，选择作品图并发布。','Copy the caption, then add your images and publish on the platform.']]) $(id).textContent = tr(zh,en)
  document.querySelectorAll('[data-platform]').forEach(b => { b.textContent = platforms[b.dataset.platform][state.lang === 'en' ? 1 : 0]; b.setAttribute('aria-pressed', String(b.dataset.platform === state.platform)) })
}
function approvedImages() { return state.booking?.galleryStatus === 'approved' ? (state.booking.approvedWorkImages || []).filter(Boolean) : [] }
function render() {
  applyLanguage()
  const b = state.booking
  $('shareTitle').textContent = b?.service?.name || tr('作品分享','Work share')
  $('shareSubtitle').textContent = [b?.store?.name, b?.technician?.name].filter(Boolean).join(' · ')
  const images = approvedImages()
  if (!images.length) {
    const pending = b?.hasWorkImages && b?.galleryStatus !== 'approved'
    notice(pending ? tr('作品图正在等待审核','Work images are awaiting review') : tr('这一单还没有可分享的作品图','No shareable work images for this order'), pending ? tr('审核通过后，这里会显示作品预览和分享文案。','Approved images and captions will appear here after review.') : tr('先在订单中添加作品图，审核通过后再来分享。','Add work images to the order and return after approval.'))
    return false
  }
  $('shareNotice').hidden = true; $('shareContent').hidden = false
  state.image = Number.isInteger(state.image) && state.image >= 0 && state.image < images.length ? state.image : 0
  $('shareMainImage').src = images[state.image]
  $('sharePhotoStrip').replaceChildren(...images.map((src, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-label', tr('作品图 ','Work image ') + (index + 1)); button.setAttribute('aria-pressed', String(index === state.image))
    const image = document.createElement('img'); image.src = src; image.alt = ''; button.append(image)
    button.onclick = () => { if (state.image !== index) { state.image = index; render(); loadCopy() } }; return button
  }))
  return true
}
function syncCopyButton() { $('copyShareCaption').disabled = state.busy || !$('shareCopyBox').value.trim() }
async function loadCopy() {
  if (!approvedImages().length) return
  const serial = ++state.serial
  state.busy = true; $('shareCopyBox').value = ''; $('shareCopyBox').disabled = true; $('retryCopy').hidden = true; syncCopyButton()
  $('shareCopyStatus').textContent = tr('正在生成文案…','Generating caption…')
  const p = platforms[state.platform]
  $('openPlatform').href = p[2]; $('openPlatform').textContent = tr('打开','Open ') + (state.platform === 'meituan' ? tr('美团','Meituan') : p[state.lang === 'en' ? 1 : 0]); $('openDianping').hidden = state.platform !== 'meituan'; $('openDianping').textContent = tr('打开大众点评','Open Dianping')
  try {
    const data = await request('/share/social-copy', { method: 'POST', body: JSON.stringify({ bookingId: state.booking.id, platform: state.platform, imageIndex: state.image, lang: state.lang }) })
    if (serial !== state.serial) return
    const copy = data.copy?.data || data.copy || {}
    $('shareCopyBox').value = [state.lang === 'en' ? copy.titleEn : copy.titleZh, state.lang === 'en' ? copy.captionEn : copy.captionZh, (copy.hashtags || []).join(' ')].filter(Boolean).join('\n\n')
    $('shareCopyStatus').textContent = $('shareCopyBox').value.trim() ? tr('文案已生成，可修改后复制。','Caption ready. Edit before copying.') : tr('没有生成文案，请重试。','No caption returned. Please retry.')
    $('retryCopy').hidden = !!$('shareCopyBox').value.trim()
  } catch (error) { if (serial === state.serial) { $('shareCopyStatus').textContent = error.status === 401 ? tr('登录已失效，请返回订单重新登录。','Session expired. Return to orders and sign in.') : error.message; $('retryCopy').hidden = false } }
  finally { if (serial === state.serial) { state.busy = false; $('shareCopyBox').disabled = false; syncCopyButton() } }
}
async function load() {
  const serial = ++state.serial
  applyLanguage()
  if (!params.get('bookingId')) { notice(tr('这个链接缺少订单信息','This link is missing order information'), tr('请从订单页重新进入作品分享。','Open work share from the order page.')); return }
  if (!tenant || !auth?.accessToken) { notice(tr('请先登录本店账户','Please sign in to this store'), tr('作品分享需要核对订单与门店，请返回订单登录后重新打开。','Return to your orders and reopen this page after signing in.'), true); return }
  try { const data = await request('/share/bookings/' + encodeURIComponent(params.get('bookingId')) + '?lang=' + state.lang); if (serial !== state.serial) return; state.booking = data.booking; if (render()) await loadCopy() }
  catch (error) { if (serial === state.serial) notice(tr('暂时无法打开作品','Unable to open this work'), error.message, error.status === 401) }
}
for (const lang of ['zh','en']) $('share' + (lang === 'zh' ? 'Zh' : 'En')).onclick = () => { state.lang = lang; localStorage.setItem('lucky-share-lang', lang); load() }
document.querySelectorAll('[data-platform]').forEach(button => button.onclick = () => { if (state.platform === button.dataset.platform) return; state.platform = button.dataset.platform; applyLanguage(); loadCopy() })
$('shareCopyBox').oninput = syncCopyButton
$('retryCopy').onclick = loadCopy
$('copyShareCaption').onclick = async () => { if ($('copyShareCaption').disabled) return; try { await navigator.clipboard.writeText($('shareCopyBox').value.trim()); toast(tr('文案已复制','Caption copied')) } catch { $('shareCopyBox').focus(); $('shareCopyBox').select(); toast(tr('复制未成功，请长按或使用复制快捷键。','Copy failed. Select the text and copy it manually.')) } }
load()
