Page({
  data: { list: [] },
  onShow() {
    // 演示数据:正式版由后端站内消息表返回(预约/回访/发券/召回写入)
    const list = [
      { id: 1, type: 'a', title: '明天 15:30 有预约,记得到店哦', label: '预约提醒', time: '1小时前' },
      { id: 2, type: 'b', title: '补甲提醒:上次美甲已 3 周,该补啦', label: '回访', time: '今天' },
      { id: 3, type: 'c', title: '你有一张「满200减30」券到账', label: '券到账', time: '2天前' },
      { id: 4, type: 'd', title: '储值 $1,240,专属 9 折等你', label: '召回', time: '3天前' }
    ]
    this.setData({ list })
  }
})
