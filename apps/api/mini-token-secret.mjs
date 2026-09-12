/* 顾客令牌签名密钥的**唯一出口**(店主 07c 裁 #54 · 立 J-53,2026-09-12)
 *
 * ══ 为什么单开一个模块 ══
 * 这把钥匙原来住在 `local-server.mjs:391` 一行里,末端回落到**写在仓库里的字面量**:
 *
 *   WECHAT_MINI_TOKEN_SECRET || WX_MINI_TOKEN_SECRET || WECHAT_MINI_SECRET
 *     || OWNER_TOKEN || 'luckyluxe-mini-dev'
 *   OWNER_TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
 *
 * 把这条链走一遍:生产上两个变量都没设 → `WECHAT_MINI_SECRET` 是 `''`(假)→ 落到 `OWNER_TOKEN`
 * → 它自己也没设 → **落到字面量 `'owner-demo-token'`**。
 * 也就是说「服务端签发」签的是一把**任何读过这个仓的人都知道的钥匙** ——
 * 拿它可以给**任意顾客 id** 造一个验得过的 `mini.<payload>.<sig>`。
 * (顺带:`'luckyluxe-mini-dev'` 那一截其实是**死代码** —— `OWNER_TOKEN` 永远为真,走不到它。)
 *
 * ══ J-53(店主 07c 裁 #54 立,永久生效)══
 * **密钥、签名密钥、凭据,一律不许有回落默认值。**
 * 「配置缺失」的正确反应是**拒绝启动**,不是**换一个能用的值继续跑** ——
 * 后者把「**没配置**」悄悄变成了「**配置成了一个公开值**」,而且一声不响。
 * 这是「有默认值,所以打错了不报错」那一族(D126/D130/D131/D132 · `currentTenantId()` 回落 ·
 * `scopeOf` 的环境变量)的**最高危形态**:前几种是数据串味,这一种是**任何人都能冒充顾客**。
 *
 * ══ 三条口径 ══
 * ① **不按 `NODE_ENV` 判,按库域判**(接 06h 裁 #37 修好的 `scopeOf()`)——
 *    `NODE_ENV` / `RAILWAY_ENVIRONMENT` 是纯环境变量,漏设一个就把生产判成了开发。
 * ② **只有 `ci` / `sandbox` 两个库域**可以在没显式设时用开发值(否则回归自己都跑不起来);
 *    `local` / `production` / `unknown` 一律**拒绝启动**。
 * ③ **不许复用 `OWNER_TOKEN`** —— 平台主令牌兼职顾客令牌签名密钥,
 *    一个泄露两个完蛋、轮换一个另一个当场断。显式设成跟它一样也不行。
 *
 * ⚠️ 开发值 `DEV_ONLY_SECRET` 是**明写的、故意难看的**:它只在 ci/sandbox 可达,
 * 名字自带「不是密钥」四个字。判据要伪造令牌时**从这里取**,不许在判据里再抄一份
 * (07c §一.4:判据里写着默认值,等于把钥匙又抄了一份)。
 */

/* 开发值:只在 ci / sandbox 可达。**不是密钥**,不要往任何真环境放。 */
export const DEV_ONLY_SECRET = 'DEV-ONLY-NOT-A-SECRET-ci-sandbox-only'

/* 允许用开发值的库域 —— 只有这两个 */
export const DEV_SCOPES = new Set(['ci', 'sandbox'])

/* 显式设置只认这两个名字(旧名 WX_ 兼容);
   **`WECHAT_MINI_SECRET`(小程序 AppSecret)与 `OWNER_TOKEN` 都不在其中** —— 那是复用,不是设置。 */
export const EXPLICIT_ENV_NAMES = ['WECHAT_MINI_TOKEN_SECRET', 'WX_MINI_TOKEN_SECRET']

/**
 * 取顾客令牌签名密钥。**不抛异常**,把判断结果原样回给调用方,由调用方决定怎么死。
 * @param {{ env?: object, scopeName?: string, ownerToken?: string }} opts
 * @returns {{ ok: boolean, secret: string, source: string, reason: string, missing: string[] }}
 */
