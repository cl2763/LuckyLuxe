/* D188 ②③ · 令牌引用的**静态判据 + 统一入口的行为判据**(店主 06b §三 立,06h §六 排期)
 *
 * 病是这么来的:05z 把 `styles.css` 整个令牌化,而 `index.html` / `share.html` /
 * `wechat-simulator.html` **从来没引过** `design-tokens.css` —— 所有 `var()` 解析成空,
 * 底色透明、字色纯黑,**整页塌掉**;而当时那把对比度刀只扫后台,照样全绿(J-37)。
 * 店主的裁定:病根不是「那三页忘了」,是**「忘得掉」这件事本身**。
 *
 * 所以这一套守三层:
 *   ① **每一页自带那一行**(显式是真相);
 *   ② **统一入口是行为判据** —— 真造一个漏引的页面喂给 `serveFile`,看发出去的字节里有没有被补上;
 *   ③ **两份文件不许定义同名令牌** —— 这条替代了 06c 原话里的「顺序在前」,理由写在下面。
 *
 * ⚠️ 为什么不立「顺序在前」:现查仓里两种顺序都有,`admin.html` **特意**把令牌排在
 * `styles.css` 之后(页首写着「令牌是唯一真相,谁在后面谁说了算」),另外三页排在前面。
 * 照字面立会把旗舰页判红。顺序只在「两个文件定义了同名令牌」时才决定胜负 ——
 * 所以改守那一条更硬的:**名字不许撞车**,撞不上车,顺序怎么排都对。
 * 结果那一层另有运行判据(`tools/token-runtime-probe.mjs` 现取 `--paper` 不许为空)兜底。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { statSync } from 'node:fs'
import { createStaticServe } from './static-serve.mjs'
import { ensureTokenLink, hasTokenLink } from './web-head.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const WEB = join(ROOT, 'apps/web')
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ── 全仓 html 现扫(D188 ④:演示页 / 打印页 / 分享页 / 平台后台,一个都不许漏)── */
const pages = readdirSync(WEB).filter((f) => extname(f) === '.html').sort()
check(`④ 覆盖面自证:apps/web 下现扫到 ${pages.length} 个 html(≥ 6;少了说明有页被删或路径写错)`,
  pages.length >= 6, pages.join(' '))

