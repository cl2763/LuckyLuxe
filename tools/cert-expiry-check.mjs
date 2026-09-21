/* 🔴 证书到期告警(11f-补 §四)—— **唯一出口**
 *
 * ══ 案底(从交接文档里读出来的真风险,店主不知道)══
 * `有迹官网_服务器交接_2026-09-18.md`:证书用 `--register-unsafely-without-email` 注册,
 * **没绑邮箱 ⇒ 到期不会收到任何邮件提醒**。
 * 自动续期(certbot.timer)是开着的,正常不用管 —— **但「正常」失效的那天,没有人会被通知**。
 * 官网和 `api.` 都挂在这上面;`api.` 挂了 = 小程序全线连不上后端。
 *
 * 用法:node tools/cert-expiry-check.mjs [host...]   (默认查那三个)
 * 退出码:0 = 都还够久;1 = 有证书剩余 < 21 天
 */
export const WARN_DAYS = 21
export const HOSTS = Object.freeze(['www.jingshengyouji.com', 'api.jingshengyouji.com', 'www.luckyluxeatelier.com'])

/** 唯一判定:剩余天数 < WARN_DAYS 就该报警。判据与命令行共用这一个函数。 */
export function shouldWarn(daysLeft, warnDays = WARN_DAYS) {
  if (!Number.isFinite(daysLeft)) return true          // 🔴 取不到 ≠ 没问题(静默失败器族)
  return daysLeft < warnDays
}

/** 从 `openssl x509 -enddate` 那行文本里抠到期时刻 */
export function parseEnddate(text) {
  const m = /notAfter=(.+)/.exec(String(text || ''))
  if (!m) return null
  const t = Date.parse(m[1].trim())
  return Number.isFinite(t) ? t : null
}

if (process.argv[1] && process.argv[1].endsWith('cert-expiry-check.mjs')) {
  const { execFileSync } = await import('node:child_process')
  const hosts = process.argv.slice(2).length ? process.argv.slice(2) : HOSTS
  let bad = 0
  for (const h of hosts) {
    let days = NaN
    try {
      const out = execFileSync('bash', ['-c',
        `echo | openssl s_client -servername ${h} -connect ${h}:443 2>/dev/null | openssl x509 -noout -enddate`],
        { encoding: 'utf8', timeout: 20000 })
      const t = parseEnddate(out)
      if (t) days = Math.floor((t - Date.now()) / 86400000)
    } catch { /* 取不到 → NaN → 按该报警处理 */ }
    const warn = shouldWarn(days)
    if (warn) bad += 1
    console.log(`  ${warn ? '🔴' : '🟢'} ${h.padEnd(28)} 剩 ${Number.isFinite(days) ? days + ' 天' : '(取不到)'}`)
  }
  console.log(`\n阈值 ${WARN_DAYS} 天 · ${bad ? `🔴 ${bad} 个要处理` : '🟢 都还够久'}`)
  process.exit(bad ? 1 : 0)
}
