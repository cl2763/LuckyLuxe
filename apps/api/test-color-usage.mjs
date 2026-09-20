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
import { execFileSync } from 'node:child_process'
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
const CODE_EXT = /\.(css|wxss|html|wxml|js|mjs|json|svg)$/i
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
const TREE_FLOOR = { 'apps/web': 40, miniprogram: 290, 'apps/api': 200 }
for (const [tree, floor] of Object.entries(TREE_FLOOR)) {
  check(`⑤c 扫描面自证:${tree} 下的代码文件 ≥ ${floor} 个 · 现测 ${perTree[tree]}`,
    perTree[tree] >= floor, `${perTree[tree]} < ${floor}`)
}

/* ═══ ⑤d **归一的判据锚值,不锚名**(店主 06g §〇 立 J-40)═══
 *
 * 立律的由来是店主自己记的一笔:06f 里她把归一的判据写成
 * 「`--accent` / `--accent-dark` 这两个**名字**不许再出现」—— **改个名字就能过关**。
 * 我照做之后在回执里写了一句「本批只做到名字消失,值还活着;只换字面量写法等于把第二套真相搬个家」,
 * 她据此把判据翻面:**扫被淘汰的那个色值本身,名字只是它今天的马甲。**
 * 同族条款:`#c8a47e` 与 `rgba(200,164,126,…)` 是同一个真相的两种写法,**要一起认**。
 *
 * 形状:硬零 + 白名单;但**存量太大,本批不清零** —— 按店主指定,
 * 把当前实测条数设成**棘轮初值**(照「小程序 wxss 写死色棘轮」那把的写法),以后**只许降**。
 * 白名单目前是空的:21 个 SVG 图标那件事是**待裁**,不是**永久豁免**,所以不许先塞进白名单充数。
 */
const LEGACY_GOLD = { c8a47e: [200, 164, 126], '9b7655': [155, 118, 85], b5885d: [181, 136, 93] }
const GOLD_PAT = new RegExp([
  `#(?:${Object.keys(LEGACY_GOLD).join('|')})\\b`,
  ...Object.values(LEGACY_GOLD).map(([r, g, b]) => `rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*(?:,[^)]*)?\\)`),
].join('|'), 'ig')
/* 白名单:**逐条写理由**,条数上棘轮。空着不是忘了写 —— 是现在一条都不该有。 */
const GOLD_OK = []
const goldHits = []
/* 🔴 判据文件自己要**点名**这三个值(锚值判据不点名就没法扫),所以把它排除在被扫面之外。
   会不会有人把真用法藏进判据文件?——它是测试件,不进任何页面;而且下面 ⑦ 仍然盯着这个文件里
   **除这三个死值以外**的任何色值字面量。两条合起来没留缝。 */
const GOLD_SELF = 'apps/api/test-color-usage.mjs'
for (const f of SURFACE) {
  if (f.endsWith(GOLD_SELF) || GOLD_SELF.endsWith(f)) continue
  let src = ''
  try { src = read(f) } catch { continue }
  if (!GOLD_PAT.test(src)) { GOLD_PAT.lastIndex = 0; continue }
  GOLD_PAT.lastIndex = 0
  /* 🔴 06h 现测出来的判据缺陷:这里原来扫的是**原文**,注释里提一句旧色值也被算成一处 ——
     而 ⑤(扫名字)那条早就剥了注释。**同一个文件里两条判据,一条看代码一条看注释**,
     数当然对不上(现测差 1:我在 customer-tags.js 里写了一句「原来是 #b5885d」的说明,棘轮就多了 1)。
     归族「判据看代码不看注释」。剥完重量 → 棘轮跟着往下收。 */
  stripComments(src).split('\n').forEach((ln, i) => {
    const m = ln.match(GOLD_PAT)
    if (m) for (const one of m) goldHits.push({ at: `${f}:${i + 1}`, hit: one, f, line: ln.trim() })
  })
}
const GOLD_CAP0 = 183   /* 06g 棘轮初值(实测);**只许降** —— 提在这里是因为下面做差要先看它 */
const goldLeft = goldHits.filter((h) => !GOLD_OK.some(([g]) => h.at.startsWith(g)))
/* 🔴 「超出棘轮」必须**点名到底是哪一处新加的**,不能只报一个总数。
   刀 GG 现测:头一版把命中列表的**末尾四条**标成「最近新增的」——那只是扫描顺序的尾巴,
   跟新增毫无关系,等于报错了地方(「报得出是哪一处」是造病的验收条件之一)。
   现在拿 HEAD 里那一版同一个文件做差:**working tree 里有、HEAD 里没有**的那一行才是新增的。 */
