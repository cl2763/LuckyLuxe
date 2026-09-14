/* 06d §二 · **跑机脚本里不许出现无白名单的 `pkill` / `killall`**(店主 06d 裁,06i §三 排期)
 *
 * ══ 案由 ══
 * 我在夜班总结里自报过:「想写『不杀』,命令却在 `echo` 前面执行了」——
 * 结果**把微信开发者工具 pkill 掉了**,automator 断掉,三个套件报「未跑」,重开后才复跑回来。
 * 店主的话:「这件事的形状是 —— **一条本来只想被打印出来的命令,被执行了**。
 * 这次杀的是开发者工具(代价是三个套件重跑),下次可能杀到别的。」
 *
 * ══ 判法(白名单式)══
 * 扫 `tools/**` 与 `apps/api/*.sh` 里**真会执行**的 `pkill` / `killall`(注释不算),
 * 每一条必须落进下面的白名单,**逐条写理由**;新出现的一律红并点名 `file:line`。
 * 另加三条硬规矩,白名单也压不过:
 *   ① 必须带 `-f` 和一个**具体**的模式串,裸 `pkill node` 这种一律红;
 *   ② 模式串不许打到 **Claude / 编辑器 / 浏览器**(那是把工作台掀了);
 *   ③ 打**开发者工具**的,同一个脚本里必须**当场把它拉回来并验端口** ——
 *      「杀了不还」正是那次事故的形状。这一条是结构判据,不是口头承诺。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ── 扫描面:跑机脚本住的两处 ── */
const files = []
const walk = (rel) => {
  let ents = []
  try { ents = readdirSync(join(ROOT, rel)) } catch { return }
  for (const e of ents) {
    const r = `${rel}/${e}`
    let st
    try { st = statSync(join(ROOT, r)) } catch { continue }
    if (st.isDirectory()) walk(r)
    else if (/\.(sh|mjs|js)$/.test(e)) files.push(r)
  }
}
walk('tools')
for (const e of readdirSync(join(ROOT, 'apps/api'))) if (e.endsWith('.sh')) files.push(`apps/api/${e}`)

/* 白名单:**逐条写理由**,条数上棘轮。file 用后缀匹配,pat 是那条命令里的模式串。 */
const OK_KILLS = [
  { file: 'apps/api/run-all-tests.sh', pat: 'local-server.mjs',
    why: '回归自己起的那批服务;打完立刻 restore_local/restore_sandbox 拉回 4128 与 4310' },
  { file: 'apps/api/start-sandbox.sh', pat: 'PORT=4310',
    why: '起沙箱前先清同端口的旧进程;模式串具体到端口,且本脚本随后就把 4310 起回来' },
  { file: 'tools/sim/baseline_chain.sh', pat: 'wechatwebdevtools',
    why: '长链里的「开发者工具整只重启」步:先 quit、再 pkill、**当场 cli auto 拉回来并验 9420 端口**' },
]

