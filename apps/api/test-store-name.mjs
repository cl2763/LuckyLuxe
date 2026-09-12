/* 店名单一真相刀(店主 02u/02v 裁定,2026-09-02 落)

   立刀背景:店主把店名从「Lucky Luxe」改成「**LUVIA 半径**」(英文 **LUVIA**),
   而现扫发现店名在代码里散了 41 处硬编码、在数据里有**四处真相**
   (`tenants.name` / `stores.name` / `brandName` / `assistantName`),
   其中顾客端读的 `stores.name` 现值还多一个 `Ontario` —— **那个多出来的词就是单一真相破裂的症状**。

   本刀守四件(店主 02u 第四节):
   ① 店名零硬编码(白名单式:全仓每处店名字面量必须落进白名单,逐条写理由 + 条目数棘轮)
   ② 两端两语都对(老板端 + 顾客端 × 中/英)—— 行为层在 test-cross-end-effect / 运行时刀
   ③ 隔离守(改 lucky-luxe 后 jics-nail 店名仍是她自己的)
   ④ 历史不回改(改名前已签署单快照仍是旧名,新单是新名;两个方向各一条)

   🔴 判据不锚在店名字面量上(店主 02v 裁定五收编为律):
   本刀**不**去数「代码里还有几个 LUVIA 半径」——那是把定时炸弹的引信重设一遍,下次改名照炸。
   ①数的是「**店名类字面量**」这个形状(旧名 + 新名都算),而②③④ 全部**从数据现取**店名,
   一个业务值都不写死。 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { assertTestTarget, isTestTarget } from './test-guard.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ===== 扫描面:会跑的代码,不含文档/回归日志/历史截图 =====
   文档面 299 处不改(店主 02v 裁定四:文档是当时的记录,改了就是篡改历史)。 */
const SCAN_DIRS = ['apps/api', 'apps/web', 'apps/wecom-gateway', 'miniprogram', 'tools']
const SCAN_EXT = /\.(mjs|js|ts|json|html|wxml|wxss|sql|sh)$/
const SKIP_DIR = /(node_modules|\.git|regression-logs|local-data|sandbox-data|backups)/

function walk(dir, out = []) {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return out
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (SKIP_DIR.test(rel)) continue
    if (e.isDirectory()) walk(rel, out)
    else if (SCAN_EXT.test(e.name)) out.push(rel)
  }
  return out
}
const FILES = SCAN_DIRS.flatMap((d) => walk(d))

/* 店名类字面量的**形状**(不是某一个具体店名):旧名与新名都算,将来再改名照样命中。
   —— 判据锚在"店名这个东西"上,不锚在"当前叫什么"上。 */
const NAME_SHAPE = /(Lucky\s*Luxe|LUVIA\s*半径|LUVIA(?!\w))/g

/* 白名单:**逐个文件**写理由 + 该文件允许的处数。
   不用行号做 key —— 行号一改白名单就散,那是判据自己会腐烂。
   处数写死:**同一文件里多出一处店名字面量就红**(新写的硬编码跑不掉)。 */
