/* 微信手机号:**按真算法加解密**(店主 夜11 段 B1,2026-09-14)
 *
 * ══ 为什么这一段非要真算法不可 ══
 * 手机号解密要 `session_key`,而 `session_key` 正是 `jscode2session` 给的 —— **替身给的是假的**。
 * 如果就这么放着,「解密」这一步在回归里**根本没被测到**:又是一个「站在门后面的绿」。
 * 所以店主定的做法是:
 *   **替身也要给出一把确定的 `session_key`,并用它按真算法加密一份测试载荷**;
 *   服务端那一步**照真算法解密**。
 * 于是被替的仍然只有「问腾讯这个 code 是谁」那一跳,**加解密两头都是真的**。
 *
 * ══ 真算法(微信开放文档:加密数据解密算法)══
 *   key = base64decode(session_key)  · iv = base64decode(iv)  · AES-128-CBC · PKCS#7
 *   解出来是一段 JSON:{ phoneNumber, purePhoneNumber, countryCode, watermark: { appid, timestamp } }
 *
 * ══ 解密失败必须拒绝(J-53 同族)══
 * **不许回落成空号继续走。** 一个「解密失败但照样建出来的顾客」= 一个没有手机号的档案,
 * 而 D190 之后那就是一个**永远认不出来的人**。宁可当场报错。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/** 替身用的那把 `session_key`:**由 openid 确定地推出来**,不随机 —— 同一个人两次登录拿到同一把。 */
export function stubSessionKeyFor(openid) {
  const raw = Buffer.alloc(16)
  Buffer.from(String(openid || 'anon')).copy(raw)
  return raw.toString('base64')
}

/**
 * 按**真算法**加密一份手机号载荷(替身/夹具侧用)。
 * 它和下面的 `decryptWechatPhone` 是一对:加密这头假装是微信,解密那头是我们真的代码。
 */
export function encryptPhonePayloadForStub({ sessionKey, phone, appid = 'stub-appid' }) {
  const key = Buffer.from(sessionKey, 'base64')
  const iv = randomBytes(16)
  const plain = JSON.stringify({
    phoneNumber: phone, purePhoneNumber: phone, countryCode: '86',
    watermark: { appid, timestamp: 1 },
  })
  const c = createCipheriv('aes-128-cbc', key, iv)
  const encryptedData = Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('base64')
  return { encryptedData, iv: iv.toString('base64') }
}

/**
 * 解密微信手机号。**失败一律抛**,调用方不许把它兜成空号。
 * @returns {{ phoneNumber: string, purePhoneNumber: string, countryCode: string }}
 */
export function decryptWechatPhone({ encryptedData, iv, sessionKey }) {
  if (!encryptedData || !iv || !sessionKey) throw new Error('手机号解密:缺 encryptedData / iv / session_key')
  let json = ''
  try {
    const d = createDecipheriv('aes-128-cbc', Buffer.from(sessionKey, 'base64'), Buffer.from(iv, 'base64'))
    json = Buffer.concat([d.update(Buffer.from(encryptedData, 'base64')), d.final()]).toString('utf8')
  } catch (e) {
    /* 密文被改过一个字节、iv 不对、session_key 不对 —— 都落在这里。**不许兜成空号。** */
    throw new Error(`手机号解密失败(密文/iv/session_key 对不上):${e && e.message}`)
  }
  let data = null
  try { data = JSON.parse(json) } catch { throw new Error('手机号解密:解出来的不是 JSON') }
  const phoneNumber = String(data && (data.purePhoneNumber || data.phoneNumber) || '').trim()
  if (!phoneNumber) throw new Error('手机号解密:解出来了但没有号码')
  return { phoneNumber, purePhoneNumber: String(data.purePhoneNumber || phoneNumber), countryCode: String(data.countryCode || '') }
}
