const store = {
  storeName: 'Lucky Luxe',
  address: '门店地址待补充',
  phone: '门店电话待补充',
  businessHours: '营业时间待补充',
  latitude: 39.9042,
  longitude: 116.4074,
  description: '以美甲与美睫为核心的高端美业体验空间，演示版暂用占位门店信息。'
}

const nailCategories = ['热门推荐', '法式系列', '轻奢设计', '日式款', '基础护理', '加项服务']
const lashCategories = ['热门推荐', '自然款', '浓密款', '下睫毛', '卸除护理', '加项服务']

const services = [
  {
    _id: 'nail-french-01',
    type: 'nail',
    category: '法式系列',
    name: '经典奶油法式',
    description: '柔和奶油底色搭配细线法式边，适合通勤与约会场景。',
    price: 168,
    depositAmount: 50,
    duration: 90,
    suitableFor: '喜欢干净、显手修长、低调精致风格的客人。',
    imageLabel: 'Nail · 法式系列',
    image: '/assets/images/nail-french.png',
    process: ['甲型修整', '基础护理', '底色上色', '法式线条', '封层护理'],
    notice: ['服务前请尽量避免自行修剪过短', '如需卸甲请在预约时勾选加项'],
    isRecommended: true,
    sort: 1,
    status: 'active'
  },
  {
    _id: 'nail-luxe-01',
    type: 'nail',
    category: '轻奢设计',
    name: '柔金贝母设计',
    description: '贝母片与柔金线条组合，保留高级感，也适合日常穿搭。',
    price: 238,
    depositAmount: 50,
    duration: 120,
    suitableFor: '想要一点亮点，但不喜欢过度夸张款式的客人。',
    imageLabel: 'Nail · 轻奢设计',
    image: '/assets/images/nail-luxe.png',
    process: ['甲面护理', '底色铺设', '贝母定位', '金线装饰', '加固封层'],
    notice: ['复杂设计耗时较长，请预留完整服务时间'],
    isRecommended: true,
    sort: 2,
    status: 'active'
  },
  {
    _id: 'nail-jp-01',
    type: 'nail',
    category: '日式款',
    name: '日式微闪渐变',
    description: '细腻微闪从甲根自然过渡，温柔显白，适合短甲。',
    price: 198,
    depositAmount: 50,
    duration: 100,
    suitableFor: '偏爱自然、干净、显气色风格的客人。',
    imageLabel: 'Nail · 日式款',
    image: '/assets/images/nail-jp.png',
    process: ['手部清洁', '甲型调整', '渐变叠色', '微闪点缀', '封层'],
    notice: ['渐变色可到店根据肤色调整'],
    isRecommended: true,
    sort: 3,
    status: 'active'
  },
  {
    _id: 'nail-care-01',
    type: 'nail',
    category: '基础护理',
    name: '手部基础护理',
    description: '修型、软化、死皮护理与营养油养护，适合定期维护。',
    price: 88,
    depositAmount: 50,
    duration: 45,
    suitableFor: '需要快速整理甲型与手部状态的客人。',
    imageLabel: 'Nail · 基础护理',
    image: '/assets/images/nail-care.png',
    process: ['清洁消毒', '修型', '软化护理', '死皮修整', '营养油'],
    notice: ['此项目不含甲油胶上色'],
    isRecommended: false,
    sort: 4,
    status: 'active'
  },
  {
    _id: 'nail-addon-01',
    type: 'nail',
    category: '加项服务',
    name: '卸甲与甲面修护',
    description: '温和卸除旧甲并进行甲面基础修护。',
    price: 58,
    depositAmount: 50,
    duration: 35,
    suitableFor: '已有旧甲，需要在新款前处理的客人。',
    imageLabel: 'Nail · 加项服务',
    image: '/assets/images/nail-addon.png',
    process: ['旧甲评估', '温和卸除', '甲面抛磨', '营养护理'],
    notice: ['厚重延长甲可能需要增加处理时间'],
    isRecommended: false,
    sort: 5,
    status: 'active'
  },
  {
    _id: 'lash-natural-01',
    type: 'lash',
    category: '自然款',
    name: '裸感自然睫',
    description: '轻盈自然，放大眼神但保留原生感。',
    price: 198,
    depositAmount: 50,
    duration: 90,
    suitableFor: '第一次尝试美睫或偏爱淡妆效果的客人。',
    imageLabel: 'Lash · 自然款',
    image: '/assets/images/lash-natural.png',
    process: ['眼型沟通', '清洁隔离', '睫毛嫁接', '梳理定型', '护理说明'],
    notice: ['服务后 6 小时内尽量避免接触水汽'],
    isRecommended: true,
    sort: 1,
    status: 'active'
  },
  {
    _id: 'lash-volume-01',
    type: 'lash',
    category: '浓密款',
    name: '轻盈浓密睫',
    description: '在自然舒适的基础上增强存在感，适合拍照和重要场合。',
    price: 268,
    depositAmount: 50,
    duration: 120,
    suitableFor: '希望眼妆感更明显，但不想压眼的客人。',
    imageLabel: 'Lash · 浓密款',
    image: '/assets/images/lash-volume.png',
    process: ['眼型设计', '分层嫁接', '密度调整', '梳理检查', '护理说明'],
    notice: ['敏感眼型请提前备注'],
    isRecommended: true,
    sort: 2,
    status: 'active'
  },
  {
    _id: 'lash-lower-01',
    type: 'lash',
    category: '下睫毛',
    name: '下睫毛精修',
    description: '补足下眼线氛围，提升眼妆完整度。',
    price: 98,
    depositAmount: 50,
    duration: 45,
    suitableFor: '希望眼睛更有层次、妆感更完整的客人。',
    imageLabel: 'Lash · 下睫毛',
    image: '/assets/images/lash-lower.png',
    process: ['下睫毛评估', '清洁隔离', '精细嫁接', '梳理定型'],
    notice: ['下睫毛保持周期通常短于上睫毛'],
    isRecommended: false,
    sort: 3,
    status: 'active'
  },
  {
    _id: 'lash-remove-01',
    type: 'lash',
    category: '卸除护理',
    name: '睫毛卸除护理',
    description: '温和卸除旧睫毛并完成清洁护理。',
    price: 68,
    depositAmount: 50,
    duration: 35,
    suitableFor: '需要卸除旧睫或重新设计睫毛状态的客人。',
    imageLabel: 'Lash · 卸除护理',
    image: '/assets/images/lash-remove.png',
    process: ['旧睫检查', '卸除', '眼周清洁', '护理建议'],
    notice: ['请勿自行拉扯旧睫毛'],
    isRecommended: false,
    sort: 4,
    status: 'active'
  }
]

const addOns = [
  { id: 'remove', name: '卸甲/卸睫', price: 30 },
  { id: 'reinforce', name: '甲面加固', price: 40 },
  { id: 'senior', name: '指定资深技师', price: 60 },
  { id: 'extend', name: '延长加项时间', price: 50 }
]

const timeSlots = ['10:00', '11:00', '13:00', '14:30', '16:00', '17:30', '19:00']

function findService(id) {
  return services.find((item) => item._id === id)
}

function getRecommended(type) {
  return services.filter((item) => item.type === type && item.isRecommended)
}

module.exports = {
  store,
  nailCategories,
  lashCategories,
  services,
  addOns,
  timeSlots,
  findService,
  getRecommended
}
