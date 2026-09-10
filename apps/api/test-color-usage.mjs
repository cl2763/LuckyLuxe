/* 配色用法规矩(店主 06e §二)· 三条:主按钮 + 规矩甲 + 规矩乙
 *
 * 立件背景:合同图 v3.4 拍板之后,**值**已经由 `design-token-diff` 逐条焊死;
 * 这一套管的是**用法** —— 同样一个令牌,用在面上还是用在字上,差别是能不能看清。
 *   · 主按钮:金底不动、**字改深**(奶白压金 2.02:1 → 深字压金 5.26 / 9.39);
 *   · 规矩甲:浅色档 `--brand` 压白 2.88:1,**不许当正文字色**,当字要用 `--brandd`(4.73);
 *   · 规矩乙:`--done` / `--next` **只当色块,不当字色**(浅色 `--done` 压白 1.81)。
 *
 * 判据都从**令牌文件现读色值**再算比值 —— 不抄一份色值进判据(一件事一处真相)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ── 令牌现读:网页那份(light = :root 那块;dark = :root[data-theme="dark"] 那块)── */
const WEB = read('apps/web/design-tokens.css')
const blockOf = (src, head) => {
  const m = src.match(new RegExp(`(^|\\n)${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
  return m ? m[2] : ''
}
const tok = (block, name) => (block.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`)) || [])[1] || ''
const LIGHT = blockOf(WEB, ':root')
const DARK = blockOf(WEB, ':root\\[data-theme="dark"\\]') || (WEB.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/) || [])[1] || ''
const rgb = (h) => { const s = h.replace('#', ''); const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) }
const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const ratio = (a, b) => { const l1 = lum(rgb(a)); const l2 = lum(rgb(b))
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100 }

check('⓪ 令牌两块都读得到(读不到下面全是空转)', Boolean(LIGHT) && Boolean(DARK),
  `light=${LIGHT.length} dark=${DARK.length}`)

/* ═══ ① 主按钮:金底 + 深字 + 大字档 ═══ */
const CSS = read('apps/web/styles.css')
const primary = (CSS.match(/(^|\n)\.primary\s*\{([^}]*)\}/) || [])[2] || ''
check('① 网页主按钮:底走 --brand(合同图令牌),不走本仓自己那个 --accent',
  /background:\s*var\(--brand\)/.test(primary), primary.replace(/\s+/g, ' ').slice(0, 90))
/* 🔴 造病要「报得出是哪一处」,所以失败详情必须点到 **文件:行号** —— 不是把整条规则糊上去。
   店主 06f §二 指定的那个最像样的误改:把字色改成 --heroink(奶白),两档只剩 2.52 / 1.73。 */
const primaryAt = (() => {
  const lines = CSS.split('\n')
  const i = lines.findIndex((ln) => /^\.primary\s*\{/.test(ln))
  if (i < 0) return { line: 0, colorLine: 0, colorText: '' }
  for (let k = i; k < Math.min(i + 20, lines.length); k += 1) {
    if (/^\s*\}/.test(lines[k]) && k > i) break
    if (/(^|[^-a-zA-Z])color:/.test(lines[k])) return { line: i + 1, colorLine: k + 1, colorText: lines[k].trim() }
  }
  return { line: i + 1, colorLine: 0, colorText: '(这条规则里根本没写字色)' }
})()
check('①b 网页主按钮:**字是深的**(--hero),不再是奶白 --heroink',
  /color:\s*var\(--hero\)/.test(primary) && !/color:\s*var\(--heroink\)/.test(primary),
  `apps/web/styles.css:${primaryAt.colorLine} —— ${primaryAt.colorText}`)
const fs = Number((primary.match(/font-size:\s*([\d.]+)px/) || [])[1] || 0)
const fw = Number((primary.match(/font-weight:\s*(\d+)/) || [])[1] || 0)
check(`①c 网页主按钮进 WCAG 大字档(≥18.66px 且 ≥700):现测 ${fs}px / ${fw}`,
  fs >= 18.66 && fw >= 700, `${fs}px / ${fw}`)
