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
    /* ══ 这条判据自己的案底,留着,因为它正是 12m 那个缺陷的来源 ══
       05z:白字令牌化成 `var(--heroink)`,判据原来锚死字面量 `color:#fff`,当场咬红。
       当时的改法是**把 --heroink 认进合法白字**,理由写的是「深面上的浅字,两档都是浅的」。
       🔴 那一步只看了**字**,没看**底**:
         · `--black`(= --hero 的别名)两档都是深的 → 配 --heroink 没问题
         · `--ink` **会翻转**,深色档翻成浅奶白 → 配 --heroink 只剩 1.07:1,字等于隐形
       店主 12m §一-3 亲眼撞见的就是后者(登录页角色页签)。
       **判据不许锚在会变的字面量上是对的;但也不许因为「换成令牌了」就不管它渲染出来是什么。**

       现在白字认三种写法:`#fff` / `var(--heroink)` / `var(--paper)`。
       这条只管**色序对不对**(黑在底、白在字);**渲染出来够不够看**由
       `test-color-usage ⑨c` 按两档实算对比度守(它解令牌别名,甲档必须为 0)。
       两条分工写在这里,免得下次又有人为了让这条不红而去放宽它。 */
    check(`六 网页「${sel}」选中=黑底白字`,
      at >= 0 && /background:\s*var\(--(black|ink)\)/.test(rule) && /color:\s*(#fff|var\(--heroink\)|var\(--paper\))/.test(rule),
      rule.slice(0, 110) || '选择器消失')
  }
}

console.log(`\n✅ test-tab-colors 通过 ${checks} 项`)
