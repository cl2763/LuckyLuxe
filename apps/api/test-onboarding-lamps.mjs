/* D217 · lampsOf 薄包装判据(12l补 条件 1/2/3) */
import { DatabaseSync } from 'node:sqlite'
import { createOnboardingSteps } from './onboarding-steps.mjs'
const dbPath = process.argv[2] || process.env.TEST_DB_PATH
  || `${process.env.DATA_DIR || './local-data'}/lucky-luxe.sqlite`
const db = new DatabaseSync(dbPath, { readOnly: true })
const { stepsOf, lampsOf, STEP_KEYS } = createOnboardingSteps({ db, json: () => {}, apiError: (c, k, m) => Object.assign(new Error(m), { statusCode: c }) })
const tenants = db.prepare('SELECT id, name FROM tenants ORDER BY rowid').all()
// 判据五:被循环包住的断言,取不到前置就红,不许静默跳过 —— 0 家租户会产 0 条断言而报绿。
if (!tenants.length) { console.log('  🔴 库里 0 家租户,三个条件一条也没验到 —— 判据无效'); process.exit(1) }
let pass = 0, fail = 0
/* 🔴 输出格式改成 TAP 的 `ok N - …`(店主 12m裁四批,2026-09-24)。
   原来打 `  ✅ …`,而 test-assertion-baseline 那把尺子**只数 `^ok ` 行** ——
   于是这一套的断言对基线完全隐形:少几条、整套空转,棘轮都不会红。
   **不加进「零断言白名单」**:那等于拿白名单吸收判据缺陷(J-49),
   断言内容一个字没动,只换打印形状。 */
let n = 0
const ok = (c, m) => { n++; c ? (pass++, console.log(`ok ${n} - ${m}`)) : (fail++, console.log(`not ok ${n} - ${m}`)) }
console.log(`\n── 条件①:汇总 ≡ 全量(${tenants.length} 家 × 5 盏)──`)
for (const t of tenants) {
  const full = stepsOf(t.id), lite = lampsOf(t.id)
  const sameLamps = full.steps.every((x, i) => x.state === lite.lamps[i])
  ok(sameLamps, `${t.id}:五盏灯色逐个相同 [${lite.lamps.join(',')}]`)
  ok(full.summary === lite.summary, `${t.id}:那一句相同`)
}
console.log('\n── 条件②:第五盏恒灰 ──')
for (const t of tenants) {
  const lite = lampsOf(t.id)
  ok(lite.lamps[4] === 'unavailable', `${t.id}:第五盏 = ${lite.lamps[4]}`)
}
console.log('\n── 条件③:耗时实测(不猜)──')
const t0 = Date.now(); for (const t of tenants) lampsOf(t.id); const ms = Date.now() - t0
console.log(`  ${tenants.length} 家跑一遍 lampsOf:${ms} ms(均 ${(ms / tenants.length).toFixed(1)} ms/家)`)
console.log(`  判据线:>300 ms 才立缓存案`)
// 🔴 不写成 ok(...):没有任何需求规定「必须 ≤300ms」,写断言就是把巧合钉成契约(J-119)。
//    店主 12l补 裁的是「超 300ms 才立缓存案」——一次性判断,不是常驻不变式。
//    D224 条件式:生产租户到 30 家时再按正门造景量一次。这里只出情报,不计入断言数。
console.log(`  ${ms > 300 ? '🔴 超线 —— 按 D224 立缓存案' : '未超线,按裁定不做缓存'}`)
console.log(`\n  ${pass} 过 · ${fail} 红`)
process.exit(fail ? 1 : 0)
