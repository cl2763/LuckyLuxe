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

import { createSecretGate, DEV_SCOPES } from './secret-gate.mjs'

/* 允许用开发值的库域 —— 只有这两个(与共用闸同一处真相) */
export { DEV_SCOPES }

/* 显式设置只认这两个名字(旧名 WX_ 兼容);
   **`WECHAT_MINI_SECRET`(小程序 AppSecret)与 `OWNER_TOKEN` 都不在其中** —— 那是复用,不是设置。 */
export const EXPLICIT_ENV_NAMES = ['WECHAT_MINI_TOKEN_SECRET', 'WX_MINI_TOKEN_SECRET']

/* 🔴 店主 07d 裁 #60:**闸的形状收进 `./secret-gate.mjs` 一处** ——
   仓里不止一把需要 fail closed 的钥匙(这一把 + `OWNER_TOKEN`),
   每把各写一套 = 两把钥匙两套闸,以后改一处漏一处。三件套(resolve / require / refusalText)
   由工厂给,这里只提供**这一把钥匙的规格**。 */
const gate = createSecretGate({
  label: '顾客令牌签名密钥',
  envNames: EXPLICIT_ENV_NAMES,
  devValue: DEV_ONLY_SECRET,
  clashLabel: 'OWNER_TOKEN',
  howto: [
    '怎么办(这把钥匙由店主亲手创建与灌入,Code 不查看、不打印、不拷贝):',
    '  1) 生成一把:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    '  2) 写进 apps/api/.env(已 gitignore),一行:',
    '       WECHAT_MINI_TOKEN_SECRET=<上一步那串>',
    '  3) 重新启动。',
    '⚠️ 不要设成跟 OWNER_TOKEN 一样 —— 密钥不复用(J-53 口径③),设一样照样拒绝启动。',
    '⚠️ ci / sandbox 两个库域不受此限(用明写的开发值),所以回归与沙箱照常跑。',
  ],
})

/** 取顾客令牌签名密钥。**不抛异常**,把判断结果原样回给调用方,由调用方决定怎么死。 */
export function resolveMiniTokenSecret({ env = process.env, scopeName = 'unknown', ownerToken = '' } = {}) {
  return gate.resolve({ env, scopeName, clashWith: ownerToken })
}

/** 拒绝启动时打印的那段话。**一个字都不许带上密钥本身**(停线:密钥不进任何输出)。 */
export function refusalText(res, opts = {}) { return gate.refusalText(res, opts) }

/** 给主进程用的那一道闸:**拿不到就直接拒绝启动**,拿得到就把密钥回给调用方。
    收在这里而不是摊在 `local-server.mjs` 里:①巨型文件棘轮只许降不许升(摊过去实测涨 5 行)
    ②这道闸和它守的那把钥匙是同一件事,该住在同一个文件里(唯一出口)。 */
export function requireMiniTokenSecret({ env = process.env, scopeName = 'unknown', dataDir = '', ownerToken = '', onRefuse = null } = {}) {
  return gate.require({ env, scopeName, dataDir, clashWith: ownerToken, onRefuse })
}

/**
 * 这把钥匙**是不是显式配的**(而不是走了 ci/sandbox 的开发值)。
 * 给 `/health` 用 —— J-52:读口里每一格都必须是量出来的。
 * ⚠️ 只回一个 boolean,**永远不回密钥本身、也不回它的长度**。
 */
export function miniSecretIsExplicit(env = process.env) {
  return EXPLICIT_ENV_NAMES.some((n) => String(env[n] || '').trim().length > 0)
}

/* ── `--howto`:把「怎么办」那段话单独打出来(裁 #58② 要预检在②档打印它)──
   预检那边不重抄一份说明书,**调这里** —— 一件事一处真相。
   ⚠️ 打的是同一个 `refusalText()`,所以说明书改一次两处都跟着变。 */
if (process.argv[1] && process.argv[1].endsWith('mini-token-secret.mjs') && process.argv.includes('--howto')) {
  /* 只打「怎么办」往下那几行:②档是**提醒**不是故障,前面那个 🔴 抬头会让人以为出事了。
     但正文仍然取自同一个 `refusalText()`,不另抄 —— 说明书改一次,两处都跟着变。 */
  const full = refusalText(resolveMiniTokenSecret({ env: {}, scopeName: 'local' }), { scopeName: 'local' }).split('\n')
  const i = full.findIndex((l) => l.includes('怎么办'))
  console.log(['如果没起来的那台是 4128,多半是还没配顾客令牌签名密钥(J-53)——', ...(i >= 0 ? full.slice(i) : full)].join('\n'))
}