const ALLOW = {
  'apps/api/ai-utils.mjs': { n: 5, why: 'D:记录 2026-08-07「写死 Lucky Luxe·Ontario 致境内店答成 CAD」那次的注释,历史不回改' },
  'apps/api/data/ai-customer-service/phase1-kb.seed.json': { n: 5, why: 'B:KB 结构键名 removalNonLuckyLuxe(代码标识,改了要连带改读取方);另4处已改新名,命中的是新名形状' },
  'apps/api/hero-slides.mjs': { n: 3, why: 'D:模块抬头记录「别家店首页全是本店图」那次的归因' },
  'apps/api/local-server.mjs': { n: 6, why: 'B/D:启动日志1 + 员工演示密码常量1 + 迁移语句里的旧名串6 + 记录当年踩坑的注释8。迁移必须拿旧名做条件,注释是历史记录' },
  'apps/api/other-tenant-names.mjs': { n: 1, why: '判据面:本件说明注释(它就是为改名立的现取件)' },
  'apps/api/package.json': { n: 1, why: 'B:包描述' },
  'apps/api/prisma/seed.ts': { n: 1, why: 'B·旧栈:seed 里的门店名,零引用。**什么时候要动:一旦 prisma 这条链被复活,须同步改成新店名**' },
  'apps/api/run-all-tests.sh': { n: 1, why: 'B:脚本抬头注释' },
  'tools/seed-luvia-bj.mjs': { n: 4, why: 'B·造景件:北京旗舰店 `luvia-bj` 的**建店参数**(抬头注释 1 + 中文店名 1 + 英文名 1 + 助手名 1)。这是「这家店叫什么」的源头,不是渲染层的硬编码 —— 建店脚本必须把名字写出来才建得出店;渲染侧一律从库现取。处数写死 4,多一处即红' },
  'apps/api/smoke-qwen.mjs': { n: 2, why: 'B:冒烟脚本抬头与终端标题,开发者面' },
  'apps/api/src/main.ts': { n: 1, why: 'B·旧栈:启动日志。**什么时候要动:这套 Nest 入口被复活时**;它只打给开发者看,顾客与老板都看不到' },
  'apps/api/store-identity.mjs': { n: 8, why: '本批从 local-server 搬出的店名模块:迁移必须拿旧名做条件 + 记录 2026-08-07 那次的注释' },
  'apps/api/supabase/001_init.sql': { n: 1, why: 'B·旧栈:当前零引用、回归跑不到。**什么时候要动:一旦这套 SQL 被复活(重新建库/迁回 supabase),须同步改成新店名**' },
  'apps/api/test-hero-slides.mjs': { n: 3, why: '判据面:本刀说明 + 改锚后的注释' },
  'apps/api/test-noshow-aftersales.mjs': { n: 11, why: '判据面:㉟ 的检测词(旧名+新名形状)与说明当年病灶的注释;检测词删了这条刀就失明' },
  'apps/api/test-turn-answer.mjs': { n: 1, why: '判据面:⑥c 那条「口吻条不许带店名」的**检测词清单**(含三家店名的形状)。删了这条刀就失明 —— 与 test-noshow-aftersales 的检测词同一性质' },
  'apps/api/test-store-name.mjs': { n: 8, why: '判据面·自指:本刀的说明与白名单理由里必然写到旧名与新名(它就是管店名的刀)。处数按实算,多一处即红' },
  'apps/api/test-tenant-hygiene.mjs': { n: 2, why: '判据面:改锚后的注释' },
  'apps/api/test-web-settlement.mjs': { n: 1, why: '判据面:跨店串味检测的租户字面量清单(含 ID 与店名,旧名要留)' },
  'apps/web/admin.html': { n: 1, why: '已改;命中的是老板端「预约助手」区块里的新名形状' },
  'apps/web/customer.js': { n: 3, why: 'D:记录当年「写死三张本店图,别家顾客看到本店」那次的注释' },
  'apps/wecom-gateway/package.json': { n: 1, why: 'B:包描述' },
  'apps/wecom-gateway/server.mjs': { n: 1, why: 'B:网关 404 错误文案(开发者面)' },
  'miniprogram/app.js': { n: 3, why: 'B:开发者 console 前缀 [LuckyLuxe][privacy],顾客与老板都看不到' },
  'miniprogram/pages/home/index.js': { n: 1, why: 'D:注释,记录首页写死三张本店图那次' },
  'miniprogram/pages/me/index.js': { n: 2, why: 'B:开发者 console 前缀 [LuckyLuxe][auth]' },
  'miniprogram/pages/merchant-forgot/index.wxml': { n: 1, why: 'B·店主 02w 裁定三准:LuckyLuxe-Support 是**真实外部标识**(平台客服微信号),非店名字面量,改文案会让商家加不到人。**什么时候要动:更换平台客服微信号时,这里同步改**' },
  'miniprogram/pages/store-location/index.js': { n: 1, why: 'D:注释,记录该页曾显示本店名+占位简介' },
  'miniprogram/utils/api.js': { n: 1, why: 'D:注释,记录营业时间/时区兜底串味那一例' },
  'miniprogram/utils/deploy.js': { n: 1, why: 'D:注释,记录「小婕顾客看到本店服务与加币价」那一例' },
  'tools/seed-bigdemo.mjs': { n: 1, why: '已改新名(大演示夹具 label)' },
  'tools/seed-demo-twin.mjs': { n: 2, why: '已改新名(镜像演示店 label)' },
  'tools/seed-selfcheck-data.mjs': { n: 1, why: '已改新名,命中的是新名形状(夹具 label)' },
  'tools/verify-jics-kb.mjs': { n: 2, why: '判据面:泄漏检测词(旧名+新名都留,旧数据里还有旧名)' },
}
const ALLOW_CAP = 40   /* 条目数棘轮,只减不增 */

