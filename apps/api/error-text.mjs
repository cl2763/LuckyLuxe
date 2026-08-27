/* 报错话的中文出口(2026-08-27,店主走查第 ③ 处顺带点名:「那句报错还是英文,产品其余都是中文」)。

   现状:全仓 262 句 apiError 的 message 是英文,其中「Owner permission is required.」一句就有 73 处。
   逐个改 262 处 = 262 次改错的机会,而且下次谁再写一句英文照样漏。
   所以收在**一个出口**:错误响应那一层过一次翻译表 —— 加新话时只动这张表。

   只翻**商家/顾客真会看到**的那些;开发口径的 500 原文保留(它给的是排障线索,不是给人看的话)。 */
const MAP = {
  'Owner permission is required.': '这一项只有老板能操作。',
  'Admin login is required.': '请先登录商家后台。',
  'Customer login is required before booking or payment.': '预约或支付前请先登录。',
  'Platform token required.': '需要平台令牌。',
  'Staff can only access their own bookings.': '员工只能查看自己的预约。',
  'Tenant not found.': '找不到这家店。',
  'Booking not found.': '找不到这条预约。',
  'Member not found.': '找不到这位顾客。',
  'Store not found in this shop.': '这家店下没有这个门店。',
  'Service not found.': '找不到这个服务项目。',
  'Endpoint not found.': '这个接口不存在。',
  'A positive amount is required.': '金额必须大于 0。',
  'Unexpected server error.': '服务出了点问题,请稍后再试。'
}

/* 兜底:按 code 给一句(message 没进表、但 code 认得出来的场合)。 */
const BY_CODE = {
  FORBIDDEN: '没有权限做这件事。',
  UNAUTHORIZED: '请先登录。',
  NOT_FOUND: '找不到这条记录。'
}

export function zhErrorText(code, message) {
  const m = String(message || '')
  if (MAP[m]) return MAP[m]
  // 还是英文(整句没有中日韩字符)且 code 认得 → 用 code 那句;否则原样返回(中文的本来就对)
  if (m && !/[一-龥]/.test(m) && BY_CODE[code]) return BY_CODE[code]
  return m
}

/* 审计用:全仓还剩多少句英文 message 没进表(断言拿它当判据,数字只许降不许升)。 */
export function englishMessagesIn(source) {
  const found = []
  for (const m of String(source).matchAll(/apiError\(\s*\d{3}\s*,\s*'[A-Z_]+'\s*,\s*'([^']+)'/g)) {
    const text = m[1]
    if (/[一-龥]/.test(text)) continue
    if (MAP[text]) continue
    found.push(text)
  }
  return found
}