const lightBtn = ratio(tok(LIGHT, 'hero'), tok(LIGHT, 'brand'))
const darkBtn = ratio(tok(DARK, 'hero'), tok(DARK, 'brand'))
check(`①d 主按钮两档都过大字门槛 3.0:浅 ${lightBtn}:1(--hero 压 --brand)· 深 ${darkBtn}:1`,
  lightBtn >= 3 && darkBtn >= 3, `浅 ${lightBtn} · 深 ${darkBtn}`)
check(`①e 反向守:原来那对(奶白 --heroink 压金)确实不达标 —— 证明这条判据在分好坏,不是见谁都放行`,
  ratio(tok(LIGHT, 'heroink'), tok(LIGHT, 'brand')) < 3,
  `原来那对 = ${ratio(tok(LIGHT, 'heroink'), tok(LIGHT, 'brand'))}:1`)
const MPAPP = read('miniprogram/app.wxss')
const mpBtn = (MPAPP.match(/\.btn-primary\s*\{([^}]*)\}/) || [])[1] || ''
check('①f 小程序主按钮同规矩(底 --brand · 字 --hero)',
  /background:\s*var\(--brand\)/.test(mpBtn) && /color:\s*var\(--hero\)/.test(mpBtn), mpBtn.replace(/\s+/g, ' ').slice(0, 80))

/* ═══ ② 规矩甲:浅色档 --brand 不许当正文字色 ═══ */
const FILES = ['apps/web/styles.css', 'apps/web/admin.html', 'apps/web/index.html', 'miniprogram/app.wxss']
const mpWxss = read('tools/../miniprogram/styles/tokens.wxss')   /* 令牌文件本身不算用法 */
const brandAsText = []
for (const f of FILES) {
  read(f).split('\n').forEach((ln, i) => {
    /* 只认**字色**用法:`color: var(--brand)`;`border-color` / `background` 不算 */
    if (/(^|[^-a-z])color:\s*var\(--brand\)/.test(ln)) brandAsText.push(`${f}:${i + 1}`)
  })
}
check(`② 规矩甲:全仓零处拿 --brand 当字色(浅档压白只有 ${ratio(tok(LIGHT, 'brand'), tok(LIGHT, 'card'))}:1;当字要用 --brandd ${ratio(tok(LIGHT, 'brandd'), tok(LIGHT, 'card'))}:1)`,
  brandAsText.length === 0, brandAsText.join(' · '))

/* ═══ ③ 规矩乙:--done / --next 只当色块 ═══ */
const blockOnly = []
for (const f of FILES) {
  read(f).split('\n').forEach((ln, i) => {
    if (/(^|[^-a-z])color:\s*var\(--(done|next)\)/.test(ln)) blockOnly.push(`${f}:${i + 1}`)
  })
}
check(`③ 规矩乙:--done / --next 零处当字色(浅档 --done 压白 ${ratio(tok(LIGHT, 'done'), tok(LIGHT, 'card'))}:1)`,
  blockOnly.length === 0, blockOnly.join(' · '))

/* ═══ ③b 组件那份令牌是 tokens.wxss 的镜像,不许两处各写一套 ═══
   (06e 现测:自定义组件 wxss 不许出现标签名选择器,所以给组件拆了一份只含 class 的;
    值必须逐字相同 —— 否则就是「一件事两处真相」,而令牌刀只比 tokens.wxss 那一份。) */
