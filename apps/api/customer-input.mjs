export function validateCustomerInput(body, apiError) {
  const name = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  if (!name || [...name].length > 40) throw apiError(400,'BAD_REQUEST','顾客姓名必填，最多 40 个字。')
  if (body.phone != null && typeof body.phone !== 'string') throw apiError(400,'BAD_REQUEST','联系方式应为文字。')
  if (phone && (!/^[+\d\s()-]+$/.test(phone) || phone.length > 32 || (phone.match(/\d/g)||[]).length < 5)) throw apiError(400,'BAD_REQUEST','请填写有效联系电话，或留空。')
  return { displayName:name, phone }
}
