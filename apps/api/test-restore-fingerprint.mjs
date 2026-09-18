/* 「还回去了」必须验版本指纹,不只验 200(店主 09p §五② 批,立为常驻)
 *
 * 案底:09p 批为了做推前/推后对照,在 `285b20d` 的工作树里跑了一次那一版的回归。
 * 那一版的 `restore_local` / `restore_sandbox` **从它自己那棵树**把 4128 / 4310 拉起来 ——
 * 跑完两个端口都答 200、屏幕写着「已把店主的本地服务重新拉起来」,
 * **而里面跑的是三周前的 `local-server.mjs`**(`lsof` 现证 cwd 在那棵临时工作树里)。
 * 店主这时候打开后台,看到的是一个三周前的 app,**没有任何东西会告诉她**。
 *
 * 归族:**J-74 的服务版** —— 字面对(200),印象错(以为是新代码)。
 * 老条款只管「活没活」,不管「是不是这一版」。
 *
 * 三层:
 *   ① 出口在:`tools/verify-restored.sh` 存在且可执行(唯一出口,不许每处各写一套);
 *   ② 接上了:`run-all-tests.sh` 的两条还原路径真的调它(写了不接 = 09h 那次栽的同一个坑);
 *   ③ 真能分辨:起两台**假服务**,一台答新版形状、一台答旧版形状,**必须一绿一红**。
 *      ③才是这把刀的本体 —— ①②只证明「装上了」,③证明「它分得出来」。
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'

/* 🔴 必须 `resolve`:`join(..., '../..')` 留着 `/apps/api/../..` 这种没规约的形状,
   而 `startsWith` 是按字符串比的 —— ③a 第一次就是这么红的(刀红在自己身上,不是产品上)。 */
const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '../..'))
let n = 0
const fails = []
const check = (name, cond, detail = '') => {
  n += 1
  if (cond) console.log(`ok ${n} - ${name}`)
  else { console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`); fails.push(name) }
}

/* ── ① 出口在 ────────────────────────────────────────────────── */
const SH = join(ROOT, 'tools/verify-restored.sh')
check('①a 唯一出口 `tools/verify-restored.sh` 在', existsSync(SH))
check('①b 它是可执行的(不可执行 = 接上去也跑不动,而 `|| true` 会把这件事吞掉)',
  existsSync(SH) && Boolean(statSync(SH).mode & 0o111), existsSync(SH) ? `mode=${(statSync(SH).mode & 0o777).toString(8)}` : '文件不在')

/* ── ② 接上了 ──────────────────────────────────────────────────
 * 🔴 只数「提到几次」不算(J-61①:数执行不数提及)—— 要求它出现在 `restore_local`
 * 与 `restore_sandbox` **两个函数体之内**。 */
const runner = readFileSync(join(ROOT, 'apps/api/run-all-tests.sh'), 'utf8')
const bodyOf = (fn) => {
  const i = runner.indexOf(`${fn}() {`)
  if (i < 0) return ''
  const j = runner.indexOf('\n}', i)
  return j < 0 ? runner.slice(i) : runner.slice(i, j)
}
for (const fn of ['restore_local', 'restore_sandbox']) {
  const body = bodyOf(fn)
  check(`②${fn === 'restore_local' ? 'a' : 'b'} \`${fn}\` 函数体里调了 verify-restored.sh`,
    /verify-restored\.sh/.test(body), body ? '函数体里没有' : `找不到 ${fn} 这个函数`)
}
check('②c 反向守:这把尺子不是在整份文件里瞎搜 —— 随便给个不存在的函数名必须取到空函数体',
  bodyOf('restore_nothing_at_all') === '')

/* ── ③ 真能分辨(本体)────────────────────────────────────────── */
const serve = (payload, port) => new Promise((resolve) => {
  const s = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  })
  s.listen(port, '127.0.0.1', () => resolve(s))
})
/* 🔴 必须是**异步**的:假服务跟判据跑在同一个进程里,
   用 `execFileSync` 会把事件循环堵死 —— 服务答不了话,于是每一条都红成「没有应答」,
   而红的原因跟被测的那件事毫无关系。**刀红在自己身上,第二次。**
   (同族:判据里的静默失败器 —— 全红也叫「通过」,因为该绿的那条也红了。) */
const runVerify = (port, root) => new Promise((res) => {
  execFile('bash', [SH, String(port), root], { encoding: 'utf8' }, (err) => res(err ? (err.code ?? 1) : 0))
})

const GOOD_PORT = 4147
const OLD_PORT = 4148
const goodSrv = await serve({ ok: true, service: 'lucky-luxe-api-local', dataFile: `${ROOT}/apps/api/local-data/lucky-luxe.sqlite` }, GOOD_PORT)
/* 旧版形状:**照抄 285b20d 那一版 /health 的真实字段集**(09p 现测过的那一份),关键是**没有 dataFile** */
const oldSrv = await serve({ ok: true, service: 'lucky-luxe-api-local', commit: 'local', snapshotRaster: 'qlmanage', dataScope: 'live', time: '2026-09-18T10:01:53.803Z' }, OLD_PORT)

check('③a ✅ 还对了要绿:新版形状 + 库在期望的树里 → 退出码 0', (await runVerify(GOOD_PORT, ROOT)) === 0)
const oldCode = await runVerify(OLD_PORT, ROOT)
check('③b 🔴 还成三周前那份要红:旧版形状(没有 dataFile)→ 退出码 1', oldCode === 1, `实际退出码 ${oldCode}`)
check('③c 🔴 同一版代码、跑在**另一棵树**上也要红(这一条才认「哪一份代码」)',
  (await runVerify(GOOD_PORT, '/private/tmp/some-other-worktree')) === 1)
check('③d 🔴 没人应答的端口要红(不许把「连不上」当成「还对了」)',
  (await runVerify(4149, ROOT)) === 1)
/* ③e:**证明红是那两个原因红的,不是随便什么都红** —— 否则这把刀全红也「通过」 */
check('③e 反向守:上面那台好服务换个写法(路径带结尾斜杠)照样绿,不许无差别判红',
  (await runVerify(GOOD_PORT, `${ROOT}/`)) === 0)

goodSrv.close(); oldSrv.close()

console.log(`\n1..${n}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过:${fails.join(' / ')}`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${n} 条)`)
