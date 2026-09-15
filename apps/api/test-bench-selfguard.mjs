/* 造病台自守套件(店主 07y §八 令,四条)
 *
 * 🔴 立此套件的案由 —— **台子是判据的判据,而它自己一直没有判据守着。**
 * 07x 一批就查出台子三处说谎,**没有一处是被人眼看出来的**:
 *   ① 按判据**名字**分类 →「该咬没咬 0」连假两批(被读集尺子推翻);
 *   ② `||` 把「文件找不到」吞成「自愈没成」→ mp 档自愈脚本从 07n 起一次没跑过(被反面靶子咬出来);
 *   ③ fail-fast 套件红起来不打 `not ok` → 真红被报成「红 0 · 没跑到 4」(被反面靶子咬出来)。
 * **台子的毛病只能被工具抓到,不能被复核抓到** —— 所以给它装四条常驻自守。
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { assertClosure, assertRedsNamed, checkShellText, scanMergedFallback, probeInventory, MERGED_FALLBACK_ALLOW } from '../../tools/bench-selfguard.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
let n = 0
const fails = []
const check = (name, cond, detail = '') => {
  n += 1
  if (cond) console.log(`ok ${n} - ${name}`)
  else { console.log(`not ok ${n} - ${name} :: ${detail}`); fails.push(name) }
}

/* ══ 自守一 · 分类闭合(J-66②)══ 两面都断言:闭合的不许报错,不闭合的必须报错 ══ */
const closeOk = (() => { try { assertClosure({ reds: 4, unrelated: 7, shouldBite: 2, unclear: 1, notRun: 0, base: 14 }); return true } catch { return false } })()
check('①a 五格加得上底数时,台子放行(4+7+2+1+0 = 14)', closeOk)
const closeBad = (() => { try { assertClosure({ reds: 4, unrelated: 3, shouldBite: 0, unclear: 0, notRun: 0, base: 14 }); return false } catch (e) { return /加不上底数/.test(e.message) } })()
check('①b 🔴 反向守:加不上底数时台子**自身报错**(不是打一行红字然后照常往下说结论)', closeBad)
/* ①c:这一条守的正是 07v 那个形状 —— 4+3 = 7,而底数 14,**7 条一格都没落** */
const closeBadMsg = (() => { try { assertClosure({ reds: 4, unrelated: 3, shouldBite: 0, unclear: 0, notRun: 0, base: 14 }); return '' } catch (e) { return e.message } })()
check('①c 报错话里要把五个数和底数都点出来(看得见差在哪,才修得了)',
  /红 4/.test(closeBadMsg) && /底数 14/.test(closeBadMsg), closeBadMsg.slice(0, 120))

/* ══ 自守二 · 红必打标记(J-66④)══ */
const namedOk = (() => { try { assertRedsNamed(['㋚6 签完另一入口变已签只读'], '红点名:㋚6 签完另一入口变已签只读 …'); return true } catch { return false } })()
check('②a 红在报告里点了名 → 放行', namedOk)
const namedBad = (() => { try { assertRedsNamed(['㋚6 签完另一入口变已签只读'], '[刀账] 红 1 · 无关 9'); return false } catch (e) { return /没有名字/.test(e.message) } })()
check('②b 🔴 反向守:判了红而报告里只有数字没有名字 → **台子自身报错**('
  + '案底:fail-fast 套件红起来只在 stderr 出 `Error: <名>`,台子当时报的是「红 0」)', namedBad)

/* ══ 自守三 · 兜底不许把两种失败合成一种(J-65②)══ */
check('③a 🔴 旧写法必被咬中(`bash X.sh || echo …`,没先判存在)',
  checkShellText('bash tools/mp-automator-up.sh || echo "自愈没成"').length === 1)
check('③b 反向守:先判了存在的写法不咬(否则这条判据会把正确写法一起判红)',
  checkShellText('MP=x\nif [ ! -f "$MP" ]; then\n echo missing\nelse\n bash "$MP" || echo "没成"\nfi').length === 0)
check('③c 反向守:文案里**提到**这种写法不算(注释/字符串不是行为)',
  checkShellText('echo "bash foo.sh || 这是文案里提到的写法"').length === 0)
const merged = scanMergedFallback(ROOT)
check(`③d 🔴 全仓 .sh/.command 现扫:合并两种失败的兜底 **0 处**(现为 ${merged.length} 处)`,
  merged.length === 0, merged.slice(0, 3).map((h) => `${h.file}:${h.line} ${h.text}`).join(' | '))
check(`③e 白名单棘轮 ≤ 0(现为 ${MERGED_FALLBACK_ALLOW.length};只减不增,再进新成员要店主点头)`,
  MERGED_FALLBACK_ALLOW.length === 0)

/* ══ 自守四 · probe 两面(J-58⑥)══
 * **真跑**每一把带 `--probe` 的刀,要求它**打出两个数**且两面都非零。
 * 静态数关键字会漏掉手写形态的 probe(`knife-restore-scan` 就是),所以这一条验的是**跑出来的输出**。 */
const PROBE_SKIP = new Map([
  ['tools/scanner-probe.mjs', '它是 probe 的**共用出口**本身,不是一把刀 —— 跑它没有靶子可种'],
])
const probes = probeInventory(ROOT).filter((p) => !PROBE_SKIP.has(p))
check(`④a 全仓带 \`--probe\` 的刀 ${probes.length} 把(白名单跳过 ${PROBE_SKIP.size} 把,各有理由)`, probes.length >= 10, probes.join(' '))
let bothSided = 0
const oneSided = []
for (const rel of probes) {
  let out = ''
  let code = 0
  try { out = execFileSync(process.execPath, [join(ROOT, rel), '--probe'], { cwd: ROOT, encoding: 'utf8', timeout: 180e3, maxBuffer: 32e6 }) }
  catch (e) { code = 1; out = `${e.stdout || ''}${e.stderr || ''}` }
  const m = /该中 (\d+) 个 · 不该中 (\d+) 个/.exec(out)
  if (m && Number(m[1]) >= 1 && Number(m[2]) >= 1 && code === 0) bothSided += 1
  else oneSided.push(`${rel}(${m ? `该中 ${m[1]}/不该中 ${m[2]}` : '没打出两个数'}${code ? ' · 退出码非 0' : ''})`)
}
check(`④b 🔴 每把刀都**打出两个数**且两面非零 —— ${bothSided}/${probes.length}`,
  oneSided.length === 0, oneSided.slice(0, 4).join(' | '))
/* ④c:这一条守「判据本身的覆盖面」(判据三推论)—— 刀的把数只许涨不许缩 */
check(`④c 刀的把数 ≥ 11(现为 ${probes.length};缩水立刻红 —— 判据的覆盖面本身要有判据)`, probes.length >= 11)

console.log(`\n1..${n}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过:`); for (const f of fails) console.log(`   - ${f}`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${n} 条)`)