const hits = []
for (const f of FILES) {
  const src = readFileSync(join(ROOT, f), 'utf8')
  src.split('\n').forEach((ln, i) => {
    NAME_SHAPE.lastIndex = 0
    if (NAME_SHAPE.test(ln)) hits.push({ file: f, line: i + 1, text: ln.trim().slice(0, 100) })
  })
}
const byFile = {}
for (const h of hits) (byFile[h.file] ||= []).push(h)
const bad = []
for (const [f, list] of Object.entries(byFile)) {
  const a = ALLOW[f]
  if (!a) { bad.push(...list.map((h) => ({ ...h, why: '整个文件不在白名单' }))); continue }
  if (list.length > a.n) bad.push(...list.slice(a.n).map((h) => ({ ...h, why: `该文件超出登记处数 ${a.n}` })))
}

check(`① 店名零硬编码:扫描面 ${FILES.length} 个文件、命中 ${hits.length} 处店名字面量,`
  + `每处必须落进白名单(逐条写理由;判据认的是**店名这个形状**,不是当前叫什么)`,
  bad.length === 0, `${bad.length} 处未登记`)

check(`①b 白名单棘轮 ≤ ${ALLOW_CAP}(只减不增)`, Object.keys(ALLOW).length <= ALLOW_CAP,
  String(Object.keys(ALLOW).length))

check('①c 反向守:扫描面没缩水(文件数下限 200;文件搬走导致"扫不到所以全绿"必红)',
  FILES.length >= 200, String(FILES.length))

/* ===== ②③④ 全部从数据现取,零业务字面量 ===== */
const DB = process.env.TEST_DB_PATH || join(ROOT, 'apps/api/local-data/lucky-luxe.sqlite')
if (!existsSync(DB)) {
  console.log(`⚠️  [store-name] 取不到库 ${DB} —— **②③④ 本轮未跑**(不是通过)`)
} else {
  const db = new DatabaseSync(DB, { readOnly: true })
  const tenants = db.prepare('SELECT id, name FROM tenants').all()
  /* name_en 是本批甲案要加的新列;还没加时不许整刀崩掉 —— 明说"这条没验成"(静默失败器族的反面) */
  const hasEn = db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('stores') WHERE name = 'name_en'").get().n > 0
  const stores = db.prepare(`SELECT tenant_id, name${hasEn ? ', name_en' : ''} FROM stores`).all()
  const facts = db.prepare("SELECT tenant_id, key, value FROM tenant_kb_facts WHERE key IN ('brandName','assistantName')").all()
  db.close()

  const T = 'lucky-luxe'
  const tRow = tenants.find((x) => x.id === T)
  const sRow = stores.find((x) => x.tenant_id === T)
  const brand = facts.find((x) => x.tenant_id === T && x.key === 'brandName')
  const asst = facts.find((x) => x.tenant_id === T && x.key === 'assistantName')

  /* ② 四处真相归一:三处店名逐字相同,助手名 = 店名 + 预约助手 */
  const three = [tRow?.name, sRow?.name, brand?.value]
  check('② 四处真相归一:tenants.name / stores.name / brandName 三处**逐字相同**(不许再有一处多个地名)',
    three.every((x) => x && x === three[0]), JSON.stringify({ tenants: tRow?.name, stores: sRow?.name, brandName: brand?.value }))
  check('②b assistantName = 店名去掉「半径」后 + 预约助手(店主 02v 定案口径;从数据现取,不写死)',
    !!asst?.value && asst.value.endsWith('预约助手') && asst.value.length > 4,
    JSON.stringify(asst))
  check('②c 英文名字段落地:stores 有 name_en 列且 lucky-luxe 的值非空(甲案新列)',
    hasEn && !!(sRow && sRow.name_en && sRow.name_en.trim()),
    hasEn ? JSON.stringify({ name_en: sRow?.name_en }) : 'stores 表还没有 name_en 列')

  /* ③ 隔离守:别家店的名字没被扫到 —— 现取,不写死小婕店叫什么 */
  const others = stores.filter((s) => s.tenant_id !== T)
  const collided = others.filter((s) => s.name && s.name === sRow?.name)
  check(`③ 隔离守:其余 ${others.length} 家店的店名没有一家被改成本店名(防"改成了全局默认值")`,
    others.length > 0 && collided.length === 0,
    others.length === 0 ? '取不到别家店 —— 这条本轮什么都没验到' : collided.map((c) => `${c.tenant_id}=${c.name}`).join(' | '))
  check('③b 反向守:被测集合非空(至少取得到另一家店的店名;取空即红)',
    others.length > 0, String(others.length))
}

