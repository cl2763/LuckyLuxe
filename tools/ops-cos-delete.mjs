/* 删掉 COS 上的对象(目前用于清理误传的测试快照)。
   钥匙从 env 读,不落盘不打印;先列出要删的,--yes 才真删。

   用法:node tools/ops-cos-delete.mjs <objectKey> [...]        只列不删
        node tools/ops-cos-delete.mjs --yes <objectKey> [...]  真删 */
import { createHmac, createHash } from 'node:crypto'

const args = process.argv.slice(2)
const DO = args.includes('--yes')
const keys = args.filter((a) => a !== '--yes')
const COS = {
  secretId: process.env.COS_SECRET_ID,
  secretKey: process.env.COS_SECRET_KEY,
  region: process.env.COS_REGION,
  bucket: process.env.COS_BUCKET
}
if (!COS.secretId || !COS.secretKey || !COS.region || !COS.bucket) {
  console.error('COS 四个环境变量没配齐(COS_SECRET_ID/COS_SECRET_KEY/COS_REGION/COS_BUCKET)')
  process.exit(1)
}
if (!keys.length) { console.error('要删哪个对象?把 objectKey 传进来,如 settlements/xxx/YY.svg'); process.exit(1) }

function authorization({ method, key, headers }) {
  const now = Math.floor(Date.now() / 1000)
  const keyTime = `${now - 60};${now + 900}`
  const signKey = createHmac('sha1', COS.secretKey).update(keyTime).digest('hex')
  const headerKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort()
  const headerString = headerKeys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(headers[k]))}`).join('&')
  const httpString = `${method.toLowerCase()}\n${key}\n\n${headerString}\n`
  const stringToSign = `sha1\n${keyTime}\n${createHash('sha1').update(httpString).digest('hex')}\n`
  return [
    'q-sign-algorithm=sha1', `q-ak=${COS.secretId}`, `q-sign-time=${keyTime}`, `q-key-time=${keyTime}`,
    `q-header-list=${headerKeys.join(';')}`, 'q-url-param-list=',
    `q-signature=${createHmac('sha1', signKey).update(stringToSign).digest('hex')}`
  ].join('&')
}

const host = `${COS.bucket}.cos.${COS.region}.myqcloud.com`
async function head(key) {
  const headers = { host }
  const r = await fetch(`https://${host}${key}`, { method: 'HEAD', headers: { ...headers, authorization: authorization({ method: 'HEAD', key, headers }) } })
  return r.status
}
async function del(key) {
  const headers = { host }
  const r = await fetch(`https://${host}${key}`, { method: 'DELETE', headers: { ...headers, authorization: authorization({ method: 'DELETE', key, headers }) } })
  return r.status
}

for (const raw of keys) {
  const key = raw.startsWith('/') ? raw : `/${raw}`
  const before = await head(key)
  if (!DO) { console.log(`[预览] ${key} 当前 ${before === 200 ? '存在' : `HTTP ${before}`} —— 加 --yes 才真删`); continue }
  const status = await del(key)
  const after = await head(key)
  console.log(`${after === 404 ? '✓' : '✗'} ${key} 删除请求 ${status} · 复核 ${after === 404 ? '已不存在' : `HTTP ${after}`}`)
}
