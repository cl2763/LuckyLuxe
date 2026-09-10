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
check('①b 网页主按钮:**字是深的**(--hero),不再是奶白 --heroink',
  /color:\s*var\(--hero\)/.test(primary) && !/color:\s*var\(--heroink\)/.test(primary),
  primary.replace(/\s+/g, ' ').slice(0, 90))
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

console.log(`\n[配色用法] 主按钮 浅 ${lightBtn}:1 / 深 ${darkBtn}:1 · --brand 当字色 ${brandAsText.length} 处 · --done/--next 当字色 ${blockOnly.length} 处`)
if (fails.length) { console.error(`\n❌ test-color-usage ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-color-usage 通过 ${n} 项`)
