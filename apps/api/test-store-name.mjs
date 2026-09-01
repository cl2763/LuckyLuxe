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
  'apps/api/prisma/seed.ts': { n: 1, why: 'B 旧栈:seed 里的门店名,零引用。**若将来复活须同步改名**' },
  'apps/api/run-all-tests.sh': { n: 1, why: 'B:脚本抬头注释' },
  'apps/api/smoke-qwen.mjs': { n: 2, why: 'B:冒烟脚本抬头与终端标题,开发者面' },
  'apps/api/src/main.ts': { n: 1, why: 'B 旧栈:启动日志,同上,复活须同步改名' },
  'apps/api/store-identity.mjs': { n: 7, why: '本批从 local-server 搬出的店名模块:迁移必须拿旧名做条件 + 记录 2026-08-07 那次的注释' },
  'apps/api/supabase/001_init.sql': { n: 1, why: 'B 旧栈:当前零引用、回归跑不到。**若将来复活须同步改名**(店主 02v 裁定四要求留痕)' },
  'apps/api/test-hero-slides.mjs': { n: 3, why: '判据面:本刀说明 + 改锚后的注释' },
  'apps/api/test-noshow-aftersales.mjs': { n: 11, why: '判据面:㉟ 的检测词(旧名+新名形状)与说明当年病灶的注释;检测词删了这条刀就失明' },
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
  'miniprogram/pages/merchant-forgot/index.wxml': { n: 1, why: '🔴B 待您裁:平台客服微信号 LuckyLuxe-Support —— 这是**真实微信账号**,改文案会让商家加不到人' },
  'miniprogram/pages/store-location/index.js': { n: 1, why: 'D:注释,记录该页曾显示本店名+占位简介' },
  'miniprogram/utils/api.js': { n: 1, why: 'D:注释,记录营业时间/时区兜底串味那一例' },
  'miniprogram/utils/deploy.js': { n: 1, why: 'D:注释,记录「小婕顾客看到本店服务与加币价」那一例' },
  'tools/seed-bigdemo.mjs': { n: 1, why: '已改新名(大演示夹具 label)' },
  'tools/seed-demo-twin.mjs': { n: 1, why: '已改新名(镜像演示店 label)' },
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

console.log(`\n[店名] 扫描面 ${FILES.length} 文件 · 店名字面量 ${hits.length} 处 · 白名单 ${Object.keys(ALLOW).length} 条`)
if (bad.length) {
  console.log('\n[未登记的逐处]')
  for (const h of bad) console.log(`  ${h.file}:${h.line}  ${h.text}`)
}
if (fails.length) { console.error(`\n❌ test-store-name ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-store-name 通过 ${checks} 项`)