const missing = []
const usesStyles = []
for (const f of pages) {
  const src = readFileSync(join(WEB, f), 'utf8')
  const styles = /<link[^>]+href\s*=\s*["'][^"']*\/styles\.css/i.test(src)
  if (styles) usesStyles.push(f)
  if (!hasTokenLink(src)) missing.push(f)
}
check(`① 每一页都自带 design-tokens.css 那一行(现扫 ${pages.length} 页,引了 styles.css 的 ${usesStyles.length} 页)`,
  missing.length === 0, `没引的:${missing.join(' / ')}`)

/* ── ② 统一入口:**行为判据**,不是「文件里有没有这几个字」 ──
   造一个真的漏引页面,走 `serveFile` 发一遍,看发出去的字节里有没有被补上。
   （文本判据在这里不够:import 写着、却没在发 HTML 那条路上调用,判据照样绿。） */
const served = []
const fakeRes = {
  writeHead() {},
  end(body) { served.push(String(body)) },
}
const { serveFile } = createStaticServe({ existsSync, statSync, readFileSync, join, normalize, extname })
const TMP = join(WEB, '_d188-probe.html')
try {
  const { writeFileSync, unlinkSync } = await import('node:fs')
  writeFileSync(TMP, '<!DOCTYPE html><html><head><title>d188</title>'
    + '<link rel="stylesheet" href="/web/styles.css"></head><body>x</body></html>', 'utf8')
  serveFile(fakeRes, WEB, '_d188-probe.html')
  unlinkSync(TMP)
} catch (e) {
  try { const { unlinkSync } = await import('node:fs'); unlinkSync(TMP) } catch { /* 尽力收摊 */ }
  check('② 统一入口行为判据跑成了', false, e.message)
}
check('② 统一入口是**真挂着**的:造一个漏引令牌的页面走 serveFile,发出去的字节里被补上了',
  served.length === 1 && hasTokenLink(served[0]),
  served.length ? served[0].slice(0, 100) : '一个字节都没发出来')

/* ② 的反向守:已经引了就不许重复注入(否则同一页两行 link,又是一处"多说一遍") */
const already = readFileSync(join(WEB, 'index.html'), 'utf8')
check('②b 反向守:已经自带那一行的页面,入口一个字都不改(不重复注入)',
  ensureTokenLink(already, { file: 'index.html' }).injected === false)
check('②c 反向守:不是完整 HTML 文档的片段,入口不碰它',
  ensureTokenLink('<div>只是个片段</div>', { file: 'frag' }).injected === false)

/* ── ③ 两份文件不许定义同名令牌(替代「顺序在前」)── */
const declsOf = (src) => {
  const names = new Set()
  /* 只看**真的定义**(`--x:` 出现在某个 `{}` 块里),不看 `var(--x)` 那种引用 */
  for (const block of src.replace(/\/\*[\s\S]*?\*\//g, ' ').match(/\{[^{}]*\}/g) || []) {
    for (const m of block.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gi)) names.add(m[2])
  }
  return names
}
const TOK = declsOf(readFileSync(join(WEB, 'design-tokens.css'), 'utf8'))
const CSS = declsOf(readFileSync(join(WEB, 'styles.css'), 'utf8'))
/* 🔴 06i 裁 #41 · J-44「判据的覆盖面要跟着被改动的范围走」:
   上一版这条只比**两份 css 文件**,而**撞车真的发生在第三层** —— 页面自带的 `<style>` 里。
   现测过:platform / sign 各自的 `:root` 定义了 `--ink` / `--paper` / `--line`,
   而那段 `<style>` 排在 `<link design-tokens.css>` 之后 → **页面自己的值赢了**,
   值又很接近(肉眼和图都看不出来),于是「两页接令牌」其实只接上了金。
   所以扫描面扩到「**同一个页面会同时加载的所有样式来源**」:令牌文件 + styles.css + 每一页的内联 <style>。 */
const sourceOf = (file) => {
  const src = readFileSync(join(WEB, file), 'utf8')
  if (!/\.html$/i.test(file)) return src
  return (src.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n')
}
const SOURCES = [['styles.css', CSS], ...pages.map((f) => [f, declsOf(sourceOf(f))])]
const clashRows = []
for (const [name, set] of SOURCES) {
  for (const x of set) if (TOK.has(x)) clashRows.push({ name, tok: x })
}
/* 点名到 file:line —— 「报得出是哪一处」是造病的验收条件 */
const lineOfDecl = (file, tok2) => {
  const lines = readFileSync(join(WEB, file), 'utf8').split('\n')
  const i = lines.findIndex((ln) => new RegExp(`(^|[;{\\s])${tok2}\\s*:`).test(ln) && /\{/.test(ln + lines.slice(0, 1)))
  const j = i >= 0 ? i : lines.findIndex((ln) => new RegExp(`(^|[;{\\s])${tok2}\\s*:`).test(ln))
  return j >= 0 ? j + 1 : 0
}
check(`③ 令牌文件(${TOK.size} 个)与**页面会同时加载的所有样式来源**(styles.css + ${pages.length} 个页面的内联 style)零同名定义`,
  clashRows.length === 0,
  clashRows.map((c) => `apps/web/${c.name}:${lineOfDecl(c.name, c.tok)} 重定义了令牌 ${c.tok}`).join(' || '))
check(`③c 覆盖面自证:这一条现在比的是 **${SOURCES.length} 个来源**(1 份 css + ${pages.length} 个页面内联);少一个说明扫描面缩水了`,
  SOURCES.length >= 7, String(SOURCES.length))
check('③d 反向守:**非令牌名不许被误咬** —— 两页自带的 --soft / --muted 这些不在合同图里,不算撞车',
  !TOK.has('--soft') && !TOK.has('--muted')
  && SOURCES.some(([, set]) => set.has('--soft') || set.has('--muted')),
  '要么令牌文件里冒出了同名,要么页面里那几个局部名没了')
check('③b 反向守:这两份文件确实都读到了东西(空集上「零撞车」也成立,那是空转)',
  TOK.size > 20 && CSS.size > 0, `令牌 ${TOK.size} · styles ${CSS.size}`)

if (fails.length) { console.error(`\n❌ test-token-entry ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-token-entry 通过 ${n} 项`)