const newGoldHits = (() => {
  if (goldLeft.length <= GOLD_CAP0) return []
  const out = []
  for (const h of goldLeft) {
    let head = ''
    try { head = execFileSync('git', ['show', `HEAD:${h.f}`], { encoding: 'utf8', cwd: ROOT }) } catch { continue }
    if (!head.split('\n').some((ln) => ln.includes(h.line))) out.push(h)
  }
  return out
})()
const GOLD_CAP = GOLD_CAP0   /* 06g 棘轮初值(实测,已含本批降下来的那一截)· **只许降**;降了就把这个数改小,不许改大 */
check(`⑤d J-40 锚值:三个被淘汰的金(#c8a47e / #9b7655 / #b5885d,含 rgb()/rgba() 同色写法)全仓 ${goldLeft.length} 处 ≤ 棘轮 ${GOLD_CAP}(只许降)`,
  goldLeft.length <= GOLD_CAP, `${goldLeft.length} > ${GOLD_CAP};**HEAD 里没有、这次新加的**:${
    (newGoldHits.length ? newGoldHits : goldLeft.slice(-3)).map((h) => `${h.at} ${h.hit}`).join(' || ')
  }${newGoldHits.length ? '' : '(做不出差,退回列末尾三条,仅供定位)'}`)
check(`⑤e 白名单只许 ${GOLD_OK.length} 条(逐条写理由;21 个 SVG 图标是**待裁**不是永久豁免,不许塞进来充数)`,
  GOLD_OK.length === 0, String(GOLD_OK.length))
/* 反向守:棘轮不是摆设 —— 现测条数必须真的大于 0,否则「≤ 195」这句话在空集上也成立 */
check('⑤f 反向守:这把刀确实扫到了东西(存量为 0 时要把棘轮改成硬零,别让判据在空集上空转)',
  goldHits.length > 0, `扫到 ${goldHits.length} 处`)

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
/* 06g §四② 扩面两件(店主指定):
   ①**html 里的内联 `<style>` 也算样式面** —— platform.html / sign.html 整页样式都住在内联块里,
     只扫 .css/.wxss 等于这两页在规矩丙面前是隐身的;
   ②**写死的金色底也算金底** —— 小程序那 33 条「写死金底 + 写死白字」正是这么躲过 06f 判据 ⑥ 的
     (它当时只认 `background: var(--brand…)`)。金的判法不写死:三个**被淘汰的**金 +
     **从令牌文件现读**的四个合同金(brand/brandd × 浅深),合同图改了值这把刀自己跟着变。 */
const styleFiles = SURFACE.filter((f) => /\.(css|wxss|html)$/i.test(f) && !/design-tokens\.css$|tokens\.wxss$|tokens-component\.wxss$/.test(f))
const GOLD_LITERAL = new RegExp('(?:' + [...Object.keys(LEGACY_GOLD),
  ...['brand', 'brandd'].flatMap((t) => [tok(LIGHT, t), tok(DARK, t)]).filter(Boolean).map((h) => h.replace('#', '')),
].join('|') + ')', 'i')
/* 🔴 刀现测抓到的判据假红:储值页 `.lv` 的底是「旧金 + 两位 alpha 后缀」—— 8 位色的后两位是 **alpha**,
   那两位约等于 13%,是一层金**薄纱**,真正的面是它后面那张深色 hero 卡。把薄纱当金底判,
   就会把「深底上的浅金字」误判成「金底上的浅字」。所以只有**不透明的金**才算金底:
   6 位色、或 8 位色而 alpha ≥ 0x80、或 rgba() 而 alpha ≥ 0.5。 */
