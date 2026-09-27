export const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
export function dateValue(v,apiError) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(`${v}T12:00:00Z`)) || new Date(`${v}T12:00:00Z`).toISOString().slice(0,10) !== v) throw apiError(400,'BAD_REQUEST','日期必须是真实日期，格式 YYYY-MM-DD。')
    return v
  }

export function specialDateInput(body,apiError) {
  dateValue(body.date,apiError)
  if(body.isClosed!==undefined && typeof body.isClosed!=='boolean')throw apiError(400,'BAD_REQUEST','店休状态应为布尔值。')
  const closed=body.isClosed===undefined?true:body.isClosed
  if(!closed&&(!isTime(body.openTime)||!isTime(body.closeTime)||body.openTime>=body.closeTime))throw apiError(400,'BAD_REQUEST','营业时间须为有效 HH:MM，结束晚于开始。')
  return closed
}
