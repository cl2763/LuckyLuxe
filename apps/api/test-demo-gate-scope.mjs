#!/usr/bin/env node
/* 裁 #90 · 演示门的闸改「或」不改「换」(店主 07l §二,2026-09-14)
 *
 *     演示门开 ⇔ (不是 IS_PRODUCTION) 且 (库域 ∈ {ci, sandbox})
 *
 * 「或」的意思是**两个判据任一说「这是真的」就关** —— 这个形状只会更严,永远不会更松。
 * 店主点名的四条造病都在下面,外加一条白名单式的「只有一个出口」。
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const knife = (w) => console.log(`   [刀] ${w}`)

const { demoLoginAllowed, scopeOf, isProductionEnv } = await import('./data-scope.mjs')

/* 造几个真实形状的库路径(不建库,只要路径形状对) */
const base = mkdtempSync(join(tmpdir(), 'll-gate90-'))
const prodLike = join(base, 'app', 'apps', 'api', 'local-data')   /* 生产 Volume 就挂在这个相对路径上 */
const sandboxLike = join(base, 'apps', 'api', 'sandbox-data')
const ciLike = mkdtempSync(join(tmpdir(), 'll-ci-data.gate90-'))
for (const d of [prodLike, sandboxLike]) mkdirSync(d, { recursive: true })
const ON = { ALLOW_DEMO_ADMIN_LOGIN: 'true' }

try {
  /* ── ① 店主点名的那个组合:`NODE_ENV` 没设 + 库域是生产库 → 门必须关 ── */
  knife('① NODE_ENV 不设 + 生产库路径(Volume 挂在 …/apps/api/local-data)+ 开关照开')
  const one = demoLoginAllowed({ dataDir: prodLike, env: { ...ON } })
  check('① 🔴 **`NODE_ENV` 没设 + 库连的是生产库 → 门必须关**。'
    + '这正是改造之前会开的那个组合:纯环境变量判定认不出「库在哪」,'
    + '而这是真实会发生的部署事故(部署时漏设一个变量,任何人拿邮箱+任意密码进真库)',
    one === false, `demoLoginAllowed=${one} 库域=${scopeOf(prodLike, {})}`)

  /* ── ② 反向:不许让它变松 ── */
  knife('② NODE_ENV=production + 沙箱库路径 + 开关照开')
  const two = demoLoginAllowed({ dataDir: sandboxLike, env: { ...ON, NODE_ENV: 'production' } })
  check('② 🔴 `NODE_ENV=production` + 库域是 sandbox → 门**仍然必须关**。'
    + '这一条守的是「改造不许让它变松」——「换」有可能在这个组合下把门打开,「或」不会',
    two === false, `demoLoginAllowed=${two} 库域=${scopeOf(sandboxLike, {})} isProd=${isProductionEnv({ NODE_ENV: 'production' })}`)

  /* ── ③ 正向守:ci/sandbox + 非生产 → 门开(否则回归全塌)── */
  const three = ['ci', 'sandbox'].map((k) => demoLoginAllowed({ dataDir: k === 'ci' ? ciLike : sandboxLike, env: { ...ON } }))
  check('③ 正向守:ci / sandbox 库域 + 非生产 → 门**开**(不开的话整轮回归和沙箱一起焊死)',
    three.every(Boolean), `ci=${three[0]} sandbox=${three[1]}`)

  /* ── ③b 开关本身仍然要管用:两关都过,但开关没开 → 还是关 ── */
  check('③b 开关仍是必要条件:ci 库域 + 非生产,但 `ALLOW_DEMO_ADMIN_LOGIN` 没设 → 门关'
    + '(这条防「改成两关之后反而忘了看开关」)',
    demoLoginAllowed({ dataDir: ciLike, env: {} }) === false, '')

  /* ── ③c 「或」的形状自证:枚举全部组合,**任一判据说是真的就必须关** ── */
  const combos = []
  for (const dir of [{ n: 'ci', d: ciLike }, { n: 'sandbox', d: sandboxLike }, { n: '生产库形状', d: prodLike }]) {
    for (const prod of [false, true]) {
      const env = { ...ON, ...(prod ? { NODE_ENV: 'production' } : {}) }
      const open = demoLoginAllowed({ dataDir: dir.d, env })
      const shouldOpen = !prod && ['ci', 'sandbox'].includes(scopeOf(dir.d, env))
      combos.push({ 库: dir.n, 生产变量: prod, 开: open, 该开: shouldOpen, 对: open === shouldOpen })
    }
  }
  check(`③c 「或」形状全组合自证:${combos.length} 个组合逐个对 —— `
    + '**只要两个判据里任何一个说「这是真的」,门就必须关**;两个都说不是,才看开关',
    combos.every((c) => c.对), JSON.stringify(combos.filter((c) => !c.对)))

  /* ── ④ 白名单式:全仓判「这是不是真环境」只许一个出口 ── */
  const walk = (rel, out = []) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = `${rel}/${e.name}`
      if (e.isDirectory()) walk(p, out)
      else if (/\.(mjs|js)$/.test(e.name)) out.push(p)
    }
    return out
  }
  /* J-61②:刀默认排除**判据自身与判据的夹具**,并具名 */
  const SELF = ['apps/api/test-demo-gate-scope.mjs']
  const PROD_PAT = /NODE_ENV\s*===\s*['"]production['"]|RAILWAY_ENVIRONMENT/
  const sites = [...walk('apps'), ...walk('tools')]
    .filter((f) => !SELF.includes(f) && !/\/test-/.test(f))
    .filter((f) => {
      const src = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      return PROD_PAT.test(src)   /* 去掉注释再看:J-61 数的是**执行**,不是**提及** */
    })
  check('④ 🔴 白名单式:全仓判「这是不是真环境」的地方**只许 1 处**'
    + '(`apps/api/data-scope.mjs` 的 `isProductionEnv`)—— 不许 `IS_PRODUCTION` 和 `scopeOf` 各判各的。'
    + '和 `--accent`/`--brand` 归一、启动参数收一处、直连腾讯只留一处是同一条纪律',
    sites.length === 1 && sites[0] === 'apps/api/data-scope.mjs', sites.join(' | '))

  /* ④b 自守:构造第二处,这条扫描必须认得出(不然「只有 1 处」是空转 —— J-58) */
  const probe = ["a.mjs", "b.mjs"].filter(() => PROD_PAT.test("if (process.env.NODE_ENV === 'production') {}"))
  check('④b 自守:构造一处新的真环境判定,这条扫描**必须**认得出它', probe.length === 2, '')

  /* ④c 反向守:注释里提一句不算数(J-61 数执行不数提及) */
  const commentOnly = PROD_PAT.test('// 这里以前用 NODE_ENV === "production" 判过'.replace(/^\s*\/\/.*$/gm, ''))
  check('④c 反向守:只在**注释**里提到 `NODE_ENV === \'production\'` 的文件不算一处出口 '
    + '(J-61:数的是执行,不是提及)——不然写篇注释就能把这条判据顶红',
    commentOnly === false, '')
} finally {
  rmSync(base, { recursive: true, force: true })
  rmSync(ciLike, { recursive: true, force: true })
}

console.log(`\n1..${checks}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过:`); for (const f of fails) console.log(`   - ${f}`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${checks} 条)`)
