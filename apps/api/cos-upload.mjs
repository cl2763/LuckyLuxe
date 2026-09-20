/* 对象存储(腾讯云 COS)最小上传封装 —— 从 `local-server.mjs` **原样搬出**(10b,公约②「边改边拆」)
 *
 * 为什么是这一族:10b §二 裁了「后端新增的分发行走 (甲) 抽取抵掉,不批 (乙) 额度」,
 * 而 `fetchSnapshotSvg` / `cosPutObject` 这一族本来就是我自己点名的搬迁目标。
 * 签署文件留档要用 `cosPutObject`,新模块去 import 一个巨型文件里的私有函数是不可能的 ——
 * **正好是该搬的时候搬**。
 *
 * 🔴 **一个字都没改**,只把两处外部依赖改成注入:
 *   · `createHmac` → 本模块自己 import
 *   · `IS_PRODUCTION` → 由 `createCos({ isProduction })` 传进来(判「是不是真环境」全仓只此一个出口:`data-scope.mjs`)
 *
 * ⚠️ 顺带如实登记(**没动它**):`cosDeleteObject` 全仓**零调用方**(现扫 apps/ tools/ miniprogram/ 只有它自己的定义)。
 * 搬过来照样导出,是为了「原样搬出」;要不要删是店主的裁决,不是我顺手做的事。
 */
import { createHmac } from 'node:crypto'

export function createCos({ isProduction }) {
  const COS = {
    secretId: process.env.COS_SECRET_ID || '',
    secretKey: process.env.COS_SECRET_KEY || '',
    region: process.env.COS_REGION || '',
    bucket: process.env.COS_BUCKET || ''
  }
  function cosConfigured() {
    return Boolean(COS.secretId && COS.secretKey && COS.region && COS.bucket)
  }

  function cosAuthorization({ method, key, headers, now = Math.floor(Date.now() / 1000) }) {
    const keyTime = `${now - 60};${now + 900}`
    const signKey = createHmac('sha1', COS.secretKey).update(keyTime).digest('hex')
    const headerKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort()
    const headerString = headerKeys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(headers[Object.keys(headers).find((x) => x.toLowerCase() === k)]))}`).join('&')
    const httpString = `${method.toLowerCase()}\n${key}\n\n${headerString}\n`
    const stringToSign = `sha1\n${keyTime}\n${createHash('sha1').update(httpString).digest('hex')}\n`
    const signature = createHmac('sha1', signKey).update(stringToSign).digest('hex')
    return [
      'q-sign-algorithm=sha1',
      `q-ak=${COS.secretId}`,
      `q-sign-time=${keyTime}`,
      `q-key-time=${keyTime}`,
      `q-header-list=${headerKeys.join(';')}`,
      'q-url-param-list=',
      `q-signature=${signature}`
    ].join('&')
  }

  /* 沙盒隔离(店主 2026-08-08 裁决,根因固化不靠自觉):
     非生产环境**一律不往真实 COS 传**,即使 env 里配了钥匙 —— 快照直接走 inline。
     本地铺演示数据那次,快照真的传进了生产桶;靠「记得摘环境变量」是防不住的,
     所以判断放在代码里。只有显式 COS_SMOKE=1 才放行,专供冒烟脚本用。 */
  function cosUploadAllowed() {
    if (!cosConfigured()) return false
    if (process.env.COS_SMOKE === '1') return true
    return isProduction
  }

  async function cosDeleteObject(objectKey) {
    if (!cosConfigured()) return { ok: false, reason: 'COS 未配置' }
    const key = objectKey.startsWith('/') ? objectKey : `/${objectKey}`
    const host = `${COS.bucket}.cos.${COS.region}.myqcloud.com`
    const headers = { host }
    try {
      const response = await fetch(`https://${host}${key}`, {
        method: 'DELETE',
        headers: { ...headers, authorization: cosAuthorization({ method: 'DELETE', key, headers }) },
        signal: AbortSignal.timeout(15000)
      })
      // COS 删不存在的对象也回 204,幂等
      return { ok: response.status === 204 || response.ok, status: response.status, url: `https://${host}${key}` }
    } catch (error) {
      return { ok: false, reason: error.message }
    }
  }

  async function cosPutObject(objectKey, body, contentType = 'application/octet-stream') {
    if (!cosUploadAllowed()) return null
    const key = objectKey.startsWith('/') ? objectKey : `/${objectKey}`
    const host = `${COS.bucket}.cos.${COS.region}.myqcloud.com`
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')
    const headers = { host, 'content-type': contentType, 'content-length': String(payload.length) }
    try {
      const response = await fetch(`https://${host}${key}`, {
        method: 'PUT',
        headers: { ...headers, authorization: cosAuthorization({ method: 'PUT', key, headers }) },
        body: payload,
        signal: AbortSignal.timeout(15000)
      })
      if (!response.ok) {
        console.error(`[cos] 上传失败 ${response.status}(已降级,不影响业务)`)
        return null
      }
      return `https://${host}${key}`
    } catch (error) {
      console.error(`[cos] 上传异常: ${error.message}(已降级,不影响业务)`)
      return null
    }
  }
  return { COS, cosConfigured, cosAuthorization, cosUploadAllowed, cosDeleteObject, cosPutObject }
}
