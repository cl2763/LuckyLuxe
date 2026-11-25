const api = require('../../../utils/api')
const pricing=require('../../../utils/member-pricing')
const couponRates=pricing.options.filter(o=>o.rateBps!==null&&o.rateBps<10000)
const {refreshStoreClock,storeCurrencyPrefix}=require('../../../utils/storeclock')

Page({
  // 门禁:未登录/会话失效不渲染空壳,直接回登录页(店主 2026-08-09 红线)
  async onShow(){if(!await api.guardOwner())return;await refreshStoreClock().catch(()=>{});this.setData({currency:storeCurrencyPrefix()})},
  data: {
    id: '', isNew: true,
    typeIdx: 0, types: [{ k: 'amount', label: '满减券' }, { k: 'percent', label: '折扣券' }],
    name: '', amount: '', percent: '15', couponRate:8500, couponRateText:'8.5折', couponRates,couponRateIndex:14, minSpend: '', validDays: '30', totalQty: '', active: true,
    giftConfigLoaded:false,giftEnabled:false,recipientIdx:0,recipients:['按本券适用规则','好友同行 · 朋友整单原价打折'],saving: false,currency:'',categories:[],scopeCategoryIds:[],copyTemplate:false,issuedQty:0
  },

  onLoad(opt) {
    this.loadGiftConfig()
    this.loadCategories()
    if (opt && opt.id) {
      this.setData({ id: opt.id, isNew: false })
      wx.setNavigationBarTitle({ title: '编辑优惠券' })
      this.load(opt.id)
    }
  },

  async load(id) {
    try {
      const r = await api.adminGet('/admin/coupons')
      const c = (r.coupons || []).find((x) => x.id === id)
      if (!c) { wx.showToast({ title: '未找到', icon: 'none' }); return }
      this.setData({
        recipientIdx:c.recipientMode==='friend_original'?1:0,
        typeIdx: c.discountType === 'percent' ? 1 : 0,
        name: c.name,
        amount: c.amountCents ? String(c.amountCents / 100) : '',
        percent: c.percentOff ? String(c.percentOff) : '15',couponRate:10000-(c.percentOff||15)*100,couponRateIndex:Math.max(0,couponRates.findIndex(o=>o.rateBps===10000-(c.percentOff||15)*100)),couponRateText:pricing.label(10000-(c.percentOff||15)*100),
        minSpend: c.minSpendCents ? String(c.minSpendCents / 100) : '',
        validDays: String(c.validDays || 30),
        totalQty: c.totalQty ? String(c.totalQty) : '',
        active: c.isActive !== false,scopeCategoryIds:c.scopeCategoryIds||[],issuedQty:c.issuedQty||0,copyTemplate:!!c.issuedQty
      });this.updateCategoryChecks()
    } catch (e) { wx.showToast({ title: '加载失败', icon: 'none' }) }
  },

  async loadGiftConfig(){try{const r=await api.adminGet('/admin/gift-entitlements/config');this.setData({giftEnabled:!!r.enabled,giftConfigLoaded:true})}catch(e){wx.showToast({title:e.message||'权益配置读取失败',icon:'none'})}},
  onRecipient(e){const recipientIdx=Number(e.detail.value);this.setData({recipientIdx,...(recipientIdx===1?{typeIdx:1,scopeCategoryIds:[],percent:this.data.percent||'15'}:{})});this.updateCategoryChecks()},
  async loadCategories(){try{const r=await api.adminGet('/admin/pricing/categories');this.setData({categories:r.categories||[]});this.updateCategoryChecks()}catch(e){wx.showToast({title:'适用范围加载失败',icon:'none'})}},
  updateCategoryChecks(){this.setData({categories:this.data.categories.map(c=>({...c,checked:this.data.scopeCategoryIds.includes(c.id)}))})},
  onScope(e){this.setData({scopeCategoryIds:e.detail.value});this.updateCategoryChecks()},
  onCopy(e){this.setData({copyTemplate:e.detail.value})},
  onType(e) { if(this.data.recipientIdx===1)return;this.setData({ typeIdx: Number(e.detail.value) }) },
  onCouponRate(e){const index=Number(e.detail.value),option=couponRates[index];if(!option)return;const rate=option.rateBps;this.setData({couponRateIndex:index,couponRate:rate,percent:String(100-rate/100),couponRateText:option.label})},
  onName(e) { this.setData({ name: e.detail.value }) },
  onAmount(e) { this.setData({ amount: e.detail.value }) },
  onPercent(e) { const off=Number(e.detail.value)||0;this.setData({ percent: e.detail.value,couponRate:10000-off*100,couponRateIndex:Math.max(0,couponRates.findIndex(o=>o.rateBps===10000-off*100)),couponRateText:pricing.label(10000-off*100) }) },
  onMin(e) { this.setData({ minSpend: e.detail.value }) },
  onDays(e) { this.setData({ validDays: e.detail.value }) },
  onQty(e) { this.setData({ totalQty: e.detail.value }) },
  onActive(e) { this.setData({ active: e.detail.value }) },

  async save() {
    if (this.data.saving || !this.data.giftConfigLoaded) return
    const { id, isNew, typeIdx, types, name, amount, percent, minSpend, validDays, totalQty, active } = this.data
    if (!name.trim()) { wx.showToast({ title: '请输入券名', icon: 'none' }); return }
    const type = types[typeIdx].k
    if (type === 'amount' && !(Number(amount) > 0)) { wx.showToast({ title: '请输入面额', icon: 'none' }); return }
    if (type === 'percent' && !(Number(percent) > 0 && Number(percent) <= 100)) { wx.showToast({ title: '请输入折扣', icon: 'none' }); return }
    const body = {
      scopeCategoryIds:this.data.scopeCategoryIds,name: name.trim(), discountType: type,
      amountCents: type === 'amount' ? Math.round((Number(amount) || 0) * 100) : 0,
      percentOff: type === 'percent' ? Math.round(Number(percent) || 0) : 0,
      minSpendCents: Math.round((Number(minSpend) || 0) * 100),
      validDays: Math.round(Number(validDays) || 30),
      totalQty: Math.round(Number(totalQty) || 0),
      isActive: active
    }
    if(this.data.giftEnabled)body.recipientMode=this.data.recipientIdx===1?'friend_original':'any'
    if(body.recipientMode==='friend_original'&&(type!=='percent'||body.scopeCategoryIds.length)){wx.showToast({title:'好友券须为折扣券且适用全部服务',icon:'none'});return}
    this.setData({ saving: true })
    try {
      if (isNew||this.data.copyTemplate) await api.adminPost('/admin/coupons', body)
      else await api.adminPatch(`/admin/coupons/${encodeURIComponent(id)}`, body)
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  }
})
