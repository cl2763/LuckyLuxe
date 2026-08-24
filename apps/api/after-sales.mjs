/* 售后域(从 local-server.mjs 原样搬出,行为一字未改 —— 店主 2026-08-24 公约②「边改边拆」)。

   状态机:待处理 pending → 处理中 processing → 已解决 resolved / 已关闭 closed。
   状态由后端唯一持有,三端(员工端/网页端/顾客端)读同一份(B⓪);
   时间线 append-only,每条带时间+操作人(B④);涉钱零新路径(B②);原单快照不动(B③)。

   为什么用注入不用 import:公共件(db / currentTenantId / tenantTimezone / localParts)都还住在
   local-server.mjs 里,直接 import 会成环。等后续批把公共件也拆出去,这里可以改成普通 import。 */

export const AFTER_SALES_STATUS_TEXT = { pending: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭' }

export function createAfterSales({ db, currentTenantId, tenantTimezone, localParts }) {
  function afterSalesState(row) {
    const tid = row.tenant_id || currentTenantId()
    const tz = tenantTimezone(tid)
    const stamp = (at) => {
      if (!at) return ''
      const p = localParts(new Date(at), tz)
      return `${p.date.slice(5)} ${p.time.slice(0, 5)}`
    }
    const status = row.after_sales_status || 'pending'   // 存量售后单没写过状态 = 待处理
    const events = db.prepare('SELECT * FROM after_sales_events WHERE booking_id = ? ORDER BY created_at ASC').all(row.id)
    // 批③首件 B5:结案后可再次发起(重开)——发起原因取**当前这轮**(最近一次转入);历史轮留痕不丢(append-only)
    const hist = db.prepare("SELECT note, created_at FROM booking_status_history WHERE booking_id = ? AND to_status = 'AFTER_SALES' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(row.id)
    const timeline = []
    if (!events.some((e) => e.kind === 'open')) {
      timeline.push({ at: stamp((hist && hist.created_at) || row.updated_at), kind: 'open', text: (hist && hist.note) || '顾客发起售后', actor: '顾客' })
    }
    for (const e of events) timeline.push({ at: stamp(e.created_at), kind: e.kind, text: e.text || '', actor: e.actor_name || '', relatedCode: e.related_code || '' })
    return {
      status,
      statusText: AFTER_SALES_STATUS_TEXT[status] || status,
      reason: (hist && hist.note) || '',
      timeline,
      resultText: row.after_sales_result || ''
    }
  }

  // 顾客端三步卡(既有 D3 设计)由真实状态机驱动 —— 同一个事实三端说同一句话
  function afterSalesProgress(row) {
    const s = afterSalesState(row)
    const raised = s.timeline[0] || {}
    const progresses = s.timeline.filter((e) => e.kind === 'progress')
    const lastProgress = progresses[progresses.length - 1]
    const closer = s.timeline.filter((e) => e.kind === 'resolve' || e.kind === 'close').pop()
    const terminal = s.status === 'resolved' || s.status === 'closed'
    return {
      title: s.statusText === '待处理' || s.statusText === '处理中' ? '售后中' : `售后${s.statusText}`,
      status: s.status,
      statusText: s.statusText,
      reason: s.reason,
      steps: [
        { key: 'raised', label: '发起售后(联系客服)', at: raised.at || '', done: true },
        {
          key: 'following',
          label: lastProgress ? `门店跟进:${lastProgress.text}` : '已转人工,门店跟进中',
          at: lastProgress ? lastProgress.at : (raised.at || ''),
          done: true
        },
        {
          key: 'result',
          label: s.status === 'resolved'
            ? `已解决:${s.resultText}`
            : (s.status === 'closed' ? `已关闭${closer && closer.text ? `:${closer.text}` : ''}` : '处理结果(完成后显示说明)'),
          at: terminal && closer ? closer.at : '—',
          done: terminal
        }
      ],
      timeline: s.timeline,
      resultText: s.status === 'resolved' ? s.resultText : '',
      footnote: terminal
        ? '本单售后已完成;涉及退款的,退款凭据记在关联的更正单内。'
        : '处理完成后此卡状态变「售后已解决」并显示结果说明;涉及退款的,退款凭据记在关联的更正单内。'
    }
  }

  return { afterSalesState, afterSalesProgress }
}
