/* UI 组件规范常驻断言(01t 二3;《UI组件规范表_2026-09-01t》为合同)。
   白名单判据:按钮/chip 类选择器的 border-radius 必须落进规范集;
   存量未清扫处逐条挂账(白名单,条目数棘轮只减不增);新增面用规范外形制 → 红。 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
let checks = 0
function check(name, ok, detail = '') {
  checks += 1
  if (!ok) { console.error(`Error: ${name}: ${detail}`); process.exit(1) }
  console.log(`ok ${checks} - ${name}`)
}
const SPEC = new Set(['8px', '999px', '50%', '999px !important'])
/* 存量挂账(队尾 UI 总审批清扫;只许减不许增)。每条=选择器片段 */
const LEGACY = new Set(['.tb-pill', '.fin-nav-btn', '.fin-tab', '.google-btn', '.sim-conversation-chip', '.mock-state-pill',
  '.calendar-cell', '.fin-mini-btn', '.nfy-tab', '.nfy-notice', '.hsw-sw', '.ui-sw', '.dc-share-btn', '.dcr-btn',
  '.swb-day', '.aa-tab', '.adjust-tab', '.br-chip', '.pl-badge'])
const css = readFileSync(join(ROOT, 'apps/web/styles.css'), 'utf8')
const btnish = /(button|btn|chip|pill|cta|\.primary|\.ghost|\.toggle)/i
const viol = []
let legacyHit = 0
for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const sel = m[1].trim().replace(/\s+/g, ' ')
  const br = /border-radius:\s*([^;]+);?/.exec(m[2])
  if (!br || !btnish.test(sel)) continue
  const v = br[1].trim()
  if (SPEC.has(v)) continue
  if ([...LEGACY].some((l) => sel.includes(l))) { legacyHit += 1; continue }
  viol.push(`${sel.slice(0, 60)} → ${v}`)
}
check('① 网页按钮/chip 圆角全落规范集{8px,999px,50%}(白名单式,存量逐条挂账)', viol.length === 0, viol.slice(0, 5).join(' | '))
check('② 存量挂账棘轮:命中数只许降(当前基线见 detail,升=有人往老形制里加新面)', legacyHit <= 24, String(legacyHit))
/* 规范三件在场:.ui-sw 别名进 hsw 同一条规则(单一真相);chips 999px;值日行用 .ui-sw */
check('③ .ui-sw=hsw-sw 同一条规则别名(开关单一真相)', css.includes('.hsw-sw, .ui-sw {') && css.includes('.hsw-sw.on, .ui-sw.on {'))
check('④ chips 三处已统一 999px', !/\.sw-chip \{[^}]*border-radius: 16px/.test(css) && !/\.rfm-chip \{[^}]*border-radius: 14px/.test(css) && !/\.nfy-chips button \{[^}]*border-radius: 5px/.test(css))
const duty = readFileSync(join(ROOT, 'apps/web/duty-setting.js'), 'utf8')
check('⑤ D98 值日行=ui-sw 行右开关(不再是 checkbox 巨方框)', duty.includes('class="ui-sw ${on ? \'on\' : \'\'}"') && !duty.includes('type="checkbox"'))
const ordersWxss = readFileSync(join(ROOT, 'miniprogram/pages/merchant/orders/index.wxss'), 'utf8')
check('⑥ D94 小程序值日 chips=999rpx 胶囊+选中黑白+呼吸', ordersWxss.includes('.dv-duty-chip { border: 2rpx solid #d9d9de; background: #fff; color: #2d2826; border-radius: 999rpx;') && ordersWxss.includes('.dv-duty-chip.on { background: #1f1b16;'))
console.log(`[ui-spec] all ${checks} checks passed`)
