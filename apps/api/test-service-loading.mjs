import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let n = 0
const failures = []
function check(name, ok) {
  console.log(`${ok ? 'ok' : 'not ok'} ${++n} - ${name}`)
  if (!ok) failures.push(name)
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup(route, api, lang = 'zh') {
  let page
  const navigations = [], carts = [], toasts = []
  const i18n = { getLang: () => lang, pageCopy: () => ({}), applyTabBar() {}, setTitle() {}, localizeService: v => ({ ...v }), localizeServices: v => v }
  vm.runInNewContext(readFileSync(new URL(`../../miniprogram/pages/${route}/index.js`, import.meta.url), 'utf8'), {
    Page: p => { page = p },
    require: p => p.endsWith('/api') ? api : p.endsWith('/i18n') ? i18n : p.endsWith('/storecurrency') ? { curOf: () => ({ p: '', s: '¥' }), ensureCurrencyCached() {} } : p.endsWith('/tabbar') ? { update() {} } : { addCartItem: v => carts.push(v) },
    wx: { getStorageSync: () => '', removeStorageSync() {}, setNavigationBarTitle() {}, navigateTo: v => navigations.push(v), switchTab: v => navigations.push(v), showToast: v => toasts.push(v) }
  })
  page.data = { ...page.data }
  page.setData = patch => Object.assign(page.data, patch)
  return { page, navigations, carts, toasts }
}
const service = { _id: 'fixture-service', name: '隔离测试服务', type: 'nail', price: 288, sort: 1 }
let slow = deferred(), calls = 0
let t = setup('service-detail', { getService: () => { calls++; return slow.promise } })
t.page.onLoad({ id: service._id })
check('详情 onLoad 不重复拉取接口', calls === 0)
t.page.onShow()
const pending = t.page.refresh()
check('慢请求期间呈现加载态，连续显示只请求一次', t.page.data.loading && !t.page.data.missing && !t.page.data.loadFailed && calls === 1)
t.page.goBooking(); t.page.addDraftToCart()
check('未加载详情不会产生空预约或空购物车项目', !t.navigations.length && !t.carts.length)
slow.resolve(service); await pending
check('详情成功后结束加载并显示实际接口服务', !t.page.data.loading && t.page.data.service._id === service._id)
check('已完成请求释放锁，下次重新进入可刷新', t.page._loading === null)
slow = deferred(); calls = 0
t = setup('service-detail', { getService: () => { calls++; return calls === 1 ? slow.promise : Promise.resolve(service) } }, 'en')
t.page.onLoad({ id: service._id }); const failed = t.page.refresh(); slow.reject(Error('offline')); await failed
check('详情失败显示失败态及当前语言，未伪造不存在或服务数据', !t.page.data.loading && t.page.data.loadFailed && !t.page.data.missing && t.page.data.service === null && t.page.data.lang === 'en')
await t.page.refresh()
check('详情失败后重试可以恢复正常内容', calls === 2 && !t.page.data.loadFailed && t.page.data.service._id === service._id)
calls = 0; t = setup('service-detail', { getService: async () => { calls++; return null } })
t.page.onLoad({}); await t.page.refresh()
check('缺少项目编号不请求接口，呈现可返回的缺失态', calls === 0 && !t.page.data.loading && t.page.data.missing)
t.page.toServices()
check('缺失项目可回服务列表，返回失败有明确反馈', t.navigations[0]?.url === '/pages/services/index' && typeof t.navigations[0]?.fail === 'function')
t.navigations[0].fail(); check('返回失败给出 toast', t.toasts[0]?.icon === 'none')
t.page.onLoad({ id: 'removed' }); await t.page.refresh()
check('接口返回已下架项目，留在可返回缺失态', calls === 1 && t.page.data.missing && !t.page.data.loadFailed)
slow = deferred(); calls = 0
t = setup('services', { getServiceCatalog: () => { calls++; return slow.promise } })
const listing = t.page.refresh(); t.page.onShow()
check('目录慢请求不显示空目录结论，onShow 不叠加请求', calls === 1 && t.page.data.loading && !t.page.data.loadFailed)
slow.resolve({ services: [service], platformCategories: [{ key: 'nail', nameZh: '美甲', nameEn: 'Nails' }] }); await listing
check('目录到达后选默认有效分类并显示项目', !t.page.data.loading && t.page.data.activeCat === 'all' && t.page.data.serviceList[0]?._id === service._id)
t.page.switchCat({ currentTarget: { dataset: { cat: 'nail' } } })
check('本地切分类不额外请求网络', calls === 1)
slow = deferred(); calls = 0
t = setup('services', { getServiceCatalog: () => { calls++; return calls === 1 ? slow.promise : Promise.resolve({ services: [], platformCategories: [] }) } })
const listingFailed = t.page.refresh(); slow.reject(Error('offline')); await listingFailed
check('目录失败如实反馈并释放请求锁', t.page.data.loadFailed && !t.page.data.loading && !t.page._loading)
await t.page.refresh()
check('目录重试后真正的空列表才显示空态', !t.page.data.loadFailed && !t.page.data.loading && t.page.data.serviceList.length === 0 && calls === 2)
// 网页详情取已加载目录，不再请求网络；首次加载同样要区分等待/失败/完成。
const web = readFileSync(new URL('../../apps/web/customer.js', import.meta.url), 'utf8')
const boot = web.slice(web.indexOf('async function bootstrap()'), web.indexOf('/* D190:`/auth/session`'))
function webSetup(load, lang = 'zh') {
  let retry, reloads = 0
  const screen = { innerHTML: '', attributes: {}, setAttribute(k, v) { this.attributes[k] = v }, querySelector(sel) { return sel === '[data-bootstrap-retry]' && this.innerHTML.includes('data-bootstrap-retry') ? { addEventListener: (_, fn) => { retry = fn } } : null } }
  const context = { state: { lang, user: null }, TENANT_ID: 'isolated-web-test', els: { screen, authView: { classList: { add() {} } }, appView: { classList: { remove() {} } } }, bindGlobalEvents() {}, loadServices: load, loadStores: async () => {}, loadAddOns: async () => {}, loadPortfolio: async () => {}, handleStripeReturn: async () => {}, handleBookingDraftParam: async () => {}, showApp: async () => { screen.innerHTML = 'actual-loaded-store' }, toast() {}, location: { reload: () => { reloads++ } } }
  vm.createContext(context); vm.runInContext(boot, context)
  return { context, screen, retry: () => retry?.(), reloads: () => reloads }
}
slow = deferred(); let w = webSetup(() => slow.promise)
let opening = w.context.bootstrap()
check('网页首次进店等待目录期间显示加载提示和 busy 状态', w.screen.innerHTML.includes('正在加载门店') && w.screen.attributes['aria-busy'] === 'true')
slow.resolve(); await opening
check('网页加载完成移除过场并解除 busy 状态', w.screen.innerHTML === 'actual-loaded-store' && w.screen.attributes['aria-busy'] === 'false')
slow = deferred(); w = webSetup(() => slow.promise, 'en'); opening = w.context.bootstrap(); slow.reject(Error('offline')); await opening
check('网页加载失败保持当前语言和重试入口，不呈现空列表', w.screen.innerHTML.includes('Could not load store') && w.screen.innerHTML.includes('data-bootstrap-retry') && w.screen.attributes['aria-busy'] === 'false')
w.retry(); check('网页失败状态的重试按钮实际触发重载', w.reloads() === 1)
console.log(`${n} checks; ${failures.length} failures`)
process.exitCode = failures.length ? 1 : 0