const TW = read('miniprogram/styles/tokens.wxss')
const TC = read('miniprogram/styles/tokens-component.wxss')
const declsOf = (src, head) => {
  const m = src.match(new RegExp(`^${head}\\{([^}]*)\\}`, 'm'))
  return m ? m[1].split(';').map((x) => x.trim()).filter((x) => x.startsWith('--')).sort().join(';') : ''
}
for (const [a, b, label] of [['page,\\.theme-root', '\\.theme-root', '基线(浅)'],
  ['\\.theme-dark', '\\.theme-dark', '站内深色'], ['\\.theme-light', '\\.theme-light', '站内浅色']]) {
  const x = declsOf(TW, a); const y = declsOf(TC, b)
  check(`③b 组件令牌镜像一致:${label}(${x.split(';').length} 条)`, Boolean(x) && x === y,
    x === y ? '' : `tokens.wxss 与 tokens-component.wxss 对不上`)
}
check('③c 组件那份**零标签选择器**(component wxss 不许有,现测开发者工具会告警)',
  !/^\s*page[,{\s]/m.test(TC), (TC.match(/^\s*page[,{\s].*/m) || [''])[0].slice(0, 60))

/* ═══ ④ 覆盖面自证:扫描面别缩水(判据的覆盖面本身要有判据)═══ */
const totalLines = FILES.reduce((s2, f) => s2 + read(f).split('\n').length, 0)
check('④ 扫描面自证:四个文件行数合计 ≥ 8000(文件被裁或路径写错立刻红)', totalLines >= 8000, String(totalLines))


/* ═══ ⑤ 归一:`--accent / --accent-dark` 从仓里消失(店主 06f §三 裁)═══
 *
 * 它坏在哪(店主现查):只在 styles.css 的 `:root` 里定义一次,**两个深色块里各 0 处** ——
 * 也就是**它压根没有深色档的值**,深色下是「浅色档的金压在新暖棕面上」,
 * `--accent-dark` 压深卡 3.81 而它主要当**字**用、全仓 76 处。
 * 裁法不是收编进合同图,是**归一**:当字的 → `--brandd`,当面/边框/描边的 → `--brand`,两个名字消失。
 *
 * 判据是**白名单形状**:不列举「我知道它在哪几个文件里」(黑名单必漏新来的),
 * 而是把**应用源码整片扫一遍**,`--accent` 必须一处都不剩;新写进任何一个文件都当场红并点名行号。
 * 扫描面自证在下面 ⑤c:文件数有下限,面缩水立刻红(判据的覆盖面本身要有判据)。
 *
 * 扫描面为什么是这三棵树:`apps/web` `miniprogram` `apps/api` = 会被浏览器/小程序真正加载的皮与代码。
 * **不含** `deliverables/`(那是印刷用的护理卡设计稿,自带一套跟门店皮无关的局部变量,而且没进 git)
 * 与 `handoff/`(文档里提到这个名字是**记录这次归一**,不是用法)。
 */
import { readdirSync, statSync } from 'node:fs'
const SKIP_DIR = new Set(['node_modules', '.git', 'local-data', 'sandbox-data', 'backups', 'miniprogram_npm'])
const CODE_EXT = /\.(css|wxss|html|wxml|js|mjs|json)$/i
const walk = (rel, out) => {
  let ents = []
  try { ents = readdirSync(join(ROOT, rel)) } catch { return out }
  for (const e of ents) {
    if (SKIP_DIR.has(e)) continue
    const r = `${rel}/${e}`
    let st
    try { st = statSync(join(ROOT, r)) } catch { continue }
    if (st.isDirectory()) walk(r, out)
    else if (CODE_EXT.test(e)) out.push(r)
  }
  return out
}
const SURFACE = []
const perTree = {}
for (const tree of ['apps/web', 'miniprogram', 'apps/api']) {
  const one = walk(tree, [])
  perTree[tree] = one.length
  SURFACE.push(...one)
}
/* 🔴 判据看代码不看注释(自己栽过两次:按字符串找 .theme-dark{ 和 @media,两次命中的都是抬头注释)。
   这里更要紧 —— 上面那段注释**正是在讲这次归一**,不把注释剥掉,判据会指着自己的墓志铭报红。
   剥三种:CSS/JS 的块注释、JS 的行注释(避开 https:// 那个双斜杠)、HTML/WXML 的 <!-- -->。 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, a) => a + ' '.repeat(m.length - a.length))
/* 只认**真形状**,不认「文里提到这个名字」:
     定义 = `--accent:` / `--accent-dark:`   使用 = `var(--accent)` / `var(--accent-dark)`
   所以判据文件里那句「不走本仓自己那个 --accent」这类叙述不会误伤,而真塞回一处当场红。
   `accent-color:` 是 CSS 自己的属性名(勾选框主题色),先剔掉再判。 */
const ACCENT_REAL = /(^|[^-a-zA-Z])--accent(-dark)?\s*:|var\(\s*--accent(-dark)?\s*\)/
const accentHits = []
for (const f of SURFACE) {
  let src = ''
  try { src = read(f) } catch { continue }
  if (!src.includes('--accent')) continue
  stripComments(src).split('\n').forEach((ln, i) => {
    const hit = ln.replace(/accent-color\s*:/g, ' ')
    if (ACCENT_REAL.test(hit)) accentHits.push(`${f}:${i + 1} ${ln.trim().slice(0, 70)}`)
  })
}
check(`⑤ 归一:应用源码里 --accent / --accent-dark **定义 0 处、使用 0 处**(扫了 ${SURFACE.length} 个文件)`,
  accentHits.length === 0, accentHits.slice(0, 6).join(' || '))
check('⑤b 反向守:归一的去处确实更好 —— --brandd 当字两档都比原来那个 --accent-dark 强',
  ratio(tok(DARK, 'brandd'), tok(DARK, 'card')) > 4.5 && ratio(tok(LIGHT, 'brandd'), tok(LIGHT, 'card')) > 4.5,
  `深 ${ratio(tok(DARK, 'brandd'), tok(DARK, 'card'))}:1 · 浅 ${ratio(tok(LIGHT, 'brandd'), tok(LIGHT, 'card'))}:1`)
/* 覆盖面自证要**按棵树**报,不报一个笼统总数:一棵树整个从扫描面上掉了(路径写错、目录改名),
   总数还能靠另外两棵撑住而判据照样绿 —— 那就是「判据的覆盖面本身没有判据」。 */
const TREE_FLOOR = { 'apps/web': 40, miniprogram: 280, 'apps/api': 200 }
for (const [tree, floor] of Object.entries(TREE_FLOOR)) {
  check(`⑤c 扫描面自证:${tree} 下的代码文件 ≥ ${floor} 个 · 现测 ${perTree[tree]}`,
    perTree[tree] >= floor, `${perTree[tree]} < ${floor}`)
}

/* ═══ ⑥ 规矩丙:**金底上的字一律 --hero**(白名单式)═══
 *
 * 从 06f 归一里长出来的:主按钮原来那个 2.02 不是孤例 —— 客服筛选胶囊、财务导航按钮、
 * 购物车勾选圈 三处是**同一族**(金底 + 奶白字)。所以不逐处修,立成规矩并机械守住。
 *
 * 判法:把两端所有样式文件里**画金底**的规则抠出来,每一条必须落进两个筐之一 ——
 *   ① 它自己写了 `color: var(--hero)`;
 *   ② 它在下面这张**没有字的色块**白名单里(逐条写理由,条数上棘轮)。
 * 新写一条金底规则,默认落不进任何一筐 → 当场红。
 */
const NO_TEXT_OK = [
  ['.growth-fill', '会员成长进度条的填充,条里没有字'],
  ['.finance-progress-fill', '财务目标进度条的填充,条里没有字'],
  ['.tier-benefit-list li::before', '权益列表前面那颗小圆点,是装饰不是字'],
  ['.primary:hover', '悬停态只换底,字色继承自 .primary 那条(那条已经是 --hero)'],
]
const styleFiles = SURFACE.filter((f) => /\.(css|wxss)$/i.test(f) && !/design-tokens\.css$|tokens\.wxss$|tokens-component\.wxss$/.test(f))
const goldRules = []
for (const f of styleFiles) {
  /* 🔴 刀 ZZ/WW 现测抓到的判据缺陷:这里原来把块注释**整段删掉**,换行也一并删了 ——
     于是 ⑥ 报出来的行号比真的位置**早几十行**(.primary 真在 1857,它报 1812)。
     「报得出是哪一处」是造病的验收条件之一,报错地方等于没报。改成剥内容、留换行。 */
  const src = stripComments(read(f))
  const re = /([^{}]*)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(src)) !== null) {
    const body = m[2]
    if (!/background(-color)?:\s*var\(--brandd?\)/.test(body)) continue
    const sel = m[1].split('\n').filter(Boolean).pop().trim()
    /* 行号要落在**选择器那一行**上:m.index 指的是「上一条规则的 } 之后」,
       中间那一大段(空行 + 被剥空的注释)全算进去,报出来会比真位置早几十行 —— 刀 WW 现测过。 */
    const at = src.slice(0, m.index + Math.max(0, m[1].lastIndexOf(sel))).split('\n').length
    goldRules.push({ f, sel, body, at, hasHero: /(^|[^-a-zA-Z])color:\s*var\(--hero\)/.test(body) })
  }
}
const goldBad = goldRules.filter((r) => !r.hasHero && !NO_TEXT_OK.some(([s2]) => r.sel === s2))
check(`⑥ 规矩丙:${goldRules.length} 条画金底的规则,每条要么自己写 color: var(--hero),要么在「没有字的色块」白名单里`,
  goldRules.length > 0 && goldBad.length === 0,
  goldBad.map((r) => `${r.f}:${r.at} ${r.sel}`).join(' || '))
