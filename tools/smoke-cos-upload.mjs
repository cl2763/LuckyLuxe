#!/usr/bin/env node
// COS 真实上传冒烟(密钥配好后跑一次即可)
//   node tools/smoke-cos-upload.mjs        # 读本机 apps/api/.env
// 密钥只从 env 读,不打印;只回报「成功/失败 + 对象 URL」。
import { readFileSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'

for (const line of readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { COS_SECRET_ID: id, COS_SECRET_KEY: key, COS_REGION: region, COS_BUCKET: bucket } = process.env
const missing = ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_REGION', 'COS_BUCKET'].filter((k) => !process.env[k])
if (missing.length) { console.error('缺少环境变量:', missing.join(', ')); process.exit(1) }
console.log(`桶 ${bucket} · 地域 ${region} · SecretId 长度 ${id.length}(值不显示)`)

const objectKey = `/settlements/_smoke/${Date.now()}.svg`
const host = `${bucket}.cos.${region}.myqcloud.com`
const payload = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"><text x="4" y="20">smoke</text></svg>', 'utf8')
const headers = { host, 'content-type': 'image/svg+xml', 'content-length': String(payload.length) }
const now = Math.floor(Date.now() / 1000)
const keyTime = `${now - 60};${now + 900}`
const signKey = createHmac('sha1', key).update(keyTime).digest('hex')
const hk = Object.keys(headers).map((k) => k.toLowerCase()).sort()
const headerString = hk.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(headers[k])}`).join('&')
const httpString = `put\n${objectKey}\n\n${headerString}\n`
const stringToSign = `sha1\n${keyTime}\n${createHash('sha1').update(httpString).digest('hex')}\n`
const signature = createHmac('sha1', signKey).update(stringToSign).digest('hex')
const auth = `q-sign-algorithm=sha1&q-ak=${id}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${hk.join(';')}&q-url-param-list=&q-signature=${signature}`

const res = await fetch(`https://${host}${objectKey}`, { method: 'PUT', headers: { ...headers, authorization: auth }, body: payload })
if (!res.ok) { console.error('✗ 上传失败', res.status, (await res.text()).slice(0, 300)); process.exit(1) }
console.log(`✅ 上传成功 https://${host}${objectKey}`)
const back = await fetch(`https://${host}${objectKey}`)
console.log(back.ok ? '✅ 可公开取回' : `⚠ 取回 ${back.status}(桶可能是私有读,签名 URL 另说)`)
