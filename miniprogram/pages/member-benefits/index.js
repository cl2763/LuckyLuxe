const api = require('../../utils/api')
const i18n = require('../../utils/i18n')

const BENEFITS_ZH = {
  silver: {
    note: '基础会员等级，适合首次体验与偶尔到店顾客。',
    benefits: ['会员档案与作品留档', '护理说明与售后提醒', '消费累计成长值', '预约需支付 CAD $50 定金'],
    gifts: ['新人护理说明', '基础会员档案']
  },
  gold: {
    note: '累计消费达到 CAD $500 后解锁，预约可免定金。',
    benefits: ['预约免 CAD $50 定金', '生日月礼遇', '优先查看护理建议', '推荐返利记录'],
    gifts: ['生日月优惠券', 'VIP 护理提醒']
  },
  platinum: {
    note: '累计消费达到 CAD $1200 后解锁，适合高频到店顾客。',
    benefits: ['预约免定金', '优先预约热门时段', '更完整作品档案', '季度护理建议'],
    gifts: ['季度护理礼包', '优先指定技师']
  },
  diamond: {
    note: '累计消费达到 CAD $2500 后解锁，当前最高会员等级。',
    benefits: ['预约免定金', '最高等级会员标识', '优先排期与服务提醒', '专属复购/护理回访'],
    gifts: ['Diamond 专属礼遇', '节日福利提醒']
  }
}

const BENEFITS_EN = {
  silver: {
    note: 'Entry tier for first-time and occasional guests.',
    benefits: ['Member profile and work archive', 'Aftercare and follow-up reminders', 'Growth value from completed services', 'CAD $50 booking deposit required'],
    gifts: ['New member aftercare guide', 'Basic member profile']
  },
  gold: {
    note: 'Unlocked at CAD $500 lifetime spend. Booking deposit is waived.',
    benefits: ['CAD $50 deposit waived', 'Birthday-month perk', 'Priority aftercare suggestions', 'Referral reward tracking'],
    gifts: ['Birthday-month coupon', 'VIP aftercare reminder']
  },
  platinum: {
    note: 'Unlocked at CAD $1200 lifetime spend for frequent guests.',
    benefits: ['Deposit waived', 'Priority popular time slots', 'Richer work archive', 'Seasonal care suggestions'],
    gifts: ['Seasonal care package', 'Priority artist request']
  },
  diamond: {
    note: 'Unlocked at CAD $2500 lifetime spend. Current highest tier.',
    benefits: ['Deposit waived', 'Highest member badge', 'Priority scheduling and reminders', 'Dedicated repurchase follow-up'],
    gifts: ['Diamond exclusive perk', 'Holiday perk reminder']
  }
}

Page({
  data: {
    lang: 'zh',
    member: {},
    currentLevelIndex: 0,
    levels: [],
    benefits: [],
    gifts: []
  },

  onShow() {
    const lang = i18n.getLang()
    const member = Object.assign(api.miniMember({}), wx.getStorageSync('lucky_member') || {})
    const levels = this.getLevels(lang, member)
    const currentLevelIndex = Math.max(0, levels.findIndex((item) => item.key === member.memberTier))
    const activeLevel = levels[currentLevelIndex] || levels[0]
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'Member Benefits' : '会员权益' })
    this.setData({
      lang,
      member,
      currentLevelIndex,
      levels,
      benefits: activeLevel.benefits,
      gifts: activeLevel.gifts
    })
  },

  onLevelChange(event) {
    const currentLevelIndex = event.detail.current
    const level = this.data.levels[currentLevelIndex]
    if (!level) return
    this.setData({
      currentLevelIndex,
      benefits: level.benefits,
      gifts: level.gifts
    })
  },

  getLevels(lang, member) {
    const copy = lang === 'en' ? BENEFITS_EN : BENEFITS_ZH
    const tiers = member.memberTiers && member.memberTiers.length ? member.memberTiers : api.MEMBER_TIERS
    const currentIndex = Math.max(0, tiers.findIndex((item) => item.key === member.memberTier))
    const spend = Number(member.growthValue || 0)
    return tiers.map((tier, index) => {
      const nextSpend = tier.nextSpend
      const tierCopy = copy[tier.key] || copy.silver
      const isCurrent = tier.key === member.memberTier
      const progress = nextSpend
        ? Math.min(100, Math.max(0, Math.round(((spend - tier.minSpend) / (nextSpend - tier.minSpend)) * 100)))
        : 100
      return {
        key: tier.key,
        name: tier.label,
        threshold: nextSpend
          ? `CAD $${tier.minSpend}+`
          : (lang === 'en' ? 'Highest tier' : '最高等级'),
        note: tierCopy.note,
        progress: index < currentIndex ? 100 : (isCurrent ? progress : 0),
        statusText: isCurrent
          ? (lang === 'en' ? 'Current tier' : '当前等级')
          : (spend >= tier.minSpend ? (lang === 'en' ? 'Unlocked' : '已解锁') : `${lang === 'en' ? 'Need' : '还差'} CAD $${tier.minSpend - spend}`),
        depositText: tier.depositWaived
          ? (lang === 'en' ? 'Deposit waived' : '免预约定金')
          : (lang === 'en' ? 'CAD $50 deposit required' : '需支付 CAD $50 定金'),
        benefits: tierCopy.benefits.map((title) => ({ title })),
        gifts: tierCopy.gifts.map((title, giftIndex) => ({ count: String(giftIndex + 1), title }))
      }
    })
  }
})