check(`⑥b 白名单只许 ${NO_TEXT_OK.length} 条(棘轮:再加要写理由并让店主看见)`, NO_TEXT_OK.length <= 4, String(NO_TEXT_OK.length))
check(`⑥c 反向守:金底上如果用奶白 --heroink,两档分别只有 ${ratio(tok(LIGHT, 'heroink'), tok(LIGHT, 'brand'))} / ${ratio(tok(DARK, 'heroink'), tok(DARK, 'brand'))} —— 证明这条规矩在分好坏`,
  ratio(tok(LIGHT, 'heroink'), tok(LIGHT, 'brand')) < 3 && ratio(tok(DARK, 'heroink'), tok(DARK, 'brand')) < 3,
  `${ratio(tok(LIGHT, 'heroink'), tok(LIGHT, 'brand'))} / ${ratio(tok(DARK, 'heroink'), tok(DARK, 'brand'))}`)

/* ═══ ⑦ 判据自己也守规矩:**锚规矩,不锚数字**(店主 06f §二 第二件)═══
 *
 * 「主按钮 = --brand 底 + --hero 字」是规矩,会一直成立;「等于 9.39」是数字,
 * 合同图一改就过期,而过期的判据要么误报要么被人顺手改小 —— 两种都是废判据。
 * 所以本文件里**不许出现任何调色板色值字面量**:所有比值都从令牌文件现读现算(见开头 tok()/ratio())。
 * WCAG 的 3.0 / 4.5 不在此列 —— 那是**标准**里的门槛,不是我们的色值。
 */
const SELF = read('apps/api/test-color-usage.mjs')
const hexInSelf = SELF.split('\n')
  .map((ln, i) => [i + 1, ln])
  .filter(([, ln]) => /#[0-9a-fA-F]{3,8}\b/.test(ln))
  .map(([i, ln]) => `${i}: ${ln.trim().slice(0, 50)}`)
check('⑦ 判据锚规矩不锚数字:本判据文件里零个调色板色值字面量(比值一律从令牌文件现读现算)',
  hexInSelf.length === 0, hexInSelf.join(' || '))

console.log(`\n[配色用法] 主按钮 浅 ${lightBtn}:1 / 深 ${darkBtn}:1 · --brand 当字色 ${brandAsText.length} 处 · --done/--next 当字色 ${blockOnly.length} 处`)
if (fails.length) { console.error(`\n❌ test-color-usage ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-color-usage 通过 ${n} 项`)
