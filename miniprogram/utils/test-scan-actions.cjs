const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const vm = require('node:vm')
const scanCode = require('./scan-code')

async function run(scanResult, hit) {
  const paths = [], lookups = [], modals = []
  let actions
  const wx = {
    scanCode({success}) { success(scanResult) },
    showModal(value) { modals.push(value) },
    showNavigationBarLoading() {}, hideNavigationBarLoading() {},
    showToast() {}
  }
  const api = {adminGet: async path => { lookups.push(path); return {hit} }}
  const nav = {to:path => paths.push(path)}
  const module = {exports:{}}
  vm.runInNewContext(readFileSync(require.resolve('./scan-actions'),'utf8'), {
    require:path => path === './scan-code' ? scanCode : path === './api' ? api : nav,
    module, wx
  })
  actions = module.exports
  actions.scanMerchantCode()
  await new Promise(resolve => setImmediate(resolve))
  return {actions,paths,lookups,modals}
}

(async () => {
  let t = await run({path:'pages/scan-entry/index?scene=mOAICUST7',result:''},{id:'demo-ai-cust-7'})
  assert.equal(t.lookups[0],'/admin/customers/lookup?memberCode=LL-OAICUST7')
  assert.equal(t.paths[0],'/pages/merchant/customer/index?id=demo-ai-cust-7')
  t = await run({result:'LL-AICUST14'},null)
  assert.equal(t.lookups[0],'/admin/customers/lookup?memberCode=LL-AICUST14')
  assert.equal(t.modals[0].title,'本店未找到档案')
  t = await run({result:'not-a-code'},null)
  assert.equal(t.lookups.length,0)
  assert.equal(t.modals[0].title,'未识别会员码')
  const customer = await run({result:'s0123456789abcdef01234567'},null)
  customer.actions.scanCustomerCode()
  assert.equal(customer.paths[0],'/pages/scan-entry/index?scene=s0123456789abcdef01234567')
  console.log('ok: merchant QR lookup, missing/invalid feedback, customer sign QR routing')
})().catch(error => { console.error(error); process.exitCode=1 })
