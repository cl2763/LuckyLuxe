Page({
  data: { list: [] },
  onShow() {
    /* 🔴 03u(店主裁):这四条是**样例**。上线前真顾客不能看到 ——
       只在演示店出;真店只出真空态「暂无消息」(wxml 的 wx:else 那块)。
       真数据源(站内消息表)排在「未动」栏,做出来再接。
       判据落在数据(tenants.kind → /stores 的 isDemo),不看店名。 */
    const isDemo = wx.getStorageSync('lucky_store_demo') === true
    const list = isDemo ? [
      { id: 1, type: 'a', title: '明天 15:30 有预约,记得到店哦', label: '预约提醒', time: '1小时前' },
      { id: 2, type: 'b', title: '补甲提醒:上次美甲已 3 周,该补啦', label: '回访', time: '今天' },
      { id: 3, type: 'c', title: '你有一张「满200减30」券到账', label: '券到账', time: '2天前' },
      { id: 4, type: 'd', title: '储值余额已到账,专属 9 折等你', label: '召回', time: '3天前' }
    ] : []
    this.setData({ list })
  }
})
