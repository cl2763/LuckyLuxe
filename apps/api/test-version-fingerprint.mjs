/* 三端版本指纹(店主 04f §一.3):**三端同号才算同一版本**

   ══ 为什么要它 ══
   「你测的和她用的是不是同一份」这个问题,过去只能猜:回归把服务 restore 成别的版本、
   浏览器拿着旧缓存、小程序开发者工具没重编译 —— 三种都长得一样。
   现在:后端出 `/health.version = { build, commit, builtAt }`,
   `build` 是这台服务**实发的 admin.html 指纹**(不是手写常量 ——
   2026-08-30 退回件②的教训:手写的那个我改了三轮 admin.js 它一个字没动);
   网页左下角读它,小程序「关于」页读它。**一处对不上就知道谁的缓存旧了。**

   ⚠️ standalone:CI_SUITES="version-fingerprint" bash apps/api/run-all-tests.sh */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertTestTarget } from './test-guard.mjs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const health = await (await fetch(`${BASE_URL}/health`)).json()
const v = health.version || {}
console.log(`   [指纹] build=${v.build} · commit=${v.commit} · builtAt=${v.builtAt}`)

check('① 后端出三项:`/health.version` 必须同时有 build / commit / builtAt —— '
  + '少一项就没法回答「哪一版、哪个提交、什么时候起的」',
  Boolean(v.build) && Boolean(v.commit) && Boolean(v.builtAt)
  && v.build !== 'none' && v.build !== 'error', JSON.stringify(v))

check('①b `version.build` 与 `adminBuild` 同源(都由服务自己算实发的 admin.html 指纹,不读手写常量)',
  v.build === health.adminBuild, `${v.build} vs ${health.adminBuild}`)

/* ② 网页那一端:左下角把它渲染出来 —— 渲染链要闭合,不能只有接口有 */
const adminJs = readFileSync(join(ROOT, 'apps/web/admin.js'), 'utf8')
check('② 网页端渲染链闭合:`admin.js` 里有把版本号写进 DOM 的那一行(`versionTag.textContent`),'
  + '且优先取服务下发的 `window.LL_BUILD`,手写常量只当兜底',
  /versionTag\.textContent\s*=/.test(adminJs) && /window\.LL_BUILD\s*\|\|/.test(adminJs), '')

/* ③ 小程序那一端:api 出口 → 页面 setData 字段 → wxml 绑定,三段都要在(跨端效果律的形制) */
const mpApi = readFileSync(join(ROOT, 'miniprogram/utils/api.js'), 'utf8')
const mpJs = readFileSync(join(ROOT, 'miniprogram/pages/about/index.js'), 'utf8')
const mpWxml = readFileSync(join(ROOT, 'miniprogram/pages/about/index.wxml'), 'utf8')
const appJson = JSON.parse(readFileSync(join(ROOT, 'miniprogram/app.json'), 'utf8'))
check('③ 小程序渲染链闭合:api 有 `getHealth` 出口 → 「关于」页 setData 了 build/commit/builtAt '
  + '→ wxml 里三项各有 `{{}}` 绑定 —— 三段缺一段就是「接口有、页面看不见」',
  /function getHealth\(/.test(mpApi) && /getHealth\b/.test(mpJs)
  && /setData\([\s\S]*build:/.test(mpJs)
  && /\{\{build/.test(mpWxml) && /\{\{commit/.test(mpWxml) && /\{\{builtAt/.test(mpWxml), '')

check('③b 「关于」页在 `app.json` 里注册了(没注册的页面点不进去,等于没做)',
  (appJson.pages || []).includes('pages/about/index'), '')

check('③c 「我的」页有进得去的入口(`navigator` 指向 /pages/about/index)—— '
  + '⚠️ 入口只加在 wxml:`pages/me/index.js` 638 行已超 600 行红线、现状冻结,不许再加',
  /url="\/pages\/about\/index"/.test(readFileSync(join(ROOT, 'miniprogram/pages/me/index.wxml'), 'utf8')), '')

/* ④ 反向守:`/health` 必须是**免租户**的口,否则小程序拿不到(口径④ fail-closed 之后没带头会 400) */
const bare = await fetch(`${BASE_URL}/health`)
check('④ 反向守:`/health` **不带门店标识也要 200** —— 它是服务自述口,不属于任何门店;'
  + '口径④ 放闸后顾客侧没带头一律 400,这一口必须在免租户名单里,否则「关于」页永远读不到',
  bare.status === 200, String(bare.status))
const mpTenantFree = /TENANT_FREE_PATHS\s*=\s*\[[^\]]*'\/health'/.test(mpApi)
check('④b 小程序侧同一件事:`/health` 在 `TENANT_FREE_PATHS` 里(否则没选门店时直接被 NO_TENANT 挡下)',
  mpTenantFree, '')

console.log(`\n[版本指纹] 后端 ${v.build} · 三端同源(网页读 LL_BUILD / 小程序读 /health.version)`)
if (fails.length) { console.error(`\n❌ test-version-fingerprint ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-version-fingerprint 通过 ${checks} 项`)
