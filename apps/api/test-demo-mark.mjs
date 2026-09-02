/* 演示数据标记刀(D121,店主 03b 裁定三入册 / 03t §二第 1 条实做,2026-09-03 落)

   ══ 病 ══
   `bookings` / `settlements` 上**没有演示标记**,演示数据与真实数据在同一张表里认不出来。
   02x 误跑演示夹具那次我能定位到 13 条预约 / 4 张结算,靠的是 `created_at` 时间戳 ——
   **那是运气,不是设计**:换个场景(误跑发生在几天前才发现)这条线就断了。

   ══ 为什么不复用 `source_channel` ══
   它回答「从哪个渠道来」,而「是不是演示」是**正交**的另一个问题 ——
   02x 那 13 条写的就是 `owner_direct`,既可能是真单也可能是造景造的。
   归族「一个字段只许回答一个问题」,所以单开 `demo_seed` 一列。

   ══ 验收判据(挂账原文写死的那句)══
   「**凡造景写入的行必须可被一条查询整批认出来**」—— 不是"加了个列"就算完。
   本刀因此有**行为层**:真跑一次造景,再用那条查询把它整批捞出来。 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { demoSeedTag, DEMO_MARK_TABLES, countDemoRows } from './demo-mark.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ① 出口本身:批次名的形态守得住,且 fail-closed 朝真实数据那一侧 */
const hdr = (v) => demoSeedTag({ headers: { 'x-demo-seed': v } })
check('① 标记出口 fail-closed 朝真实那侧:没给 / 空 / 形态不合规 → null(= 真实数据)。'
  + '宁可把演示当真的(顶多多算一点),不许把真数据当演示的(那会被清掉)',
  demoSeedTag({ headers: {} }) === null && hdr('') === null && hdr('  ') === null
  && hdr('坏名字 有空格') === null && hdr('x'.repeat(60)) === null, '')
check('①b 合规批次名原样收下(字母数字连字符,≤40)',
  hdr('seed-bigdemo') === 'seed-bigdemo' && hdr('full-seed.2') === 'full-seed.2', '')

/* ② 两张表都有这一列,且是走 ALTER 补的(老库与生产才跟得上;公约⑧) */
const server = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
check(`② 两张表(${DEMO_MARK_TABLES.join(' / ')})的列走 ALTER 补 —— `
  + '只写进 CREATE TABLE 等于只对全新库生效,老库(含生产)不会跟上',
  /ensureDemoMarkColumns\(db\)/.test(server) && /ALTER TABLE \$\{t\} ADD COLUMN demo_seed TEXT/
    .test(readFileSync(join(ROOT, 'apps/api/demo-mark.mjs'), 'utf8')), '')

/* ③ 正门盖章:两个建单口都把标记传进去;结算单从预约继承 */
check('③ 建单两个口(顾客侧 POST /bookings · 商家侧 /admin/bookings/direct)都传 demoSeed',
  (server.match(/demoSeed: demoSeedTag\(req\)/g) || []).length >= 2,
  `实测 ${(server.match(/demoSeed: demoSeedTag\(req\)/g) || []).length} 处`)
check('③b 结算单的标记**从它挂的那张预约继承** —— 调用方忘了带头也漏不掉',
  /UPDATE settlements SET demo_seed = \(SELECT demo_seed FROM bookings WHERE id = \?\)/.test(server), '')

/* ④ 造景全族清单:走 HTTP 的必须带头;不写这两张表的逐个写理由 */
const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', 'tools', 'apps/api'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter((f) => /(seed-|demo-seed)/.test(f) && f.endsWith('.mjs') && !f.includes('/test-'))
/* 白名单:不盖章的逐条写理由(它们不写 bookings/settlements,盖了也没有落点) */
const NO_MARK = {
  'apps/api/seed-services.mjs': '只铺服务项目数据(services),不写 bookings/settlements —— 没有落点。什么时候要动:若它开始铺预约',
  'apps/api/tools/demo-seed.mjs': '演示店种子(生产可跑),同样不写 bookings/settlements。什么时候要动:若它开始铺预约',
}
const missing = tracked.filter((f) => !NO_MARK[f] && !readFileSync(join(ROOT, f), 'utf8').includes("'x-demo-seed'"))
check(`④ 白名单式:造景全族 ${tracked.length} 个脚本,走 HTTP 的必须发 \`x-demo-seed\`;`
  + `不发的逐条写理由(现 ${Object.keys(NO_MARK).length} 个,都是不写这两张表的)`,
missing.length === 0, `${missing.length} 个没发:${missing.join(' | ')}`)

/* ⑤ 🔴 行为层:真跑一次造景,那条查询必须把它整批捞出来 —— 判据原文就是这句 */
const { ensureSandbox } = await import('./test-need-sandbox.mjs')
const sb = await ensureSandbox({ label: '[demo-mark]' })
const SB = join(ROOT, 'apps/api/sandbox-data/lucky-luxe.sqlite')
if (!sb.ok) {
  console.log('   ⚠️ 沙箱不可用 —— **行为层这一刀本轮未跑**(不静默跳过,如实说)')
} else {
  const db = new DatabaseSync(SB, { readOnly: true })
  const marked = Object.fromEntries(DEMO_MARK_TABLES.map((t) => [t, countDemoRows(db, t)]))
  const tags = db.prepare("SELECT DISTINCT demo_seed AS t FROM bookings WHERE demo_seed IS NOT NULL").all().map((r) => r.t)
  db.close()
  console.log(`   [现测] 沙箱带标记的行:${JSON.stringify(marked)} · 批次名:${JSON.stringify(tags)}`)
  check('⑤ 🔴 一条查询整批认出来(判据原文):沙箱里造景写的行,'
    + '`WHERE demo_seed IS NOT NULL` 必须捞得到 —— 「加了个列」不算完,要能真捞出来',
  marked.bookings > 0 && tags.length > 0, JSON.stringify({ marked, tags }))

  /* ⑤b 反向守:真实数据不许被标成演示的(fail-closed 那一侧) */
  const db2 = new DatabaseSync(SB, { readOnly: true })
  const realMarked = db2.prepare("SELECT COUNT(*) AS n FROM bookings WHERE demo_seed IS NOT NULL AND source_channel = 'wechat_miniprogram'").get().n
  db2.close()
  check('⑤b 反向守:顾客从小程序真下的单不许被标成演示的 —— '
    + '标错方向的代价不对称:多算一点无妨,把真数据当演示清掉是灾难',
  realMarked === 0, `${realMarked} 条真单被标成了演示`)
}

console.log(`\n[演示标记] 造景脚本 ${tracked.length} 个 · 免盖章白名单 ${Object.keys(NO_MARK).length} · 标记列 ${DEMO_MARK_TABLES.join('/')}`)
if (fails.length) { console.error(`\n❌ test-demo-mark ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-demo-mark 通过 ${checks} 项`)