/* ═══ ④ 显示侧:商家看见的那行店名,只有一处真相(D156,店主 2026-09-08 裁)═══

   案由(接本刀开头那句「数据里有四处真相」):商家在门店设置改店名,改的是 `stores.name`
   (`PUT /admin/store-info`);而 `tenants.name` **从建店起就没人再动过**。
   谁显示 `tenantName`,谁显示的就是**改名之前那个旧名字** —— 小程序商家端两处正是如此。
   本组把「商家看见的店名」收成一处:后端 `/admin/auth/me` 下发 `storeName`(取 `stores.name`),
   网页顶栏与小程序商家端两处都读它。`tenantName` 留给平台侧(那是商户名,不是门店名)。 */
const srv = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
const adminJs = readFileSync(join(ROOT, 'apps/web/admin.js'), 'utf8')
const adminHtml = readFileSync(join(ROOT, 'apps/web/admin.html'), 'utf8')
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* 🔴 判据的扫描面要跟着代码走(判据三推论:判据的覆盖面本身要有判据)。
   这条一开始只读 `local-server.mjs`;`merchantIdentity` 一搬进 `store-identity.mjs`,
   它立刻红了 —— 红得对:**代码搬家了判据没跟上**。现在两头都读:名字在模块里取,路由必须用它。 */
const identity = readFileSync(join(ROOT, 'apps/api/store-identity.mjs'), 'utf8')
check('④ 后端「商家看见的名字」取自 **stores** 表(不是 tenants),且 `/admin/auth/me` 真的用了那个出口',
  /SELECT id, name FROM stores WHERE tenant_id = \? AND is_active = 1/.test(identity)
  && /storeName: store\?\.name \|\| ''/.test(identity)
  && /merchantIdentity\(db, me\.tenantId \|\| currentTenantId\(\)\)/.test(srv)
  && /storeName: who\.storeName/.test(srv))

/* 顶栏那一行:白名单式 —— 它只许从 `owner.storeName` 出。
   写死店名、回落到租户名/人名,都是这条判据要咬的(零回落红线 + 一处真相)。 */
const brandFn = (adminJs.match(/function renderBrandSubtitle\(\)[\s\S]*?\n}/) || [''])[0]
check('④b 网页顶栏那行有专门的出口 `renderBrandSubtitle()`,且只从 `owner.storeName` 取名',
  brandFn.includes('owner.storeName') && !/tenantName|displayName/.test(brandFn), brandFn.slice(0, 120))
