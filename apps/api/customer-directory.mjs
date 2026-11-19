// Merchant directory: preserve customer identity; add separate per-store labels.
export function listAdminCustomers({db,currentTenantId,lastCustomerVisitAt,customerSpendCents,visitDaysCount,localParts,tenantTimezone,parseJson,storedValueBalanceCents,memberCodeForUserId,isMemberOf,membershipForSpend,customerRemarks},includeArchived=false) {
  const tid = currentTenantId()
  /* 🔴 D35(2026-08-12 核查二抓获):原来默认店(旗舰)不加任何过滤=全库所有租户用户大杂烩,
     lucky-luxe 客户库能看到 jics 沙盒店手测建的「666/899」——单租户时代遗产,租户红线违例。
     统一口径(所有租户同一条):本店档案(u.tenant_id=本店)∪ 在本店有预约/储值的档案。 */
  const esc = tid.replace(/'/g, "''")
  /* 口径与结算卡主门一致:严格 users.tenant_id = 本店(单一规则,三处同源:客户列表/排单校验/卡主校验)。
     「本店有活动但档案挂别店」不再放行 —— 那正是串味的形状,该修档案归属而不是放行显示。 */
  const activityFilter = `
    WHERE u.tenant_id = '${esc}' ${includeArchived?'':"AND NOT EXISTS(SELECT 1 FROM record_lifecycle a WHERE a.tenant_id=u.tenant_id AND a.kind='customers' AND a.record_id=u.id AND a.status='archived')"}`
  return db.prepare(`
    SELECT
      u.id,
      u.display_name,
      u.phone,
      u.email,
      u.tags_json,
      u.notes,
      u.birthday,
      NULL AS created_at,
      COUNT(b.id) AS visit_count,
      COALESCE(SUM(CASE WHEN b.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed_count,
      MIN(CASE WHEN b.status = 'COMPLETED' THEN b.appointment_start END) AS first_visit_at,
      MAX(CASE WHEN b.status = 'COMPLETED' THEN b.appointment_start END) AS last_completed_at
    FROM users u
    LEFT JOIN bookings b ON b.user_id = u.id AND b.tenant_id = ?
    ${activityFilter}
    GROUP BY u.id
    ORDER BY LOWER(u.display_name) ASC
  `).all(tid).map((row) => {
    const lastVisitAt = lastCustomerVisitAt(db, row.id, tid)
    const totalSpentCents = customerSpendCents(db, row.id, tid)
    return ({
    id: row.id,
    displayName: row.display_name,
    remarkName: customerRemarks.read(tid,row.id),
    merchantDisplayName: customerRemarks.read(tid,row.id) || row.display_name,
    phone: row.phone,
    email: row.email,
    createdAt: row.created_at,
    visitCount: visitDaysCount(row.id, tid), // 裁A/裁D:与顾客端同一出口(旧=COUNT 全部预约,取消也算到店)
    lastVisitAt,
    lastVisitDate: lastVisitAt ? localParts(new Date(lastVisitAt), tenantTimezone(tid)).date : null,
    totalSpentCents,
    // RFM 分层用(按完成单口径)
    completedCount: row.completed_count || 0,
    firstVisitAt: row.first_visit_at || null,
    lastCompletedAt: row.last_completed_at || null,
    tags: parseJson(row.tags_json) || [],
    notes: row.notes || '',
    birthday: row.birthday || '',
    acquisitionSource: row.acquisition_source || '',
    originalJoinedDate: row.original_joined_date || '',
    storedValueBalanceCents: storedValueBalanceCents(row.id),
    memberCode: memberCodeForUserId(row.id),
    // 等级单源(F3)+D41:分级店按租户梯子;不分级店=充值即会员(member/guest),消费不算
    isMember: isMemberOf(row.id, tid),
    memberTier: (() => {
      const ms = membershipForSpend(totalSpentCents, tid)
      if (ms.memberTiers.length) return ms.memberTier
      return isMemberOf(row.id, tid) ? 'member' : 'guest'
    })()
    })
  })
}
