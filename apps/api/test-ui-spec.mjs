/* UI 组件规范常驻断言 —— 二形法(店主 01u 终裁,《UI组件规范表》为合同):
     能点的都是胶囊(999px / 999rpx);能装内容的是圆角矩形(网页 8px / 小程序 12rpx)。
   两层判据(白名单式,存量逐条挂账 + 条目数棘轮只减不增):
     ① 形制集:全端 border-radius ∈ {999px, 999rpx, 8px, 12rpx, 50%, 0}(店主钦定集 + 0/无角)
     ② 按钮必胶囊:按钮族选择器必须 999 —— 8px 的按钮不再算"合规",这层才守得住二形法 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'node:fs'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
let checks = 0
function check(name, ok, detail = '') {
  checks += 1
  if (!ok) { console.error(`Error: ${name}: ${detail}`); process.exit(1) }
  console.log(`ok ${checks} - ${name}`)
}
const SPEC_WEB = new Set(['999px', '50%', '999px !important', '8px', '0'])
const SPEC_MINI = new Set(['999rpx', '50%', '999px', '12rpx', '0'])
const CLICK = /(button|btn|chip|pill|cta|tab\b|-tab|seg\b|-seg|\.primary|\.ghost\b|\.toggle|marrow|arrow|ui-sw|hsw-sw|\.sw-sw|ds-confirm|submit|as-btn|sidebar-link)/i
/* 存量挂账(队尾 UI 总审批清扫;只许减不许增)。每条=选择器主体 + 理由 */
const LEGACY_WEB = {
  '.web-tabs': '页签容器(装内容)= 8px 圆角矩形,非按钮本身',
  '.aa-seg': '四 tab 容器(装内容)= 8px,子元素 .aa-seg-btn 才是按钮',
  '.member-code-chip': '展示型徽标非可点 —— 归属待总审批裁(徽标算不算"能点的")',
  '.store-info-table td code': '代码块,非控件',
  '.cs-link-member-row select': '原生 select=输入类,按"能装内容"侧 8px',
  '.segmented': '分段控件容器 8px,子按钮 .segment 已胶囊',
  '.segment': '待总审批(分段子钮,6px)',
  '.calendar-cell': '日历格=容器',
  '.fin-tab': '待总审批',
  '.fin-mini-btn': '已 999px !important',
  '.dc-share-btn': '待总审批', '.dcr-btn': '待总审批', '.swb-day': '排班格=容器',
  '.aa-tab': '待总审批', '.adjust-tab': '待总审批', '.br-chip': '待总审批', '.pl-badge': '徽标'
}
const LEGACY_MINI = new Set(['.fact', '.svtxn-unconfirmed', '.li-unconfirmed'])

function rules(css) {
  const out = []
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const br = /border-radius:\s*([^;]+)/.exec(m[2])
    if (br) out.push([m[1].trim().replace(/\s+/g, ' '), br[1].trim()])
  }
  return out
}
const webCss = readFileSync(join(ROOT, 'apps/web/styles.css'), 'utf8')
const clean = (sel) => sel.replace(/\/\*[\s\S]*?\*\//g, '').trim()

/* ① 形制集(网页):容器侧存量=队尾 UI 总审批的清扫面,这层用**条数棘轮**挂账(只减不增),
      清单逐条落《UI组件规范表》附件。按钮那层(②)才是硬零。 */
const offSpecWeb = []
for (const [sel, v] of rules(webCss)) {
  if (SPEC_WEB.has(v) || v.includes(' ')) continue
  offSpecWeb.push(`${clean(sel).slice(0, 46)} → ${v}`)
}
check('① 网页形制集:容器侧存量条数棘轮 ≤ 58(只减不增;清单见规范表附件,总审批时清)',
  offSpecWeb.length <= 58, `${offSpecWeb.length} 条:${offSpecWeb.slice(0, 4).join(' | ')}`)

/* ② 按钮必胶囊(网页)—— 二形法的牙齿:8px 的按钮在这层红,形制集那层看不出来 */
const notPillWeb = []
for (const [sel, v] of rules(webCss)) {
  if (v === '999px' || v === '50%' || v === '999px !important' || v.includes(' ')) continue
  const c = clean(sel)
  if (!CLICK.test(c)) continue
  if (Object.keys(LEGACY_WEB).some((k) => c.includes(k))) continue
  notPillWeb.push(`${c.slice(0, 46)} → ${v}`)
}
check('② 网页按钮必胶囊:能点的一律 999px(硬零;新面长歪即红)', notPillWeb.length === 0, notPillWeb.slice(0, 6).join(' | '))

/* ③④ 小程序两层 */
const wxss = globSync('miniprogram/**/*.wxss', { cwd: ROOT }).map((f) => [f, readFileSync(join(ROOT, f), 'utf8')])
const offSpecMini = []; const notPillMini = []
let legacyHitMini = 0
for (const [f, css] of wxss) {
  for (const [sel, v] of rules(css)) {
    const c = clean(sel)
    const base = c.split(/\s+/).pop().split(':')[0]
    if (LEGACY_MINI.has(base)) { legacyHitMini += 1; continue }
    if (!SPEC_MINI.has(v) && !v.includes(' ')) offSpecMini.push(`${f.split('/').slice(-2)[0]}/${c.slice(0, 30)} → ${v}`)
    if (CLICK.test(c) && v !== '999rpx' && v !== '50%' && v !== '999px' && !v.includes(' ')) notPillMini.push(`${f.split('/').slice(-2)[0]}/${c.slice(0, 30)} → ${v}`)
  }
}
check('③ 小程序形制集:容器侧存量条数棘轮 ≤ 289(只减不增;总审批时清)',
  offSpecMini.length <= 289, `${offSpecMini.length} 条:${offSpecMini.slice(0, 4).join(' | ')}`)
check('④ 小程序按钮必胶囊:能点的一律 999rpx(硬零)', notPillMini.length === 0, `${notPillMini.length} 处:${notPillMini.slice(0, 5).join(' | ')}`)

/* ⑤ 挂账棘轮:只许降 */
check('⑤ 按钮层挂账棘轮(网页容器/徽标误命中位,只许降)', Object.keys(LEGACY_WEB).length <= 17, String(Object.keys(LEGACY_WEB).length))
check('⑥ 小程序按钮层挂账棘轮(三条非按钮误命中位)', legacyHitMini <= 3, String(legacyHitMini))

/* ⑦⑧ 二形法关键处在场(属性界定) */
check('⑦ 主操作 .primary=胶囊(店主骂的「有的方角有的圆角」的根)', /\.primary \{[^}]*border-radius: 999px/.test(webCss))
check('⑧ 开关 .ui-sw=hsw-sw 同一条规则别名且胶囊(开关单一真相)', webCss.includes('.hsw-sw, .ui-sw {') && /\.hsw-sw, \.ui-sw \{[^}]*border-radius: 999px/.test(webCss))
const duty = readFileSync(join(ROOT, 'apps/web/duty-setting.js'), 'utf8')
check('⑨ D98 值日行=ui-sw 行右开关(不再是 checkbox 巨方框)', duty.includes('class="ui-sw ${on ? \'on\' : \'\'}"') && !duty.includes('type="checkbox"'))
const ordersWxss = readFileSync(join(ROOT, 'miniprogram/pages/merchant/orders/index.wxss'), 'utf8')
check('⑩ D94 小程序值日 chips=胶囊+选中黑白', ordersWxss.includes('border-radius: 999rpx') && ordersWxss.includes('.dv-duty-chip.on { background: #1f1b16;'))
console.log(`[ui-spec] all ${checks} checks passed`)
