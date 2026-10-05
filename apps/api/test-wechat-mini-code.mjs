import assert from 'node:assert/strict'
import { sceneForToken, getMiniCode } from './wechat-mini-code.mjs'

let checks = 0
const ok = (name) => console.log(`ok ${++checks} - ${name}`)

const scene = sceneForToken(`sg_${'a'.repeat(64)}`)
assert.equal(scene, `s${'a'.repeat(24)}`); ok('签署场景不暴露原令牌')
assert.equal(sceneForToken(`bind_${'b'.repeat(64)}`), `b${'b'.repeat(24)}`); ok('绑定场景不暴露原令牌')
assert.throws(() => sceneForToken('sg_invalid')); ok('非法令牌被拒')

const calls = []
const fakeSecret = 'test-secret'
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(120)])
const fetcher = async (url, options) => {
  calls.push({ url, options })
  if (url.includes('/cgi-bin/token')) return { ok: true, json: async () => ({ access_token: 'test-token', expires_in: 7200 }) }
  return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png }
}
const out = await getMiniCode({ appid: 'test-app', secret: fakeSecret, scene, fetcher })
assert.deepEqual(out, {bytes:png,mimeType:'image/png'}); ok('PNG 小程序码返回')
assert.equal(calls.length, 2); ok('先取 access token 再生成码')
assert.equal(JSON.parse(calls[1].options.body).env_version, 'trial'); ok('指定体验版环境')
assert.equal(JSON.parse(calls[1].options.body).check_path, false); ok('未发布路径可生成体验码')
assert.equal(JSON.parse(calls[1].options.body).page, 'pages/scan-entry/index'); ok('扫码入口正确')
assert.equal(JSON.parse(calls[1].options.body).scene, scene); ok('场景参数正确')
await assert.rejects(getMiniCode({ appid: 'test-app', secret: fakeSecret, scene: 'bad', fetcher })); ok('非法场景被拒')
const jpg=Buffer.concat([Buffer.from('ffd8ffe000104a46','hex'),Buffer.alloc(120),Buffer.from('ffd9','hex')])
const jpeg=await getMiniCode({appid:'test-app',secret:fakeSecret,scene,fetcher:async(url,options)=>url.includes('cgi-bin/token')?fetcher(url,options):{ok:true,headers:{get:()=> 'image/jpeg'},arrayBuffer:async()=>jpg}})
assert.deepEqual(jpeg,{bytes:jpg,mimeType:'image/jpeg'}); ok('JPEG 小程序码返回')
console.log('小程序码生成：11 项检查通过')
