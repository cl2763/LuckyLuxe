// Customer selection resets identity; contact is submitted only for a new profile.
module.exports={
  onDirectContact(e){this.setData({directContact:e.detail.value})},
  onCustSearch(e) {
    const q = (e.detail.value || '').trim()
    const ql = q.toLowerCase() // D62:大小写不敏感(全仓搜索口同刀)
    const matches = ql ? this.data.directCustomers.filter((c) => (c.name || '').toLowerCase().indexOf(ql) >= 0 || (c.phone || '').indexOf(q) >= 0).slice(0, 5) : []
    // 输入过程中不许改写内容:回写原样,trim 只用于匹配(同 member 那一处)
    this.setData({ custQuery: String(e.detail.value || ''), custMatches: matches, selectedCustId: '', selectedCustName: '', pendingNewName: '', pendingNewPhone: '', selectedCustPhoneMasked: '' })
  },
  pickCust(e) {
    const id = e.currentTarget.dataset.id
    const c = this.data.directCustomers.find((x) => x.id === id)
    if (c) this.setData({ selectedCustId: c.id, selectedCustName: c.name, selectedCustPhoneMasked:c.phoneMasked||'', directContact:'', custQuery: c.name, custMatches: [], pendingNewName: '', pendingNewPhone: '' })
  },
  /* 「＋建档并排单」(图规则②,店主拍板一步到位不弹确认):
     ≥7 位纯数字 → 当手机号存(姓名记「未命名」);否则当姓名存(手机号空);
     空输入 → 「未命名顾客」。都可在档案里后补;真正的建档发生在建单那一刻(既有闭环零新口径)。 */
  pickNewCust() {
    const q = (this.data.custQuery || '').trim()
    const digits = q.replace(/\D/g, '')
    const isPhone = /^\d{7,}$/.test(digits) && digits.length === q.replace(/\s/g, '').length
    const name = isPhone ? '未命名' : (q || '未命名顾客')
    this.setData({
      pendingNewName: name,
      pendingNewPhone: isPhone ? digits : '', directContact: this.data.directContact || (isPhone ? digits : ''),
      selectedCustId: '',
      selectedCustName: `${name}${isPhone ? `(${digits})` : ''} · 新建轻档案`,
      custMatches: []
    })
  },
  clearCust() { this.setData({ directContact:'', selectedCustPhoneMasked:'', selectedCustId: '', selectedCustName: '', custQuery: '', custMatches: [], pendingNewName: '', pendingNewPhone: '' }) },
}
