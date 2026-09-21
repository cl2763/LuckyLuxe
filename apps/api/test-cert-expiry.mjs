/* 🔴 证书到期告警(11f-补 §四)· 判据
 *
 * 案底:交接文档写着证书用 `--register-unsafely-without-email` 注册 ——
 * **没绑邮箱,到期不会有任何邮件提醒**。自动续期开着,但「正常」失效那天没人会被通知。
 * 官网和 `api.jingshengyouji.com` 都挂在这上面;`api.` 挂了 = 小程序全线连不上后端。
 *
 * 🔴 这把刀验的是**判定函数**,不是网络 —— 网络那一层在 `tools/cert-expiry-check.mjs`
 * 的命令行模式里真打(不进回归,因为回归不该依赖外网)。**差在哪写在这儿,不含糊。**
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`); fails.push(name) }
}

const m = await import('../../tools/cert-expiry-check.mjs')

check(`① 阈值写死在唯一出口里:${m.WARN_DAYS} 天`, m.WARN_DAYS === 21)
check(`② 盯着的域名 ${m.HOSTS.length} 个,含官网与 api(api 挂了 = 小程序全线连不上)`,
  m.HOSTS.includes('www.jingshengyouji.com') && m.HOSTS.includes('api.jingshengyouji.com'), m.HOSTS.join(' '))
check('③ 🔴 造病:剩 20 天 → 必须报警', m.shouldWarn(20) === true)
check('④ 🔴 反向守:剩 22 天 → 不许报警(只会红不会绿的告警,三天就没人看了)', m.shouldWarn(22) === false)
check('⑤ 恰好等于阈值(21 天)→ 不报(阈值是「小于」,边界写死)', m.shouldWarn(21) === false)
check('⑥ 🔴 **取不到也必须报警**(取不到 ≠ 没问题 —— 静默失败器族)',
  m.shouldWarn(NaN) === true && m.shouldWarn(undefined) === true)
check('⑦ 能从 openssl 那行文本里抠出到期时刻',
  m.parseEnddate('notAfter=Dec 20 15:58:17 2026 GMT') > Date.parse('2026-12-01'))
check('⑧ 🔴 反向守:喂它一行不含 notAfter 的文本 → 回 null(而不是猜一个时刻)',
  m.parseEnddate('subject=CN = x') === null && m.parseEnddate('') === null)
check('⑨ 案底写在出口抬头:没绑邮箱这件事要写清,否则下一个人会以为自动续期就万事大吉',
  /register-unsafely-without-email/.test(readFileSync(join(ROOT, 'tools/cert-expiry-check.mjs'), 'utf8')))

console.log(`\n[证书告警] 阈值 ${m.WARN_DAYS} 天 · 盯 ${m.HOSTS.length} 个域名`)
if (fails.length) { console.error(`\n❌ test-cert-expiry ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-cert-expiry 通过 ${checks} 项`)
