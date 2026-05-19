import { PrismaClient, ServiceType } from '@prisma/client'

const prisma = new PrismaClient()

const services = [
  {
    id: 'nail-french-01',
    type: ServiceType.NAIL,
    category: '法式系列',
    nameZh: '经典奶油法式',
    nameEn: 'Classic Cream French',
    descriptionZh: '柔和奶油底色搭配细线法式边，适合通勤与约会场景。',
    descriptionEn: 'Soft cream base with a delicate French line for daily wear and special dates.',
    imageUrl: '/assets/images/nail-french.png',
    priceCents: 16800,
    baseDurationMin: 120,
    sortOrder: 1,
    processJson: JSON.stringify(['甲型修整', '基础护理', '底色上色', '法式线条', '封层护理']),
    noticeJson: JSON.stringify(['服务前请尽量避免自行修剪过短', '如需卸甲请在预约时勾选加项'])
  },
  {
    id: 'nail-luxe-01',
    type: ServiceType.NAIL,
    category: '轻奢设计',
    nameZh: '柔金贝母设计',
    nameEn: 'Soft Gold Shell Design',
    descriptionZh: '贝母片与柔金线条组合，保留高级感，也适合日常穿搭。',
    descriptionEn: 'Mother-of-pearl accents and soft gold lines for an elevated everyday style.',
    imageUrl: '/assets/images/nail-luxe.png',
    priceCents: 23800,
    baseDurationMin: 150,
    sortOrder: 2,
    processJson: JSON.stringify(['甲面护理', '底色铺设', '贝母定位', '金线装饰', '加固封层']),
    noticeJson: JSON.stringify(['复杂设计耗时较长，请预留完整服务时间'])
  },
  {
    id: 'nail-jp-01',
    type: ServiceType.NAIL,
    category: '日式款',
    nameZh: '日式微闪渐变',
    nameEn: 'Japanese Shimmer Gradient',
    descriptionZh: '细腻微闪从甲根自然过渡，温柔显白，适合短甲。',
    descriptionEn: 'A subtle shimmer gradient that looks soft, clean, and flattering on short nails.',
    imageUrl: '/assets/images/nail-jp.png',
    priceCents: 19800,
    baseDurationMin: 120,
    sortOrder: 3,
    processJson: JSON.stringify(['手部清洁', '甲型调整', '渐变叠色', '微闪点缀', '封层']),
    noticeJson: JSON.stringify(['渐变色可到店根据肤色调整'])
  },
  {
    id: 'nail-care-01',
    type: ServiceType.NAIL,
    category: '基础护理',
    nameZh: '手部基础护理',
    nameEn: 'Basic Hand Care',
    descriptionZh: '修型、软化、死皮护理与营养油养护，适合定期维护。',
    descriptionEn: 'Shape, soften, clean cuticles, and nourish for regular maintenance.',
    imageUrl: '/assets/images/nail-care.png',
    priceCents: 8800,
    baseDurationMin: 120,
    sortOrder: 4,
    processJson: JSON.stringify(['清洁消毒', '修型', '软化护理', '死皮修整', '营养油']),
    noticeJson: JSON.stringify(['此项目不含甲油胶上色'])
  },
  {
    id: 'lash-natural-01',
    type: ServiceType.LASH,
    category: '自然款',
    nameZh: '裸感自然睫',
    nameEn: 'Bare Natural Lash',
    descriptionZh: '轻盈自然，放大眼神但保留原生感。',
    descriptionEn: 'Light, natural lashes that open the eyes while keeping a bare-skin look.',
    imageUrl: '/assets/images/lash-natural.png',
    priceCents: 19800,
    baseDurationMin: 120,
    sortOrder: 1,
    processJson: JSON.stringify(['眼型沟通', '清洁隔离', '睫毛嫁接', '梳理定型', '护理说明']),
    noticeJson: JSON.stringify(['服务后 6 小时内尽量避免接触水汽'])
  },
  {
    id: 'lash-volume-01',
    type: ServiceType.LASH,
    category: '浓密款',
    nameZh: '轻盈浓密睫',
    nameEn: 'Soft Volume Lash',
    descriptionZh: '在自然舒适的基础上增强存在感，适合拍照和重要场合。',
    descriptionEn: 'Comfortable volume with stronger presence for photos and special occasions.',
    imageUrl: '/assets/images/lash-volume.png',
    priceCents: 26800,
    baseDurationMin: 120,
    sortOrder: 2,
    processJson: JSON.stringify(['眼型设计', '分层嫁接', '密度调整', '梳理检查', '护理说明']),
    noticeJson: JSON.stringify(['敏感眼型请提前备注'])
  }
]

async function main() {
  const store = await prisma.store.upsert({
    where: { id: 'store-ontario-01' },
    update: {},
    create: {
      id: 'store-ontario-01',
      name: 'Lucky Luxe Ontario',
      timezone: 'America/Toronto',
      currency: 'CAD',
      address: 'Address TBD',
      phone: 'Phone TBD'
    }
  })

  for (let weekday = 0; weekday <= 6; weekday += 1) {
    await prisma.businessHour.upsert({
      where: { storeId_weekday: { storeId: store.id, weekday } },
      update: {},
      create: {
        storeId: store.id,
        weekday,
        openTime: '10:00',
        closeTime: '19:00',
        isClosed: weekday === 1
      }
    })
  }

  const technicians = [
    { id: 'tech-mia', name: 'Mia Chen', title: 'Nail Artist' },
    { id: 'tech-ava', name: 'Ava Lin', title: 'Lash Artist' },
    { id: 'tech-lina', name: 'Lina Zhou', title: 'Senior Artist' }
  ]

  for (const tech of technicians) {
    await prisma.technician.upsert({
      where: { id: tech.id },
      update: {},
      create: { ...tech, storeId: store.id }
    })
  }

  for (const service of services) {
    await prisma.service.upsert({
      where: { id: service.id },
      update: service,
      create: { ...service, depositCents: 5000 }
    })
  }

  const nailServices = services.filter((item) => item.type === ServiceType.NAIL)
  const lashServices = services.filter((item) => item.type === ServiceType.LASH)
  const assignments = [
    ...nailServices.map((service) => ({ technicianId: 'tech-mia', serviceId: service.id })),
    ...nailServices.map((service) => ({ technicianId: 'tech-lina', serviceId: service.id })),
    ...lashServices.map((service) => ({ technicianId: 'tech-ava', serviceId: service.id })),
    ...lashServices.map((service) => ({ technicianId: 'tech-lina', serviceId: service.id }))
  ]

  for (const assignment of assignments) {
    await prisma.technicianService.upsert({
      where: { technicianId_serviceId: assignment },
      update: {},
      create: assignment
    })
  }

  await prisma.user.upsert({
    where: { wechatOpenId: 'demo-wechat-openid' },
    update: {},
    create: {
      displayName: 'Lucky Member',
      phone: '+1 000 000 0000',
      wechatOpenId: 'demo-wechat-openid'
    }
  })
}

main()
  .then(async () => {
    await prisma.$disconnect()
    console.log('Seed completed.')
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
