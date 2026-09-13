#!/usr/bin/env node
/* J-60「**夹具造状态,要走产生这个状态的那条路;不许直连库贴**」(店主 07j 立,2026-09-13)
 *
 * ══ 案由 ══
 * `stored-value` 里那一步是 `UPDATE users SET wechat_open_id` **直连库贴**的 ——
 * 于是 D25「未绑定不可充值」这条断言,**一直在一个业务逻辑永远不会产生的状态上量**。
 *
 * 店主的定性:这和 D190 是同一个病的两种长相 ——
 *   D190:**走了一扇生产上不存在的门**;
 *   这一条:**根本没走门,直接翻墙进了屋**。
 * **翻墙更隐蔽** —— 门至少还在那儿,能被人发现它不存在;翻墙连痕迹都没有,而且**永远不会红**。
 *
 * ══ 这把刀报三个数(J-48 底数闭合,不许混进一个数)══
 *   ① 总处数  ② 能改走正门的(欠账,只许降)  ③ 具名冻结的(正门产生不了的,逐条写理由)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const IDTBL = /^(users|user_identities|admin_accounts|identity_merge_queue)$/
const EXEC = /\.(prepare|exec)\(\s*[`'"]/
/* 判据自己排除:它们把这些 SQL 串当**探针/报文**写在源码里,不是真在执行(自扫这一族已踩过多次) */
const SELF = /test-tenant-explicit|test-demo-gate-coverage|test-fixture-front-door/
const files = [
  ...readdirSync(join(ROOT, 'apps/api')).filter((b) => /^test-.*\.mjs$/.test(b)).map((b) => `apps/api/${b}`),
  ...readdirSync(join(ROOT, 'tools')).filter((b) => b.endsWith('.mjs')).map((b) => `tools/${b}`),
].filter((f) => !SELF.test(f))

const hits = []
for (const f of files) {
  readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((ln, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return      /* 注释里提到不算(我自己的注释就写着这句) */
    if (!EXEC.test(ln)) return                      /* 要真的在执行 SQL,不是把它当字符串 */
    const m = ln.match(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/i)
    if (!m || !IDTBL.test(m[1])) return
    hits.push({ f, line: i + 1, tbl: m[1],
      frontDoorCan: /wechat_open_id/.test(ln) || /INSERT INTO users/i.test(ln) })
  })
}
const canConvert = hits.filter((h) => h.frontDoorCan)
const mustFreeze = hits.filter((h) => !h.frontDoorCan)

/* 欠账棘轮:**只许降**。归零那天 = 夹具全部走正门那天。 */
const CONVERT_DEBT_CAP = 32
check(`① 欠账棘轮:夹具直连库贴、而**正门产生得了**的 ${canConvert.length} 处 <= ${CONVERT_DEBT_CAP}(只许降)`
  + ' —— 归零那天就是「夹具不再翻墙」真做到那天',
canConvert.length <= CONVERT_DEBT_CAP, `${canConvert.length} 处 · ${new Set(canConvert.map((h) => h.f)).size} 个文件`)

/* 具名冻结(J-51):正门**产生不了**这个状态的,逐条写清为什么。**只许变短。** */
const FREEZE_CAP = 9
check(`② 具名冻结 ${mustFreeze.length} 处 <= ${FREEZE_CAP}(只许变短):`
  + '队列收尾/播种/造历史脏数据这一类 —— 正门产生不了「已经存在的脏行」,'
  + '这一格是 J-60 三款里那条明写的例外',
mustFreeze.length <= FREEZE_CAP, `${mustFreeze.length} 处`)

check(`③ 底数闭合(J-48,三个数分开):**总 ${hits.length} · 能改走正门 ${canConvert.length} · 具名冻结 ${mustFreeze.length}**`
  + ' —— 三个数加得起来,不许混成一个',
hits.length === canConvert.length + mustFreeze.length, `${hits.length} ≠ ${canConvert.length}+${mustFreeze.length}`)

/* ④ 自守:构造一行真的直连库贴,必须被咬到;注释里提到那一行不许被咬到 */
const probeReal = "      db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(a, b)"
const probeCmt = "   /* 原来那一步是 db.prepare('UPDATE users SET wechat_open_id') 直连库贴的 */"
const bite = (ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln) && EXEC.test(ln) && IDTBL.test((ln.match(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/i) || [])[1] || '')
check('④ 自守:**真的在执行**那一行必须被咬到;**注释里提到**那一行不许被咬到'
  + '(认执行不认提及 —— 否则这条律的说明文字自己会把判据顶红)',
bite(probeReal) && !bite(probeCmt), '')

check(`⑤ 反向守:扫描面 ${files.length} 个文件 >= 150;算成 0 说明口径瞎了(J-58)`,
  files.length >= 150 && hits.length > 0, `${files.length} 个文件 / ${hits.length} 处`)

console.log(`\n[J-60 底数] 总 ${hits.length} 处 · 能改走正门 ${canConvert.length} · 具名冻结 ${mustFreeze.length}`
  + ` · 涉 ${new Set(hits.map((h) => h.f)).size} 个文件`)
if (fails.length) { console.error(`\n❌ test-fixture-front-door ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-fixture-front-door 通过 ${checks} 项`)
