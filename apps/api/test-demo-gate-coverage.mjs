#!/usr/bin/env node
/* 「**所有判据至少跑一遍演示门关掉的环境**」(店主 07g/夜10 段一①,2026-09-12)
 *
 * ══ 案由(D190,最贵的一课)══
 * 本机与沙箱都开着 `ALLOW_DEMO_ADMIN_LOGIN=true`,于是**所有顾客端判据都站在一扇
 * 生产上不存在的门后面测** —— 全绿,而生产上顾客一条能用的登录路都没有。
 * 绿得毫无道理:不是代码对,是**判据从来没在那个环境里跑过**。
 *
 * ══ 这把刀守什么 ══
 * 守「**那一档有没有真跑**」,不是守「那一档绿不绿」——
 * 那一档现在就会红一片,**红是真相**,不许为了绿去松门槛(店主令里写死)。
 *
 * 两层:
 *   ① **静态**:回归脚本必须声明 `DEMO_GATE_MODES` 含 `false`,且顾客端清单非空、只许变长;
 *   ② **运行时**:回归跑完会写下它**实际跑过哪几档**;两档都在才算数。
 *      (只验声明 = 验中间产物;只验运行时 = 没跑过的时候看不出是漏了还是没跑。两层都要。)
 */
import { readFileSync, existsSync } from 'node:fs'
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

const runner = readFileSync(join(ROOT, 'apps/api/run-all-tests.sh'), 'utf8')
const modes = (runner.match(/DEMO_GATE_MODES="\$\{DEMO_GATE_MODES:-([^"}]+)\}"/) || [])[1] || ''
const suites = ((runner.match(/DEMO_GATE_SUITES="([^"]+)"/) || [])[1] || '').trim().split(/\s+/).filter(Boolean)
const SUITE_MIN = 8   /* 只许变长(判据三推论:覆盖面本身要有判据) */

check('① 回归脚本声明了**演示门关掉**那一档(`DEMO_GATE_MODES` 里有 `false`)—— '
  + '去掉它就是「少跑了一档」,这一条当场红',
/\bfalse\b/.test(modes), `现读 DEMO_GATE_MODES="${modes}"`)

check(`② 那一档要跑的顾客端判据清单 ${suites.length} 条 >= ${SUITE_MIN}(**只许变长**):`
  + `${suites.slice(0, 4).join(' ')}…`,
suites.length >= SUITE_MIN, suites.join(' '))

check('③ 那一档起的是**不设 `ALLOW_DEMO_ADMIN_LOGIN`** 的实例,并且**当场自证门真关着**'
  + '(读它自己的 `/health` 的 `guestIdUnsigned`,不是靠「我以为我没设」)',
  /env -u ALLOW_DEMO_ADMIN_LOGIN/.test(runner) && /guestIdUnsigned/.test(runner)
  && /这一档白跑了/.test(runner), '')

check('④ 那一档的红**单独列、不并进主档** —— 它现在就会红一片,那是真相,'
  + '不许为了绿去松门槛(店主令里写死的那句写在脚本注释里)',
  /不许为了绿去松门槛|不许为了让它变绿/.test(runner) && /门关档小结/.test(runner), '')

/* ⑤ 运行时那一半**不住在这里** —— 记下为什么(我造过一次死锁):
   这支套件跑在**主档**里,而写「实际跑过哪几档」那份记录的是**门关那一档**,它排在主档之后。
   把运行时断言放在这里 ⇒ 第一轮必红 ⇒ 套件退 1 ⇒ 回归中止 ⇒ 门关那一档**永远跑不到** ⇒
   记录永远不会有 —— **自己把自己锁死了**。
   正确落点是回归**收尾自证**(两档都跑完之后),与「4128/4310 还回去了没有」同一处。
   见 `apps/api/run-all-tests.sh` 末尾「[收尾自证] 演示门那两档」那一段。
   这支套件只守**声明**那一层:少声明一档,①当场红。 */

/* ⑥ 自守:把 false 从声明里拿掉,必须被 ① 咬到 */
const probe = 'DEMO_GATE_MODES="${DEMO_GATE_MODES:-true}"'
const probeModes = (probe.match(/DEMO_GATE_MODES="\$\{DEMO_GATE_MODES:-([^"}]+)\}"/) || [])[1] || ''
check('⑥ 自守:构造一份「只剩 true」的声明,①那条**必须**认出它少了一档',
  !/\bfalse\b/.test(probeModes), `probe="${probeModes}"`)

console.log(`\n[底数闭合] 声明的档 [${modes}] · 那一档要跑的顾客端判据 ${suites.length} 条`
  + ' · 运行时那一半在回归收尾自证里(见本文件 ⑤ 那段注释)')
if (fails.length) { console.error(`\n❌ test-demo-gate-coverage ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-demo-gate-coverage 通过 ${checks} 项`)