NAME_SHAPE.lastIndex = 0   // 带 g 的正则 `.test()` 是有状态的:上面那轮扫完 lastIndex 不在 0,这里不重置会漏判
check('④b2 🔴 顶栏那行不许写死店名(造病:把店名写进这个函数 → 红)',
  Boolean(brandFn) && !NAME_SHAPE.test(brandFn.replace(/\/\*[\s\S]*?\*\//g, '')))
check('④c 顶栏那行有稳定锚点 `data-tenant-name`(判据锚选择器,不锚文案)',
  /id="adminBrandSubtitle" data-tenant-name/.test(adminHtml))
check('④d 一锁回登录页就把店名清空(换个人登进来不许看到上一家店)',
  /owner\.storeName = ''/.test(adminJs) && /if \(locked\) \{ owner\.storeName = ''; renderBrandSubtitle\(\) \}/.test(adminJs))

/* ④e 白名单式全仓扫(判据三:数「全部必须落进白名单」,不数「我列的都对」):
   **商家可见的渲染面**里不许再出现 `tenantName`。平台面(platform.html / platform-ops)是另一回事 ——
   那里显示的本来就是商户名,不在这个扫描面里。 */
const MERCHANT_FACE = [
  'apps/web/admin.js', 'apps/web/admin.html', 'apps/web/admin-copy.js',
  ...walk('miniprogram/pages').filter((f) => f.includes('/merchant')),
]
const tenantNameHits = MERCHANT_FACE.filter((f) => /\btenantName\b/.test(stripComments(readFileSync(join(ROOT, f), 'utf8'))))
check(`④e 🔴 商家可见的渲染面(${MERCHANT_FACE.length} 个文件)里零处 \`tenantName\` —— 那是商户名,不是门店名`,
  tenantNameHits.length === 0, tenantNameHits.join(' | '))
check('④e2 反向守:扫描面真的盖住了小程序商家端(取不到文件就不是「全绿」,是「没扫到」)',
  MERCHANT_FACE.length >= 10, String(MERCHANT_FACE.length))
for (const [zh, f, needle] of [
  ['小程序 · 管理页', 'miniprogram/pages/merchant/manage/index.js', 'm.storeName'],
  ['小程序 · 我的页', 'miniprogram/pages/merchant/me/index.js', 'm.storeName'],
]) {
  check(`④f 双端同批:${zh} 读的是 \`storeName\``,
    stripComments(readFileSync(join(ROOT, f), 'utf8')).includes(needle))
}
check('④f2 小程序「我的」那行不再回落到人名/编出来的店铺名(零回落红线)',
  !/storeName \|\| .*displayName|我的店铺/.test(stripComments(readFileSync(join(ROOT, 'miniprogram/pages/merchant/me/index.js'), 'utf8'))))

/* ═══ ④g/④h 行为层:接口真的按店给出各自的名字 ═══
   现取,零业务字面量;跑不成就明说「本轮未跑」,不冒充通过(静默失败器族的反面)。 */
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || requireOwnerToken()
const meOf = async (tenantId) => fetch(`${BASE_URL}/admin/auth/me`, {
  headers: { authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': tenantId },
}).then((r) => (r.ok ? r.json() : null)).catch(() => null)

/* 🔴 测试护栏(店主 08-24 裁 C:套件永远不许写进真库)。
   ④h 会改一次店名,所以这一段**只在服务往测试库写时才跑**;
   判断走 `test-guard.mjs` 的同一处口径,不在这里另写一套。
   不是测试库就明说「本轮未跑」——**不是通过**,也不偷偷跑下去。 */
const onTestTarget = await isTestTarget(BASE_URL)
if (!onTestTarget || !existsSync(DB)) {
  console.log(`⚠️  [store-name] ${BASE_URL} 不是测试库(或取不到库)—— **④g/④h 本轮未跑**(不是通过)`)
  console.log('   正确跑法:bash apps/api/run-all-tests.sh store-name(它用 /tmp/ll-ci-data.XXXX 临时库)')
} else {
  await assertTestTarget(BASE_URL)   // 同一把闸再确认一次:这一段往下会写库
  const live = new DatabaseSync(DB)
  /* 三店各一条:店从库里现取(有几家取几家,最多三家),名字也现取 —— 判据里一个店名都不写死 */
  const trio = live.prepare(`SELECT t.id AS tenantId, t.name AS tenantName, s.name AS storeName
    FROM tenants t JOIN stores s ON s.tenant_id = t.id AND s.is_active = 1 ORDER BY t.id LIMIT 3`).all()
  check('④g 造景自证:库里取得到三家店(取不到就没验到任何东西 —— 店主要的就是「三店各一条」)',
    trio.length === 3, `${trio.length} 家`)
  /* 🔴 条数固定成 3,不跟着库里有几家店摆动:
     断言条数会浮动的套件,哪天库里少一家就被「断言零缩水」判成红,人还得回头查是不是真出事了。
     取不到第三家 → 那一条自己红并说清楚,而不是**少打印一条**。 */
  for (let i = 0; i < 3; i += 1) {
    const row = trio[i]
    const me = row ? await meOf(row.tenantId) : null
    check(`④g 第 ${i + 1} 家(${row?.tenantId || '库里没有这一家'}):/admin/auth/me 的 storeName ≡ 该店 stores.name`,
      Boolean(row) && Boolean(me) && me.admin.storeName === row.storeName,
      /* 用 String() 兜一层:接口没返回这个字段时 JSON.stringify 会把键**整个丢掉**,
         报错行看起来就像只有「库」一栏 —— 判据红的时候必须能指认现场 */
      JSON.stringify({ 接口: String(me?.admin?.storeName), 库: row?.storeName, HTTP: me ? 'ok' : '没拿到响应' }))
  }
  /* 🔴 ④h 分叉守 —— 这一条才是「读对了列」的证明。
     `tenants.name` 与 `stores.name` 平时一模一样,所以上面那条读哪一列都会绿(判据看着在守其实没守)。
     把 `stores.name` 改成一个只可能来自这次的值:`storeName` 必须跟着变,`tenantName` 必须不动。
     只在 CI 临时库上做(`TEST_DB_PATH` 有值);跑完**必还原**——夹具不收尾会让判据非幂等(J 族已有案底)。 */
  const target = trio[0]
  if (!process.env.TEST_DB_PATH) {
    console.log('⚠️  [store-name] 没有 TEST_DB_PATH(不是 CI 临时库)—— **④h 本轮未跑**:它要改一次店名,不许在本机库/生产库上做')
  } else if (!target) {
    check('④h 分叉守', false, '没有可用的店')
  } else {
    const marker = `店名分叉刀-${process.pid}`
    live.prepare('UPDATE stores SET name = ? WHERE tenant_id = ? AND is_active = 1').run(marker, target.tenantId)
    const after = await meOf(target.tenantId)
    live.prepare('UPDATE stores SET name = ? WHERE tenant_id = ? AND is_active = 1').run(target.storeName, target.tenantId)
    const restored = await meOf(target.tenantId)
    check('④h 🔴 分叉守:只改 `stores.name` → `storeName` 跟着变、`tenantName` 不动(证明读的是 stores 那一列,不是两列碰巧一样)',
      Boolean(after) && after.admin.storeName === marker && after.admin.tenantName === target.tenantName,
      JSON.stringify({ storeName: after?.admin?.storeName, tenantName: after?.admin?.tenantName, 期望租户名: target.tenantName }))
    check('④h2 收尾:店名已还原(夹具不收尾 = 判据非幂等,J 族有案底)',
      Boolean(restored) && restored.admin.storeName === target.storeName,
      JSON.stringify({ 现在: restored?.admin?.storeName, 原值: target.storeName }))
  }
  live.close()
}

console.log(`\n[店名] 扫描面 ${FILES.length} 文件 · 店名字面量 ${hits.length} 处 · 白名单 ${Object.keys(ALLOW).length} 条`)
if (bad.length) {
  console.log('\n[未登记的逐处]')
  for (const h of bad) console.log(`  ${h.file}:${h.line}  ${h.text}`)
}
if (fails.length) { console.error(`\n❌ test-store-name ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-store-name 通过 ${checks} 项`)
