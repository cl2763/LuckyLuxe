/* 平台主令牌 `OWNER_TOKEN` 的闸(店主 07d 裁 #60,2026-09-12)
 *
 * ══ 案由 ══
 * 07c 治完顾客令牌签名密钥之后,现查发现**同一个病还在另一把钥匙上**:
 *   `local-server.mjs:161  const OWNER_TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'`
 * 而它是**平台最高信任根**(解锁财务、跑测试、平台后台)。
 *
 * ══ 为什么不能一刀切去掉默认值(店主原话)══
 * 「那会让 90 个测试一起红,然后有人为了让它们绿而把钥匙抄进判据,**病就从一处搬到九十处**。」
 * 所以分两层:
 *   **第一层**(`local`/`production`/`unknown`):没显式设 → **拒绝启动**。
 *   **第二层**(`ci`/`sandbox`):**每次启动随机生成**,落到那一轮的 `DATA_DIR` 下 `.owner-token`,
 *     跟着临时目录一起被清掉。
 *     关键一句:**测试需要的是「一个能用的 token」,不是「一个固定的 token」。**
 *     90+ 个测试改的是「**从哪拿**」—— 接下面这个 `readOwnerToken()`,不是每个都改自己那串字面量。
 *   生产上没有这个文件(生产必须显式设),所以这条路**永远出不了 ci/sandbox**。
 *
 * ══ 闸的形状复用 `secret-gate.mjs` ══
 * 店主点名:「不许再写一套 —— 两把钥匙两套闸,以后改一处漏一处。」
 *
 * 🔴 **本文件当前状态:闸写好了,还没接进 `local-server.mjs`,90+ 个测试也还没切。**
 * 理由写在 07d 回执 §四:一接上去,所有拿字面量当 Bearer 的测试当场全红,
 * 那一步要连同「测试统一改接 `readOwnerToken()`」一起做,不能半截上线。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createSecretGate } from './secret-gate.mjs'

export const OWNER_TOKEN_FILE = '.owner-token'

/** ci/sandbox:那一轮随机生成一把,写进 DATA_DIR;同一个 DATA_DIR 再起就复用(同一轮里要稳定) */
export function devOwnerToken({ dataDir = '' } = {}) {
  if (!dataDir) return `dev-owner-${randomBytes(12).toString('base64url')}`
  const f = join(dataDir, OWNER_TOKEN_FILE)
  try { if (existsSync(f)) { const v = readFileSync(f, 'utf8').trim(); if (v) return v } } catch { /* 读不到就重生成 */ }
  const v = `dev-owner-${randomBytes(24).toString('base64url')}`
  try { writeFileSync(f, `${v}\n`, { mode: 0o600 }) } catch { /* 写不进去也能用,只是下次换一把 */ }
  return v
}

export const ownerTokenGate = createSecretGate({
  label: '平台主令牌 OWNER_TOKEN',
  envNames: ['OWNER_TOKEN', 'OWNER_DEMO_TOKEN'],
  devValue: devOwnerToken,
  clashLabel: '顾客令牌签名密钥 WECHAT_MINI_TOKEN_SECRET',
  howto: [
    '怎么办(这把钥匙由店主亲手创建与灌入,Code 不查看、不打印、不拷贝):',
    '  1) 生成一把:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    '  2) 写进 apps/api/.env(已 gitignore),一行:',
    '       OWNER_TOKEN=<上一步那串>',
    '  3) 重新启动。',
    '⚠️ 不要跟 WECHAT_MINI_TOKEN_SECRET 设成同一串 —— 密钥不复用(J-53 口径③)。',
    '⚠️ ci / sandbox 两个库域不受此限:每次启动**随机生成**一把,写在那一轮的 DATA_DIR 下,',
    '   跟着临时目录一起被清掉 —— 测试要的是「一个能用的 token」,不是「一个固定的 token」。',
  ],
})

/** 测试与工具从这里拿 token —— **不许再各自写字面量**(90+ 处将来统一接这个口) */
export function readOwnerToken({ env = process.env, dataDir = '' } = {}) {
  const explicit = String(env.OWNER_TOKEN || env.OWNER_DEMO_TOKEN || '').trim()
  if (explicit) return explicit
  const dir = dataDir || String(env.DATA_DIR || '')
  if (dir) {
    const f = join(dir, OWNER_TOKEN_FILE)
    try { if (existsSync(f)) return readFileSync(f, 'utf8').trim() } catch { /* 落空 */ }
  }
  return ''
}
