/* 造病台自守 —— **台子是判据的判据,而它自己一直没有判据守着。**
 *
 * 🔴 立此模块的案由(店主 07y §八):本批一次查出台子三处说谎,**没有一处是被人眼看出来的**:
 *   ① 按判据**名字**分类(`CLAIMS` 预过滤)→「该咬没咬 0」**连假两批**;
 *   ② `||` 把「文件找不到」吞成「自愈没成」→ mp 档自愈脚本**从 07n 装上那天起一次没跑过**,藏了四天;
 *   ③ fail-fast 套件**红起来不打 `not ok`** → 真红的断言被报成「红 0 · 没跑到 4」。
 *   第 ① 处被读集尺子推翻,第 ②③ 处被反面靶子咬出来 ——
 *   **台子的毛病只能被工具抓到,不能被复核抓到。**
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/* ── 自守一 · 分类闭合(J-66②:报数的人自己加一遍)──
 * 各格之和 ≠ 底数 → **台子自身报错**,不是打一行红字然后照常往下说结论。 */
export function assertClosure({ reds = 0, unrelated = 0, shouldBite = 0, unclear = 0, notRun = 0, base = 0 }) {
  const sum = reds + unrelated + shouldBite + unclear + notRun
  if (sum !== base) {
    throw new Error(`[台子自守一] 五格加不上底数:红 ${reds} + 无关 ${unrelated} + 该咬没咬 ${shouldBite}`
      + ` + 说不清 ${unclear} + 没跑到 ${notRun} = ${sum},底数 ${base}。`
      + ' J-66:加不上底数就不许往下说任何结论。')
  }
  return sum
}

/* ── 自守二 · 红必打标记(J-66④)──
 * 判了红却在报告里找不到那条的名字 → 台子自身报错。
 * 案底:fail-fast 套件红起来只在 stderr 出 `Error: <名>`,台子当时报的是「红 0」。 */
export function assertRedsNamed(reds, report) {
  const missing = reds.filter((r) => !String(report).includes(String(r).slice(0, 24)))
  if (missing.length) {
    throw new Error(`[台子自守二] 判了 ${reds.length} 条红,其中 ${missing.length} 条在报告里没有名字:`
      + missing.slice(0, 3).map((m) => String(m).slice(0, 40)).join(' | ')
      + ' —— 没有名字的红,和没有依据的 0 是同一类东西。')
  }
  return reds.length
}

/* ── 自守三 · 兜底不许把两种失败合成一种(J-65②)──
 * shell 里 `bash <脚本> || 提示` 这种写法,把「**脚本不存在**」和「**脚本跑了但失败**」
 * 说成了同一句话。判据:调外部脚本前**必须先判存在**(`[ -f ... ]` / `[ -x ... ]`)。
 * 白名单式(判据三):命中的每一行要么先判了存在,要么落进白名单并写理由。 */
export const MERGED_FALLBACK_ALLOW = [
  // { file, line, 理由 } —— 目前为空;要进白名单必须店主点头
]
/* 纯函数层:对一段 shell 文本判。**扫描器和它的 probe 必须共用同一个判定**,
 * 否则 probe 过了、扫描器还是瞎的(J-58⑤ 那个坑就是这么来的)。 */
export function checkShellText(text) {
  const lines = String(text).split('\n')
  const hits = []
  lines.forEach((ln, i) => {
    const m = /(?:^|[;&|]\s*)(?:bash|sh|source|\.)\s+("?\$?[\w/${}.\-]+\.(?:sh|mjs|command)"?)\s*\|\|/.exec(ln)
    if (!m) return
    const near = lines.slice(Math.max(0, i - 6), i).join('\n')
    const target = m[1].replace(/"/g, '')
    const key = target.replace(/^\$\{?|\}?$/g, '').split('/').pop().slice(0, 12)
    const guarded = /\[\s*-[fxe]\s/.test(near) && near.includes(key)
    if (!guarded) hits.push({ line: i + 1, text: ln.trim().slice(0, 110) })
  })
  return hits
}

export function scanMergedFallback(root) {
  const hits = []
  const walk = (dir, depth = 0) => {
    if (depth > 3) return
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue
      const p = join(dir, name)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walk(p, depth + 1); continue }
      if (!/\.(sh|command)$/.test(name)) continue
      for (const h of checkShellText(readFileSync(p, 'utf8'))) {
        hits.push({ file: p.replace(`${root}/`, ''), line: h.line, text: h.text })
      }
    }
  }
  walk(root)
  const allow = new Set(MERGED_FALLBACK_ALLOW.map((a) => `${a.file}:${a.line}`))
  return hits.filter((h) => !allow.has(`${h.file}:${h.line}`))
}


/* ── 自守四 · probe 两面(J-58⑥)── 清点全仓带 `--probe` 的刀 */
export function probeInventory(root) {
  const out = []
  const walk = (dir, depth = 0) => {
    if (depth > 2) return
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue
      const p = join(dir, name)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walk(p, depth + 1); continue }
      if (!/\.mjs$/.test(name)) continue
      const src = readFileSync(p, 'utf8')
      if (src.includes("'--probe'") || src.includes('"--probe"')) out.push(p.replace(`${root}/`, ''))
    }
  }
  walk(join(root, 'tools'))
  walk(join(root, 'apps/api'))
  return out.sort()
}

/* ── 自守模块自己的 probe(J-58⑤⑥:新刀先证咬得到,而且靶子要两面)── */
if (process.argv[1] && process.argv[1].endsWith('bench-selfguard.mjs') && process.argv.includes('--probe')) {
  const { probe } = await import('./scanner-probe.mjs')
  const okClose = (o) => { try { assertClosure(o); return false } catch { return true } }   // true = 咬住了(该报错)
  const okNamed = (o) => { try { assertRedsNamed(o.reds, o.report); return false } catch { return true } }
  let bad = 0
  const run = (name, cases, decide) => { if (!probe(name, cases, decide)) bad += 1 }
  run('自守一 · 分类闭合', [
    { 样本: { reds: 4, unrelated: 7, shouldBite: 2, unclear: 1, notRun: 0, base: 14 }, 该命中: false },
    { 样本: { reds: 4, unrelated: 3, shouldBite: 0, unclear: 0, notRun: 0, base: 14 }, 该命中: true },
  ], okClose)
  run('自守二 · 红必打标记', [
    { 样本: { reds: ['㋚6 签完另一入口变已签只读'], report: '红点名:㋚6 签完另一入口变已签只读 …' }, 该命中: false },
    { 样本: { reds: ['㋚6 签完另一入口变已签只读'], report: '[刀账] 红 1 · 无关 9' }, 该命中: true },
  ], okNamed)
  run('自守三 · 兜底不许合并两种失败', [
    { 样本: 'bash tools/mp-automator-up.sh || echo "自愈没成"', 该命中: true },
    { 样本: 'MP=x\nif [ ! -f "$MP" ]; then\n echo missing\nelse\n bash "$MP" || echo "自愈没成"\nfi', 该命中: false },
    { 样本: 'echo "bash foo.sh || 这是文案里提到的写法"', 该命中: false },
  ], (t) => checkShellText(t).length > 0)
  process.exit(bad ? 1 : 0)
}
