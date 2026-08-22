/* 裁定A(店主 08-23):我的资产=**分类总页**。顾客端「我拥有的东西」只有这一条路径:
   我的 → 我的资产 → 类别(卡包/储值/积分/会员权益)。
   各行数字全部来自后端唯一出口 /my/assets(卡包与卡包页同源同数、储值与卡包储值行同源、
   积分与积分页同源),本页零计算、零拼话。今后新资产类型一律加在这里,不许回「我的」页并列。 */
const api = require('../../utils/api')
const nav = require('../../utils/nav')
const i18n = require('../../utils/i18n')
const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')

Page({
  data: { assets: null, error: '', lang: 'zh', t: i18n.pageCopy('assets', 'zh') },

  onShow() {
    ensureCurrencyCached()
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    i18n.setTitle(i18n.pageCopy('assets', lang).title)
    this.setData({ cur: curOf(), lang, t: i18n.pageCopy('assets', lang) })
    this.load()
  },

  async load() {
    if (!api.isLoggedIn()) { this.setData({ assets: null, error: '登录后查看我的资产' }); return }
    try {
      const r = await api.getAssets()
      this.setData({ assets: r.assets, error: '' })
    } catch (e) {
      this.setData({ assets: null, error: (e && e.message) || '资产加载失败' })   // D17:失败如实报,不回 mock
    }
  },

  goCardPack() { nav.to('/pages/card-pack/index') },
  goStored() { nav.to('/pages/stored-value/index') },
  goPoints() { nav.to('/pages/points/index') },     // 兑换与积分商城入口留在积分页内
  goBenefits() { nav.to('/pages/member-benefits/index') }
})