const opaqueGold = (bgs) => {
  /* 🔴 刀 HH 现测咬出来的判据缺陷:这里原来写的是模板串里的 `\b` —— 在**模板串**里
     `\b` 是**退格符**(U+0008),不是正则的词边界。于是整条正则永远匹配不上,
     「写死的金色底」这一支**静默地全部落在扫描面之外**(现测:金底规则从 71 条掉到 57 条,
     少的那 14 条正是只写死了金、没用令牌的那些)。必须写成 `\\b`。
     归族:静默失败器族 —— 判据不是报错,是**悄悄什么都不匹配**,数字还看着挺像样。 */
  const hex = bgs.match(new RegExp(`#(?:${GOLD_LITERAL.source.replace(/^\(\?:|\)$/g, '')})([0-9a-f]{2})?\\b`, 'ig')) || []
  for (const h of hex) {
    const a = h.length === 9 ? parseInt(h.slice(7), 16) : 255
    if (a >= 0x80) return true
  }
  const rgba = bgs.match(/rgba?\([^)]*\)/gi) || []
  for (const one of rgba) {
    if (!GOLD_LITERAL.test(one.replace(/[^0-9,.\s()rgba]/gi, ''))) { /* rgb 写法另判,见下 */ }
    const parts = one.replace(/^rgba?\(|\)$/gi, '').split(',').map((x) => parseFloat(x))
    if (parts.length >= 3 && Object.values(LEGACY_GOLD).some(([r, g, b]) => parts[0] === r && parts[1] === g && parts[2] === b)
      && (parts.length < 4 || parts[3] >= 0.5)) return true
  }
  return false
}
const goldBgOf = (body) => {
  const bgs = (body.match(/background(?:-color|-image)?\s*:[^;}]*/gi) || []).join(' ')
  if (!bgs) return false
  return /var\(--brandd?\)/.test(bgs) || opaqueGold(bgs)
}
const goldRules = []
const allRules = []   /* 乙筐要拿「同文件里更短的那条选择器」来判,所以每条规则都收下 */
for (const f of styleFiles) {
  /* 🔴 刀 ZZ/WW 现测抓到的判据缺陷:这里原来把块注释**整段删掉**,换行也一并删了 ——
     于是 ⑥ 报出来的行号比真的位置**早几十行**(.primary 真在 1857,它报 1812)。
     「报得出是哪一处」是造病的验收条件之一,报错地方等于没报。改成剥内容、留换行。 */
  let src = stripComments(read(f))
  /* html 只取 <style> 里那一段,别把正文当 CSS 解析 */
  if (/\.html$/i.test(f)) src = (src.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n')
  const re = /([^{}]*)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(src)) !== null) {
    const body = m[2]
    const selAll = (m[1].split('\n').filter(Boolean).pop() || '').trim()
    const ownAll = (body.match(/(?:^|[^-a-zA-Z])color\s*:\s*([^;}]+)/) || [])[1]
    if (selAll) allRules.push({ f, sel: selAll, own: ownAll ? ownAll.trim() : '' })
    if (!goldBgOf(body)) continue
    const sel = m[1].split('\n').filter(Boolean).pop().trim()
    /* 行号要落在**选择器那一行**上:m.index 指的是「上一条规则的 } 之后」,
       中间那一大段(空行 + 被剥空的注释)全算进去,报出来会比真位置早几十行 —— 刀 WW 现测过。 */
    const at = src.slice(0, m.index + Math.max(0, m[1].lastIndexOf(sel))).split('\n').length
    const own = (body.match(/(?:^|[^-a-zA-Z])color\s*:\s*([^;}]+)/) || [])[1]
    goldRules.push({ f, sel, body, at, own: own ? own.trim() : '' })
  }
}
/* ── 落筐(三筐,穷尽)────────────────────────────────────────────
   甲 · 这条规则**自己声明了字色** → 必须是 var(--hero);写死白、var(--heroink) 都算红。
   乙 · 自己没声明,但**同文件里有一条更短的选择器**(它的基态)声明了字色 → 拿那条的字色来判。
        这一筐补的是 06f 那个洞:`.check.checked` 只换底,字色继承自 `.check` ——
        只看本条规则的判据看不见它,当时是靠我手工发现的,现在机械化。
   丙 · 从头到尾没有任何字色可继承 → **这块金底上没有字**(进度条填充、小圆点、色卡)。
        这一筐**不逐条列白名单**(现测 50 条,列出来只会变成噪音),改成**条数上棘轮**:
        只许降不许升,新加一条金底色块就得让店主看见。 */
