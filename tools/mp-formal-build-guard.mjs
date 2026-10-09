import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url)
const read=p=>readFileSync(new URL(p,root),'utf8')
const api=read('miniprogram/utils/api.js')
assert.match(api,/const USE_LOCAL_SANDBOX = false\b/)
assert.match(api,/const API_BASE = USE_LOCAL_SANDBOX \? LOCAL_API : 'https:\/\/api\.jingshengyouji\.com'/)
assert.doesNotMatch(read('miniprogram/utils/deploy.js'),/defaultTenantId:\s*['"][^'"]+/)
assert.doesNotMatch(read('miniprogram/pages/merchant/subscription/index.wxml'),/bindtap="(?:renew|aiSubscribe|reqChange|toggleAuto|aiTrial)"/)
assert.doesNotMatch(read('miniprogram/pages/merchant/subscription/index.js'),/api\.(?:adminPost|adminRequest)\(/)
console.log('Formal build: production API, no default tenant, software authorization is read-only.')
