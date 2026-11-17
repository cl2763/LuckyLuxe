const api = require('../../../utils/api')
const { refreshStoreClock, storeCurrencyPrefix } = require('../../../utils/storeclock')

Page({
  cancel(){if(!this.data.saving)require('../../../utils/nav').back()},
  // 门禁:未登录/会话失效不渲染空壳,直接回登录页(店主 2026-08-09 红线)
  async onShow() { if (!(await api.guardOwner())) return; await refreshStoreClock().catch(() => {}); this.setData({ currency: storeCurrencyPrefix() }) },
  data: {
    rateBps:null,discountRevision:0,loaded:false,loadError:'',
    id: '', isNew: true, kind: 'recharge',
    name: '', price: '', bonus: '', times: '', scope: '', benefits: '', active: true,
    giftItems: [], currency: '', saving: false, validityModes:['请选择','固定天数','长期有效'],validityIndex:0,groupNames:['不限项目组'],groupIndex:0,validDays:'',projectGroup:'',mallVisible:true
  },

  onLoad(opt) {
    const kind = opt && opt.kind === 'times' ? 'times' : 'recharge'
    if(kind==='times')this.loadGroups()
    if (opt && opt.id) {
      this.setData({ id: opt.id, isNew: false, kind })
      wx.setNavigationBarTitle({ title: kind === 'times' ? '编辑次卡' : '编辑充值套餐' })
      this.load(opt.id)
    } else {
      this.setData({ kind,loaded:true })
      wx.setNavigationBarTitle({ title: kind === 'times' ? '新增次卡' : '新增充值套餐' })
    }
  },

  async loadGroups(){try{const r=await api.adminGet('/admin/pricing/categories');const names=['不限项目组',...(r.categories||[]).map(c=>c.name)];if(this.data.projectGroup&&!names.includes(this.data.projectGroup))names.push(this.data.projectGroup);this.setData({groupNames:names,groupIndex:Math.max(0,names.indexOf(this.data.projectGroup))})}catch(e){wx.showToast({title:'项目组读取失败，请重试',icon:'none'})}},
  onGroup(e){const i=Number(e.detail.value);this.setData({groupIndex:i,projectGroup:i?this.data.groupNames[i]:''})},
  onValidity(e){this.setData({validityIndex:Number(e.detail.value)})},
  async load(id) {
    this.setData({loaded:false})
    try {
      const r = await api.adminGet('/admin/packages')
      const p = (r.packages || []).find((x) => x.id === id)
      if (!p) throw Error('未找到本店套餐，请返回列表重新核对')
      if(p.kind==='stored_value')p.kind='recharge'
      if(!['recharge','times'].includes(p.kind))throw Error('套餐类型需要平台核对')
      const discount=p.kind==='recharge'?await api.adminGet('/admin/member-pricing/packages/'+encodeURIComponent(id)):{rateBps:null,revision:0}
      this.setData({loaded:true,loadError:'',configRevision:p.configRevision,rateBps:discount.rateBps,discountRevision:discount.revision,
        kind: p.kind, name: p.name,
        price: String((p.priceCents || 0) / 100),
        bonus: p.bonusCents ? String(p.bonusCents / 100) : '',
        times: p.timesCount ? String(p.timesCount) : '',
        giftItems: (p.giftItems || []).map((g) => ({ name: g.name, quantity: String(g.quantity), value: String(g.unitValueCents / 100) })),
        validityIndex:p.validDays==null?2:1,validDays:p.validDays==null?'':String(p.validDays),projectGroup:p.projectGroup||'',mallVisible:p.mallVisible!==false,
        scope: p.scope || '', benefits: p.benefits || '', active: p.isActive !== false
      })
      if(p.kind==='times')await this.loadGroups()
    } catch (e) { this.setData({loaded:false,loadError:e.message||'加载失败，当前输入已保留'});wx.showToast({ title: '加载失败，请重试', icon: 'none' }) }
  },

  onConfig(e){const key=e.currentTarget.dataset.key;if(['validDays','projectGroup','mallVisible'].includes(key))this.setData({[key]:e.detail.value})},
  onRate(e){this.setData({rateBps:e.detail.rateBps})},
  onName(e) { this.setData({ name: e.detail.value }) },
  onPrice(e) { this.setData({ price: e.detail.value }) },
  onBonus(e) { this.setData({ bonus: e.detail.value }) },
  onTimes(e) { this.setData({ times: e.detail.value }) },
  onScope(e) { this.setData({ scope: e.detail.value }) },
  onBenefits(e) { this.setData({ benefits: e.detail.value }) },
  onActive(e) { this.setData({ active: e.detail.value }) },

  addGift() { if (this.data.giftItems.length < 20) this.setData({ giftItems: this.data.giftItems.concat({ name: '', quantity: '1', value: '' }) }) },
  removeGift(e) { this.setData({ giftItems: this.data.giftItems.filter((_, i) => i !== Number(e.currentTarget.dataset.i)) }) },
  onGift(e) { const { i, field } = e.currentTarget.dataset; if (!['name', 'quantity', 'value'].includes(field)) return; this.setData({ [`giftItems[${i}].${field}`]: e.detail.value }) },

  showConflict(c){this.setData({conflict:c,conflictText:[c.name,'金额 '+c.priceCents/100,'赠送 '+c.bonusCents/100,'次数 '+(c.timesCount||'无'),'权益 '+(c.benefits||'无'),'赠品 '+(c.giftItems||[]).map(g=>g.name+' × '+g.quantity).join('、')].join('；')})},
  async reviewChanges(){if(this.data.saving||this.data.isNew)return;try{const r=await api.adminGet('/admin/packages'),c=(r.packages||[]).find(x=>x.id===this.data.id);if(!c)throw Error('套餐已被移除，请返回列表核对');this.setData({loadError:''});if(c.configRevision===this.data.configRevision){this.setData({configSyncChanged:false});wx.showToast({title:'该套餐没有变化',icon:'none'})}else this.showConflict(c)}catch(e){this.setData({loadError:e.message||'无法读取最新内容，当前输入已保留'})}},
  retryLoad(){this.load(this.data.id)},
  async useServer(){const r=await new Promise(resolve=>wx.showModal({title:'采用服务器内容',content:'将替换本页尚未保存的输入。',success:resolve,fail:e=>{console.error('确认窗口未打开',e.errMsg);this.setData({error:'确认窗口未打开，当前内容已保留，请重试。'});resolve({confirm:false})}}));if(r.confirm){this.setData({conflict:null,configSyncChanged:false});this.load(this.data.id)}},
  keepMine(){const c=this.data.conflict;if(!c)return;this.setData({configRevision:c.configRevision,discountRevision:c.defaultPersonalDiscount?.revision||this.data.discountRevision,conflict:null,configSyncChanged:false});wx.showToast({title:'已保留输入，请核对后再次保存',icon:'none'})},
  async save() {
    if (this.data.saving || this.data.conflict || this.data.configSyncError || !this.data.loaded) return
    const { id, isNew, kind, name, price, bonus, times, scope, benefits, active } = this.data
    if (!name.trim()) { wx.showToast({ title: '请输入名称', icon: 'none' }); return }
    const p = /^\d+(\.\d{1,2})?$/.test(String(price).trim()) ? Number(price) : NaN
    if (!p || p <= 0) { wx.showToast({ title: '请输入售价', icon: 'none' }); return }
    if (kind === 'times' && !(Number(times) > 0)) { wx.showToast({ title: '请输入次数', icon: 'none' }); return }
    let giftItems = []
    if (kind === 'recharge') {
      if (bonus && (!/^\d+(\.\d{1,2})?$/.test(String(bonus)) || !Number.isFinite(Number(bonus)))) { wx.showToast({ title: '赠送金额须为非负金额', icon: 'none' }); return }
      for (let i = 0; i < this.data.giftItems.length; i++) {
        const g = this.data.giftItems[i], n = g.name.trim(), q = String(g.quantity), v = String(g.value)
        if (!n || n.length > 80 || !/^\d+$/.test(q) || +q < 1 || +q > 999 || !/^\d+(\.\d{1,2})?$/.test(v) || +v > 1000000) {
          wx.showToast({ title: `请检查第${i + 1}行名称、整数数量和非负价值`, icon: 'none' }); return
        }
        giftItems.push({ name: n, quantity: Number(q), unitValueCents: Math.round(Number(v) * 100) })
      }
    }
    if(kind==='times'&&!this.data.validityIndex){wx.showToast({title:'请明确选择有效期方式',icon:'none'});return}
    const valid=kind==='times'&&this.data.validityIndex===2?'':String(this.data.validDays).trim();if(kind==='times'&&this.data.validityIndex===1&&!valid){wx.showToast({title:'请填写有效天数',icon:'none'});return}
    if(valid&&(!/^\d+$/.test(valid)||+valid<1)){wx.showToast({title:'有效期应为正整数天数',icon:'none'});return}
    const body = {
      ...(isNew?{}:{expectedConfigRevision:this.data.configRevision}),
      validDays:valid?Number(valid):null,projectGroup:this.data.projectGroup.trim(),mallVisible:this.data.mallVisible,
      ...(kind==='recharge'?{defaultPersonalDiscount:{expectedRevision:this.data.discountRevision,rateBps:this.data.rateBps}}:{}),
      kind, giftItems, name: name.trim(),
      priceCents: Math.round(p * 100),
      bonusCents: kind === 'recharge' ? Math.round((Number(bonus) || 0) * 100) : 0,
      timesCount: kind === 'times' ? Math.round(Number(times) || 0) : 0,
      scope: scope.trim(), benefits: benefits.trim(), isActive: active
    }
    this.setData({ saving: true })
    try {
      if (isNew) await api.adminPost('/admin/packages', body)
      else await api.adminPatch(`/admin/packages/${encodeURIComponent(id)}`, body)
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (err) { if(err.code==='CONFIG_CHANGED'&&err.details?.current){this.showConflict(err.details.current)}wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  }
})