const hits = []
for (const f of files) {
  let src = ''
  try { src = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
  src.split('\n').forEach((ln, i) => {
    /* 🔴 09-14 补一层(J-61:数的是**执行**,不是**提及**):
       现踩:`tools/mp-automator-up.sh` 里一句 `echo "…不用 pkill…"` 被当成「执行了 pkill」,①② 当场红。
       那句 echo 一个进程都不杀,**它说的恰恰是「这里不用 pkill」** ——
       判据认词不认执行,就会专门惩罚把话说清楚的那个人(同族:J-49 认标记不认措辞)。
       ⚠️ 第一版我是**把字符串整段剥掉**再判 —— 那更糟:`pkill -f "local-server.mjs"` 的
       **模式串本身就住在引号里**,剥完 ② 就报「模式串太泛」,把三条真护栏全判红了。
       所以改成**按位置**判:只有落在引号**外面**的 `pkill` 才算在执行。 */
    const code = ln.replace(/#.*$/, '')          /* shell 注释 */
      .replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const inQuote = (str, at) => {
      let q = null
      for (let k = 0; k < at; k += 1) {
        const c = str[k]
        if (q) { if (c === q && str[k - 1] !== '\\') q = null } else if (c === '"' || c === "'") q = c
      }
      return Boolean(q)
    }
    const execHit = [...code.matchAll(/\b(pkill|killall)\b/g)].some((m) => !inQuote(code, m.index))
    if (!execHit) return
    hits.push({ f, line: i + 1, text: ln.trim().slice(0, 90), code })
  })
}
check(`⓪ 扫描面自证:tools/** 与 apps/api/*.sh 共 ${files.length} 个脚本(少了说明扫描面缩水)`,
  files.length >= 30, String(files.length))

const outside = hits.filter((h) => !OK_KILLS.some((w) => h.f.endsWith(w.file) && h.code.includes(w.pat)))
check(`① 白名单式:现扫到 ${hits.length} 条会执行的 pkill/killall,每一条都在白名单里(新出现的自动红)`,
  outside.length === 0, outside.map((h) => `${h.f}:${h.line} ${h.text}`).join(' || '))

/* 「具体」不能只按长度算:`-f node` 是四个字符,却会把这台机器上**所有** node 打死
   (刀 NN 现测:它过了长度那一关,只被 ① 白名单拦住)。所以再列一张**太泛的模式**黑名单。 */
const TOO_BROAD = /^(node|sh|bash|python[0-9.]*|java|ruby|npm|npx|chrome|Chrome)$/
const patOf = (code) => (code.match(/-f\s*["']?([^\s"';|&]+)/) || [])[1] || ''
const noPattern = hits.filter((h) => { const p2 = patOf(h.code); return !p2 || p2.length < 4 || TOO_BROAD.test(p2) })
check('② 硬规矩:必须带 -f 和一个**具体**模式串;`-f node` 这种「太泛」的一律红(白名单也压不过)',
  noPattern.length === 0, noPattern.map((h) => `${h.f}:${h.line} 模式串「${patOf(h.code)}」太泛 —— ${h.text}`).join(' || '))

const FORBID = /(claude|Claude|Cursor|Code Helper|Google Chrome|Safari|iTerm|Terminal)/
const hitForbid = hits.filter((h) => FORBID.test(h.code))
check('③ 硬规矩:模式串不许打到 Claude / 编辑器 / 浏览器(那是把工作台掀了)',
  hitForbid.length === 0, hitForbid.map((h) => `${h.f}:${h.line} ${h.text}`).join(' || '))

/* ④ 杀开发者工具的,必须**当场还回来** —— 结构判据,不是口头承诺 */
const devKills = hits.filter((h) => /wechatwebdevtools/.test(h.code))
const devBad = devKills.filter((h) => {
  const src = readFileSync(join(ROOT, h.f), 'utf8')
  return !(/--auto-port\s+\d+/.test(src) && /lsof\s+-ti\s+tcp:\d+/.test(src))
})
check(`④ 杀开发者工具的 ${devKills.length} 条,同一脚本里都**当场拉回来并验了端口**(杀了不还正是那次事故的形状)`,
  devBad.length === 0, devBad.map((h) => `${h.f}:${h.line} 杀了却没看到 cli auto --auto-port + lsof 验端口`).join(' || '))

check(`⑤ 白名单只许 ${OK_KILLS.length} 条(棘轮:只减不增;要增先报店主)`, OK_KILLS.length <= 3, String(OK_KILLS.length))
/* ⑥ 反向守:白名单不许有**死条目** —— 那条命令都不在了,白名单还留着,说明它在替不存在的东西背书 */
const dead = OK_KILLS.filter((w) => !hits.some((h) => h.f.endsWith(w.file) && h.code.includes(w.pat)))
check('⑥ 反向守:白名单里没有死条目(命令已经不在了就该把条目删掉,不许替不存在的东西背书)',
  dead.length === 0, dead.map((w) => `${w.file} 里已经没有 ${w.pat} 那条了`).join(' || '))
check('⑦ 反向守:这把刀确实扫到了东西(一条都没扫到时「全在白名单里」也成立,那是空转)',
  hits.length > 0, `扫到 ${hits.length} 条`)

if (fails.length) { console.error(`\n❌ test-danger-cmd ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-danger-cmd 通过 ${n} 项(白名单 ${OK_KILLS.length} 条 · 现扫 ${hits.length} 条)`)