const baseColorOf = (r) => {
  const cands = goldRules.concat(allRules.filter((x) => x.f === r.f))
    .filter((x) => x.f === r.f && x.own && x.sel !== r.sel && r.sel.startsWith(x.sel)
      && /^[.:#[]/.test(r.sel.slice(x.sel.length) || ':'))
    .sort((a, b) => b.sel.length - a.sel.length)
  return cands.length ? cands[0] : null
}
const isHero = (c) => /^var\(--hero\)$/.test(String(c).replace(/\s*\/\*[\s\S]*$/, '').trim())
const goldBad = []
let goldNoText = 0
/* `::before` / `::after` 且 `content` 是空串 —— 它画的是一个纯色块(小圆点、竖条),
   **不承载任何字**,所以不许拿它继承来的字色去判它。这条是刀现测逼出来的:
   `.tier-benefit-list li::before` 继承了 li 的 var(--ink),但那颗点里一个字也没有。 */
/* 单冒号 `:before` 是老写法,仓里两种都有 —— 判据只认一种,等于漏掉另一种(刀现测漏了 .fin-ai-li:before) */
const isPureBlock = (r) => /::?(before|after)\b/.test(r.sel) && /content\s*:\s*(""|'')/.test(r.body)
for (const r of goldRules) {
  if (isPureBlock(r)) { goldNoText += 1; continue }
  if (r.own) { if (!isHero(r.own)) goldBad.push({ ...r, why: `自己写的字色是 ${r.own.slice(0, 24)}` }); continue }
  const base = baseColorOf(r)
  if (base) { if (!isHero(base.own)) goldBad.push({ ...r, why: `字色继承自 ${base.sel}(${base.own.slice(0, 24)})` }); continue }
  goldNoText += 1
}
check(`⑥ 规矩丙:${goldRules.length} 条画金底的规则,每条要么自己写 color: var(--hero),要么在「没有字的色块」白名单里`,
  goldRules.length > 0 && goldBad.length === 0,
  goldBad.map((r) => `${r.f}:${r.at} ${r.sel} —— ${r.why}`).join(' || '))
/* 🔴 棘轮初值我先写成 3 —— **那是拿一把坏了的判据量出来的**(模板串里的 `\b` 让「写死的金底」
   整支落在扫描面外)。刀 HH 咬出那个 bug 之后重量:**16**。
   记一笔:**判据坏了,棘轮跟着坏**,而坏成「更小的数」时看起来还像是收得更紧 —— 更隐蔽。 */
/* 🔴 10b:16 → 17。**这是一次「抬」,不是一次「降」,所以必须具名并让店主看见** ——
   这条判据自己的措辞就是「新加一条金底色块**要让店主看见**」,它给的机制就是这个。
   新增的那一条:`miniprogram/…/customer-profile/index.wxss` 的 `.sdoc-opt.on .sdoc-k`
   —— 签署文件选类型时那个**选中的小圆点**,金底、里面一个字都没有。
   **它是合同图 v2 照搬来的**(图上写的就是 `.opt.on .k{background:var(--brandd);box-shadow:inset 0 0 0 3px var(--card)}`),
   不是我发挥的,也躲不掉:换成别的颜色就与图不符。
   裁#89 三支里走的是「说明」这一支,已写进 10b 回执「要你裁的」第一条。 */
const NO_TEXT_CAP = 17
check(`⑥b 丙筐「金底上没有字」${goldNoText} 条 ≤ 棘轮 ${NO_TEXT_CAP}(只许降;新加一条金底色块要让店主看见)`,
  goldNoText <= NO_TEXT_CAP, `${goldNoText} > ${NO_TEXT_CAP}`)
check(`⑥d 三筐穷尽:甲/乙筐 ${goldBad.length} 红 + 过了的 ${goldRules.length - goldBad.length - goldNoText} + 丙筐 ${goldNoText} = 全部 ${goldRules.length} 条`,
  goldBad.length + (goldRules.length - goldBad.length - goldNoText) + goldNoText === goldRules.length, '')
check(`⑥c 反向守:金底上如果用奶白 --heroink,两档分别只有 ${ratio(tok(LIGHT, 'heroink'), tok(LIGHT, 'brand'))} / ${ratio(tok(DARK, 'heroink'), tok(DARK, 'brand'))} —— 证明这条规矩在分好坏`,
  ratio(tok(LIGHT, 'heroink'), tok(LIGHT, 'brand')) < 3 && ratio(tok(DARK, 'heroink'), tok(DARK, 'brand')) < 3,
  `${ratio(tok(LIGHT, 'heroink'), tok(LIGHT, 'brand'))} / ${ratio(tok(DARK, 'heroink'), tok(DARK, 'brand'))}`)

/* ═══ ⑧ **钉浅色上闸**(店主 06h 裁 #36)═══
 *
 * 06g 我在 `platform.html` / `sign.html` 的 <html> 上钉了 `data-theme="light"`,
 * 理由是那两页整页仍是浅色版式,只翻令牌会变成「金翻了、面没翻」。店主准了,但同时上闸,原话:
 *   **「钉浅色是躲深色最便宜的一条路,不上闸它会长。」**
 *
 * 判法是白名单式,两层都要过:
 *   ①**只许这两页钉**(名单写死,钉到第三页当场红并点名 file:line);
 *   ②**条数上棘轮**(= 2,只许降)——名单里的页要是自己多钉一处也红。
 * 只认 <html> 标签上的钉子:CSS 里的 `:root:not([data-theme="light"])` 是**选择器**不是钉子,
 * 注释里提到这个词更不是 —— 判据看代码不看注释,也别把选择器当成钉子。
 */
const PIN_OK = [
  ['apps/web/platform.html', '平台运营控制台:整页浅色版式(白卡 + 一大片写死的浅底),只翻令牌会金翻面不翻', 'D188 双档化时拆'],
  ['apps/web/sign.html', '顾客签单页:同上,而且它是 web-view 里那一页,双档要连小程序一起改', 'D188 双档化时拆'],
]
const pinHits = []
for (const f of SURFACE.filter((x) => /\.html$/i.test(x))) {
  let src = ''
  try { src = read(f) } catch { continue }
  stripComments(src).split('\n').forEach((ln, i) => {
    if (/<html[^>]*\bdata-theme\s*=\s*["']light["']/i.test(ln)) pinHits.push(`${f}:${i + 1}`)
  })
}
const pinBad = pinHits.filter((h) => !PIN_OK.some(([f]) => h.startsWith(`${f}:`)))
check(`⑧ 钉浅色只许 ${PIN_OK.length} 处:现测 ${pinHits.length} 处,且都在名单里`,
  pinBad.length === 0, `名单外的:${pinBad.join(' || ')}`)
check(`⑧b 钉浅色条数棘轮 ≤ ${PIN_OK.length}(只许降;要加第三页得店主点头)`,
  pinHits.length <= PIN_OK.length, `现测 ${pinHits.length} 处:${pinHits.join(' || ')}`)
check('⑧c 反向守:名单里那两页**确实还钉着**(判据不能因为钉子被悄悄拆了就一直绿)',
  PIN_OK.every(([f]) => pinHits.some((h) => h.startsWith(`${f}:`))),
  `现测钉子:${pinHits.join(' || ')}`)
check('⑧d 每颗钉子旁边都写清了「为什么钉 + 谁来拆」(拆的去处必须写明 D188,不许只写「暂时」)',
  PIN_OK.every(([f]) => { const src = read(f); return /D188/.test(src) && /故意钉|为什么钉/.test(src) }),
  PIN_OK.filter(([f]) => !/D188/.test(read(f))).map(([f]) => f).join(' || '))

/* ═══ ⑦ 判据自己也守规矩:**锚规矩,不锚数字**(店主 06f §二 第二件)═══
 *
 * 「主按钮 = --brand 底 + --hero 字」是规矩,会一直成立;「等于 9.39」是数字,
 * 合同图一改就过期,而过期的判据要么误报要么被人顺手改小 —— 两种都是废判据。
 * 所以本文件里**不许出现任何调色板色值字面量**:所有比值都从令牌文件现读现算(见开头 tok()/ratio())。
 * WCAG 的 3.0 / 4.5 不在此列 —— 那是**标准**里的门槛,不是我们的色值。
 */
const SELF = read('apps/api/test-color-usage.mjs')
/* ⑦ 放行**被淘汰的那三个死值**(⑤d 必须点名它们才扫得动),其余色值字面量一律不许。
   为什么这个例外不算松:⑦ 防的是「判据锚在**会变**的值上」——合同图的色会变,
   而这三个是**已经作废、永远不会再变**的历史常量,锚它们正是 J-40 要的。 */
const LEGACY_HEX = /^#(?:c8a47e|9b7655|b5885d)$/i
const hexInSelf = SELF.split('\n')
  .map((ln, i) => [i + 1, ln])
  .map(([i, ln]) => [i, ln, (ln.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((h) => !LEGACY_HEX.test(h))])
  .filter(([, , rest]) => rest.length > 0)
  .map(([i, ln]) => `${i}: ${ln.trim().slice(0, 50)}`)
check('⑦ 判据锚规矩不锚数字:本判据文件里零个调色板色值字面量(比值一律从令牌文件现读现算)',
  hexInSelf.length === 0, hexInSelf.join(' || '))

console.log(`\n[配色用法] 主按钮 浅 ${lightBtn}:1 / 深 ${darkBtn}:1 · --brand 当字色 ${brandAsText.length} 处 · --done/--next 当字色 ${blockOnly.length} 处`)
if (fails.length) { console.error(`\n❌ test-color-usage ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-color-usage 通过 ${n} 项`)
