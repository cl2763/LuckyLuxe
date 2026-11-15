const STATUS_MAP = {
  CONFIRMED: { label: '待到店', cls: 'g' },
  PENDING_PAYMENT: { label: '待付定金', cls: 'n' },
  PENDING_DEPOSIT: { label: '待付定金', cls: 'n' },
  IN_PROGRESS: { label: '进行中', cls: 's' },
  SERVING: { label: '进行中', cls: 's' },
  COMPLETED: { label: '已完成', cls: 's' },
  DONE: { label: '已完成', cls: 's' },
  CANCELLED: { label: '已取消', cls: 'n' },
  CANCELED: { label: '已取消', cls: 'n' },
  AFTER_SALES: { label: '售后', cls: 'd' },
  PENDING_QUOTE: { label: '待报价', cls: 'd' },
  PENDING_STAFF: { label: '待报价', cls: 'd' }
}

function vm(b) {
  /* 🔴 D70 合同⑤(店主 08-24):售后是挂在已完成单上的**并行轨道**,不改写主状态。
     所以徽标不能只看主状态 —— 否则售后中的单在商家列表里显示「已完成」,
     店员看不出这单正在售后(网页端同刀,四之九)。 */
  const hasAs = Boolean(b.afterSalesStatus)
  /* 售后徽标的**字**由后端唯一持有(listBadgeText:售后中/售后已解决/售后已关闭),
     这里不再自己拼 —— 网页端早就读它,商家小程序自己写一份就是同事实两句话。 */
  const s = hasAs ? { label: b.listBadgeText || '售后', cls: 'd' }
    : (b.status === 'COMPLETED' && !b.payment
      ? { label: '服务结束 · 待结算', cls: 'n' }
      : (STATUS_MAP[b.status] || { label: b.status || '-', cls: 'n' }))
  const service = (b.service && b.service.name) || b.serviceName || '服务'
  const customer = b.customerName || b.userName || (b.customer && b.customer.name) || (b.user && b.user.displayName) || (b.user && b.user.display_name) || '顾客'
  const tech = b.technicianName || (b.technician && b.technician.name) || ''
  const dur = b.totalDurationMin ? `${(b.totalDurationMin / 60).toFixed(1).replace('.0', '')}h` : ''
  const hasImg = Array.isArray(b.referenceImages) && b.referenceImages.length > 0
  // 爽约定金处置徽标(图 A-1/A-3):待处置红 / 已留存绿 / 已没收灰;无收取记录不出(A⓪)
  const dd = b.depositDisposal || null
  const ddBadge = dd
    ? (dd.state === 'pending' ? `定金 ${dd.outstandingText} 待处置`
      : (dd.state === 'retain' ? '定金已留存 → 客户档案'
        : (dd.state === 'forfeit' || dd.state === 'auto_forfeit' ? `已没收入账 ${dd.amountText}` : '')))
    : ''
  return {
    id: b.id, status: b.status, date: b.appointmentDate || '', time: b.appointmentTime || '',
    statusLabel: b.noShowAt ? '已爽约' : s.label, statusCls: b.noShowAt ? 'n' : s.cls, customer, tech,
    userId: b.userId || (b.user && (b.user.id || b.user.sub)) || '',
    serviceId: b.serviceId || (b.service && b.service.id) || '', serviceName: service,
    technicianId: b.technicianId || (b.technician && b.technician.id) || '',
    thumb: hasImg ? b.referenceImages[0] : '',
    line: [service, dur].filter(Boolean).join(' · '),
    noShow: Boolean(b.noShowAt),
    ddState: dd ? dd.state : '',
    ddBadge,
    ddCls: dd && dd.state === 'pending' ? 'd' : (dd && dd.state === 'retain' ? 'g' : 'n'),
    asStatusText: b.afterSales ? b.afterSales.statusText : ''
  }
}

module.exports={STATUS_MAP,vm}