export function resolveMiniTokenSecret({ env = process.env, scopeName = 'unknown', ownerToken = '' } = {}) {
  const explicitName = EXPLICIT_ENV_NAMES.find((n) => String(env[n] || '').trim())
  const explicit = explicitName ? String(env[explicitName]).trim() : ''

  if (explicit) {
    /* 口径③:显式设了,但设成跟主令牌一样 —— 那还是复用,照样拒绝(ci/sandbox 也拒,
       否则「不许复用」这条在唯一会被跑到的地方就没人守)。 */
    if (ownerToken && explicit === String(ownerToken)) {
      return { ok: false, secret: '', source: explicitName, missing: [],
        reason: `${explicitName} 被设成了跟 OWNER_TOKEN 一样的值 —— 密钥不许复用(J-53 口径③):`
          + '平台主令牌兼职顾客令牌签名密钥,一个泄露两个完蛋、轮换一个另一个当场断。' }
    }
    return { ok: true, secret: explicit, source: explicitName, reason: '', missing: [] }
  }

  /* 口径②:只有 ci / sandbox 能走开发值 */
  if (DEV_SCOPES.has(scopeName)) {
    return { ok: true, secret: DEV_ONLY_SECRET, source: 'dev-only(ci/sandbox)', reason: '', missing: [] }
  }

  /* 口径①②:其余库域一律拒绝启动,并**点名缺哪个变量** */
  return { ok: false, secret: '', source: '', missing: [...EXPLICIT_ENV_NAMES],
    reason: `库域 = ${scopeName}(不是 ci / sandbox),顾客令牌签名密钥**必须显式设置**。` }
}

/** 拒绝启动时打印的那段话。**一个字都不许带上密钥本身**(停线:密钥不进任何输出)。 */
export function refusalText(res, { scopeName = 'unknown', dataDir = '' } = {}) {
  return [
    '',
    '🔴 拒绝启动 —— 顾客令牌签名密钥没配置(J-53:密钥不许有回落默认值)',
    '',
    `   库域:${scopeName}${dataDir ? `(${dataDir})` : ''}`,
    `   原因:${res.reason}`,
    res.missing.length ? `   缺:${res.missing.join(' 或 ')}` : '',
    '',
    '   为什么不给它一个默认值:那等于把「没配置」悄悄变成「配置成了一个公开值」——',
    '   仓库里的字面量谁都读得到,拿它能给**任意顾客 id** 造出验得过的令牌。',
    '',
    '   怎么办(这把钥匙由店主亲手创建与灌入,Code 不查看、不打印、不拷贝):',
    '     1) 生成一把:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    '     2) 写进 apps/api/.env(已 gitignore),一行:',
    '          WECHAT_MINI_TOKEN_SECRET=<上一步那串>',
    '     3) 重新启动。',
    '',
    '   ⚠️ 不要设成跟 OWNER_TOKEN 一样 —— 密钥不复用(J-53 口径③),设一样照样拒绝启动。',
    '   ⚠️ ci / sandbox 两个库域不受此限(用明写的开发值),所以回归与沙箱照常跑。',
    '',
  ].filter((l) => l !== '').join('\n')
}

/**
 * 给主进程用的那一道闸:**拿不到就直接拒绝启动**,拿得到就把密钥回给调用方。
 * 收在这里而不是放在 `local-server.mjs` 里,有两个理由:
 *   ① 巨型文件棘轮**只许降不许升** —— 判断逻辑摊在那边会让它涨 5 行(实测过);
 *   ② 这道闸和它守的那把钥匙是同一件事,**该住在同一个文件里**(唯一出口)。
 */
export function requireMiniTokenSecret({ env = process.env, scopeName = 'unknown', dataDir = '', ownerToken = '', onRefuse = null } = {}) {
  const res = resolveMiniTokenSecret({ env, scopeName, ownerToken })
  if (res.ok) return res.secret
  const text = refusalText(res, { scopeName, dataDir })
  if (onRefuse) return onRefuse(text, res)     // 判据用这个口子接住,不必真的把测试进程打死
  console.error(text)
  process.exit(1)
  return ''                                     // 到不了;让静态检查闭嘴
}

/**
 * 这把钥匙**是不是显式配的**(而不是走了 ci/sandbox 的开发值)。
 * 给 `/health` 用 —— J-52:读口里每一格都必须是量出来的。
 * ⚠️ 只回一个 boolean,**永远不回密钥本身、也不回它的长度**。
 */
export function miniSecretIsExplicit(env = process.env) {
  return EXPLICIT_ENV_NAMES.some((n) => String(env[n] || '').trim().length > 0)
}
