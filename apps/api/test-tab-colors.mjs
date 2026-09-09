/* 页签/按键配色统一(店主 v2 六 + 08-30c 开工令):
   「同一组控件全组同一套配色逻辑 —— 选中=黑底白字,未选中=白底黑字描边;不许一组里两黑两白。」

   判据=白名单式钉名单:两端所有页签组的「选中」选择器逐条钉黑白;组内混搭(customer 2×2)钉同色。
   新页签组不在名单=红(来对表登记),名单里的选择器消失=红(防悄悄换名逃扫)。

   ⚠️ standalone:CI_SUITES="tab-colors" bash apps/api/run-all-tests.sh */
import { readFileSync } from 'node:fs'

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const BLACK_MINI = '#2d2826'
const BLACK_MINI_ALT = '#2d2a26'   // account-adjust 沿用的墨色(同族深墨,肉眼同色;两值都算黑)
/* 刀4 咬出的判据洞:只查两色都在 —— 白底黑字同样含这两色。改按**属性归位**判:
   黑必须在 background 上、白必须在 color 上,色序反了=白pill回潮=红 */
const isBlackOn = (rule) => new RegExp(`background:\\s*(${BLACK_MINI}|${BLACK_MINI_ALT})`).test(rule) && /color:\s*#fff/.test(rule)

/* 小程序端:每个页签组的「选中」规则钉黑白 */
{
  const MINI = [
    ['pages/merchant/account-adjust/index.wxss', '.segbtn.on'],
    ['pages/merchant/account-adjust/index.wxss', '.subbtn.on'],
    ['pages/merchant/account-adjust/index.wxss', '.chip.on'],
    ['pages/merchant/orders/index.wxss', '.seg-i.on'],
    ['pages/merchant/staff/index.wxss', '.seg .s.on'],
    ['pages/merchant/salary-plan/index.wxss', '.sopt.on'],
    ['pages/merchant/member/index.wxss', '.s.on'],
    ['pages/merchant/gallery/index.wxss', '.s.on'],
    ['pages/merchant/content/index.wxss', '.s.on'],
    ['pages/merchant/work-detail/index.wxss', '.s.on'],
    ['pages/merchant/finance/index.wxss', '.seg-b.on'],
    ['pages/merchant/finance-entry/index.wxss', '.seg-b.on']
  ]
  for (const [f, sel] of MINI) {
    const css = read(`../../miniprogram/${f}`)
    const at = css.indexOf(`${sel}{`) >= 0 ? css.indexOf(`${sel}{`) : css.indexOf(`${sel} {`)
    check(`六 小程序「${f.split('/')[2]}」${sel} 选中=黑底白字`, at >= 0 && isBlackOn(css.slice(at, css.indexOf('}', at))),
      at >= 0 ? css.slice(at, css.indexOf('}', at)).slice(0, 90) : '选择器消失')
  }
  /* 组内混搭点名件:客户档案 2×2 —— 四个动作同一形制同一配色(店主原话:不许两黑两白) */
  const cust = read('../../miniprogram/pages/merchant/customer/index.wxss')
  const ghostAt = cust.indexOf('.hbtn.ghost{')
  const ghostRule = ghostAt >= 0 ? cust.slice(ghostAt, cust.indexOf('}', ghostAt)) : ''
  check('🔴 六 客户档案 2×2:hbtn.ghost 与 hbtn 同色(黑底白字)—— 两黑两白不许回潮',
    ghostAt < 0 || (ghostRule.includes(BLACK_MINI) && ghostRule.includes('#fff')), ghostRule.slice(0, 90))
}

/* 网页端:tab 族选中态逐条钉 var(--black)+白字 */
{
  const css = read('../web/styles.css')
  const WEB = ['.admin-tab.active', '.web-tab.active', '.order-tabs-web button.active', '.aa-seg-btn.on', '.login-role-tab.active']
  for (const sel of WEB) {
    const at = css.indexOf(`${sel} {`) >= 0 ? css.indexOf(`${sel} {`) : css.indexOf(`${sel}{`)
    const rule = at >= 0 ? css.slice(at, css.indexOf('}', at)) : ''
    /* 小程序侧同病同治:黑在 background、白在 color(色序反了=红);--ink 与 --black 同为墨黑 */
    /* 🔴 05z 之后白字写成了令牌 `var(--heroink)`(压在深面上的字色,浅深两档都是浅的)——
       原来这条判据锚死 `color:#fff` 这个**字面量**,令牌化当场把它咬红。
       判据不许锚在会变的字面量上:白字认「#fff 或 --heroink」两种写法,
       它们是同一个语义(深面上的浅字),值也几乎相同(#fff / #f5efe3)。 */
    check(`六 网页「${sel}」选中=黑底白字`,
      at >= 0 && /background:\s*var\(--(black|ink)\)/.test(rule) && /color:\s*(#fff|var\(--heroink\))/.test(rule),
      rule.slice(0, 110) || '选择器消失')
  }
}

console.log(`\n✅ test-tab-colors 通过 ${checks} 项`)
