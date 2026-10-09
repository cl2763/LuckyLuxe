// 入口护栏：占位未接线、失败卡在读取中、旧响应覆盖新门店。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const read = path => readFileSync(fileURLToPath(new URL('../../' + path, import.meta.url)), 'utf8')
let checks = 0
function check(name, test) { assert.ok(test, name); console.log(`ok ${++checks} - ${name}`) }
const web = { window: {} }
vm.runInNewContext(read('apps/web/membership-summary.js'), web)
const host = { innerHTML: '', querySelector() { return { addEventListener: (_, fn) => { host.retry = fn } } } }
const escapeHtml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const show = web.window.LLMembershipSummary.show
const rows = { summaryRows: [{ label: '会员资格', value: '<本店规则>' }], editHint: '由平台配置' }
let resolveOld
const old = show({ host, escapeHtml, visible: true, request: () => new Promise(resolve => { resolveOld = resolve }) })
check('网页未取到响应时明确加载中', host.innerHTML.includes('role="status"'))
await show({ host, escapeHtml, visible: true, request: async path => { assert.equal(path, '/admin/membership/config'); return rows } })
check('网页显示后端规则并转义内容', host.innerHTML.includes('&lt;本店规则&gt;') && host.innerHTML.includes('由平台配置'))
resolveOld({ summaryRows: [{ label: '旧店', value: '过期响应' }] }); await old
check('迟到的旧门店响应不覆盖当前规则', !host.innerHTML.includes('过期响应'))
let failed = true
await show({ host, escapeHtml, visible: true, request: async () => { if (failed) throw Error('offline'); return rows } })
check('网络失败显示失败和重试', host.innerHTML.includes('role="alert"') && typeof host.retry === 'function')
failed = false; await host.retry()
check('重试恢复本店规则', host.innerHTML.includes('&lt;本店规则&gt;') && !host.innerHTML.includes('role="alert"'))
await show({ host, escapeHtml, visible: true, request: async () => ({ summaryRows: [] }) })
check('空响应不能无限读取或伪造会员规则', host.innerHTML.includes('role="alert"'))
let calls = 0
show({ host, escapeHtml, visible: false, request: async () => { calls++ } })
check('其他标签不请求会员规则', calls === 0)
const html = read('apps/web/admin.html'), admin = read('apps/web/admin.js')
check('真实会员入口挂载模块且不再显示占位', html.includes('/web/membership-summary.js') && admin.includes('window.LLMembershipSummary.show') && !html.includes('配置界面归 S9 波次'))
let page
let api = { adminGet: async () => { throw Error('offline') } }
vm.runInNewContext(read('miniprogram/pages/merchant/member/index.js'), { require: path => path.endsWith('/api') ? api : {}, Page: p => { page = p } })
page.setData = data => Object.assign(page.data, data)
await page.loadMembershipView()
check('小程序网络失败停止加载并允许重试', page.data.msLoading === false && !!page.data.msError && !page._msPending)
api.adminGet = async () => rows
await page.loadMembershipView()
check('小程序重试后恢复同源规则', !page.data.msError && page.data.msRows[0].value === '<本店规则>')
api.adminGet = async () => ({ summaryRows: [] })
await page.loadMembershipView()
check('小程序空响应同样显示错误', !!page.data.msError && !page.data.msLoading)
const wxml = read('miniprogram/pages/merchant/member/index.wxml')
check('小程序错误重试入口接入真实加载方法', wxml.includes('wx:elif="{{msError}}"') && wxml.includes('bindtap="loadMembershipView"'))
console.log(`\n${checks} checks passed`)
