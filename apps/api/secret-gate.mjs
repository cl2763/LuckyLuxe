/* 凭据闸的**共用形状**(店主 07d 裁 #60:「复用 `mini-token-secret.mjs` 那道闸的形状,不许再写一套」)
 *
 * ══ 为什么抽出来 ══
 * J-53 立了之后,仓里会有**不止一把**需要 fail closed 的钥匙(顾客令牌签名密钥、`OWNER_TOKEN`……)。
 * 每把各写一套闸 = **两把钥匙两套闸,以后改一处漏一处** —— 那正是「一件事两处真相」那一族。
 * 所以把形状抽成一个工厂,三件套固定:
 *   · `resolve()`   —— **不抛异常**,把判断结果原样回给调用方(ok / secret / reason / missing);
 *   · `require()`   —— 决定怎么死(拒绝启动),调用方可用 `onRefuse` 接住(判据不必真把进程打死);
 *   · `refusalText()` —— **新机器唯一的说明书**:点名缺什么、给命令、说清为什么不给默认值。
 *
 * ══ 三条口径(与 J-53 同一套,写一次)══
 * ① 按**库域**判,不按 `NODE_ENV`(环境变量漏设一个就把生产判成开发);
 * ② 只有 `ci` / `sandbox` 能在没显式设时用开发值;其余库域一律拒绝启动;
 * ③ **不许复用别的钥匙** —— 显式设成跟指定的「不许相同」那一把一样,照样拒绝。
 */

export const DEV_SCOPES = new Set(['ci', 'sandbox'])

/**
 * @param {object} spec
 * @param {string} spec.label       人话名字,进报错标题(例:「顾客令牌签名密钥」)
 * @param {string[]} spec.envNames  认哪几个环境变量名(第一个是推荐名)
 * @param {string|function} spec.devValue  ci/sandbox 用的开发值;传函数则按 `{scopeName, dataDir}` 现算
 * @param {string[]} spec.howto     「怎么办」那几行(不含缩进)
 * @param {string} [spec.clashLabel] 「不许跟它相同」的那把钥匙叫什么(例:'OWNER_TOKEN')
 */
export function createSecretGate(spec) {
  const { label, envNames, devValue, howto, clashLabel = '' } = spec

  const resolve = ({ env = process.env, scopeName = 'unknown', dataDir = '', clashWith = '' } = {}) => {
    const name = envNames.find((n) => String(env[n] || '').trim())
    const explicit = name ? String(env[name]).trim() : ''
    if (explicit) {
      /* 口径③:显式设了,但设成跟另一把钥匙一样 —— 那还是复用,照样拒绝。
         **ci/sandbox 也拒** —— 否则「不许复用」这条在唯一会被跑到的地方就没人守。 */
      if (clashWith && explicit === String(clashWith)) {
        return { ok: false, secret: '', source: name, missing: [],
          reason: `${name} 被设成了跟 ${clashLabel || '另一把钥匙'} 一样的值 —— 密钥不许复用(J-53 口径③):`
            + '一个泄露两个完蛋、轮换一个另一个当场断。' }
      }
      return { ok: true, secret: explicit, source: name, reason: '', missing: [] }
    }
    if (DEV_SCOPES.has(scopeName)) {
      const v = typeof devValue === 'function' ? devValue({ scopeName, dataDir }) : devValue
      return { ok: true, secret: v, source: `dev-only(${scopeName})`, reason: '', missing: [] }
    }
    return { ok: false, secret: '', source: '', missing: [...envNames],
      reason: `库域 = ${scopeName}(不是 ci / sandbox),${label}**必须显式设置**。` }
  }

  /** 拒绝启动那段话。**一个字都不许带上密钥本身**(停线:密钥不进任何输出)。 */
  const refusalText = (res, { scopeName = 'unknown', dataDir = '' } = {}) => [
    '', `🔴 拒绝启动 —— ${label} 没配置(J-53:密钥不许有回落默认值)`, '',
    `   库域:${scopeName}${dataDir ? `(${dataDir})` : ''}`,
    `   原因:${res.reason}`,
    res.missing.length ? `   缺:${res.missing.join(' 或 ')}` : '',
    '',
    '   为什么不给它一个默认值:那等于把「没配置」悄悄变成「配置成了一个公开值」——',
    '   仓库里的字面量谁都读得到。',
    '', ...howto.map((l) => `   ${l}`), '',
  ].filter((l) => l !== '').join('\n')

  const require_ = ({ env = process.env, scopeName = 'unknown', dataDir = '', clashWith = '', onRefuse = null } = {}) => {
    const res = resolve({ env, scopeName, dataDir, clashWith })
    if (res.ok) return res.secret
    const text = refusalText(res, { scopeName, dataDir })
    if (onRefuse) return onRefuse(text, res)
    console.error(text)
    process.exit(1)
    return ''
  }

  return { resolve, require: require_, refusalText, envNames, DEV_SCOPES }
}
