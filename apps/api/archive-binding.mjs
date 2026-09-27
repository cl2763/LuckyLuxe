// A binding ticket identifies a profile. Only a verified WeChat code proves identity.
// No names, client-supplied openids, balances or transactions are merged here.
export async function bindingIdentity({body, fetchCode, apiError, fallback}) {
  const code = String(body.code || '').trim()
  if (!code) return fallback()
  const hop = await fetchCode(code)
  if (hop.ok === false || hop.data?.errcode || !hop.data?.openid) {
    throw apiError(401, 'WECHAT_LOGIN_FAILED', '微信身份验证失败，请重新确认。')
  }
  return {sandbox: false, openid: hop.data.openid, unionId: hop.data.unionid || ''}
}

// Only a blank registration may be replaced by the specific profile the customer
// has explicitly confirmed. Any business reference or imported history vetoes it.
export function releaseEmptyRegistration(db, sourceId, target, openid) {
  const source = db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(sourceId, target.tenant_id)
  if (!source || source.wechat_open_id !== openid || source.email || source.google_id || source.notes || source.birthday || source.is_migrated || source.legacy_total_spend_cents) return false
  if (source.phone && target.phone && source.phone !== target.phone) return false
  if (JSON.parse(source.tags_json || '[]').some(t => t !== '无手机号')) return false
  const identities = db.prepare('SELECT * FROM user_identities WHERE user_id=?').all(sourceId)
  if (!identities.length || identities.some(i => i.provider !== 'wechat_miniprogram' || i.provider_user_id !== openid)) return false
  const quote = s => '"' + s.replaceAll('"', '""') + '"'
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
  for (const {name} of tables) {
    if (name === 'users' || name === 'user_identities') continue
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all()
      .filter(c => /user_id|customer_id|payer_id/.test(c.name)).map(c => c.name)
    for (const column of columns) {
      if (db.prepare(`SELECT 1 FROM ${quote(name)} WHERE ${quote(column)}=? LIMIT 1`).get(sourceId)) return false
    }
  }
  if (!target.phone && source.phone) {
    target.phone=source.phone
    db.prepare('UPDATE users SET phone=?,tags_json=? WHERE id=?').run(source.phone,JSON.stringify(JSON.parse(target.tags_json||'[]').filter(t=>t!=='无手机号')),target.id)
  }
  if (!target.avatar_url && source.avatar_url) db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(source.avatar_url,target.id)
  db.prepare('DELETE FROM user_identities WHERE user_id=?').run(sourceId)
  db.prepare('DELETE FROM users WHERE id=? AND tenant_id=?').run(sourceId, target.tenant_id)
  return true
}

export function createVerifiedPhoneCompletion({db,apiError,claim,serialize,auth,unboundSql}) {
  return (customerId, phone) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const current = db.prepare('SELECT * FROM users WHERE id=?').get(customerId)
      if (!current?.wechat_open_id) throw apiError(403,'WECHAT_LOGIN_REQUIRED','请先用微信登录。')
      const candidates = db.prepare(`SELECT u.* FROM users u WHERE u.tenant_id=? AND u.phone=? AND u.id<>?
        AND (u.wechat_open_id IS NULL OR u.wechat_open_id='') AND ${unboundSql('u')}`).all(current.tenant_id,phone,customerId)
      if (candidates.length>1) throw apiError(409,'PROFILE_AMBIGUOUS','本店有多份同手机号档案，请让店员核对后出示指定档案的绑定码。')
      let id=customerId
      if (candidates.length===1) {
        const out=claim({tenantId:current.tenant_id,userId:candidates[0].id,providerUserId:current.wechat_open_id,allowEmptyRegistration:true})
        if (!out.bound) throw apiError(409,'PROFILE_CONFLICT','你的微信账户与门店原档案都有记录，请联系门店核对；系统不会自动合并余额或订单。')
        id=candidates[0].id
      }
      const row=db.prepare('SELECT * FROM users WHERE id=?').get(id)
      const tags=JSON.parse(row.tags_json||'[]').filter(t=>t!=='无手机号')
      db.prepare('UPDATE users SET phone=?,tags_json=? WHERE id=?').run(phone,JSON.stringify(tags),id)
      const user=serialize(db.prepare('SELECT * FROM users WHERE id=?').get(id),current.tenant_id)
      const out={ok:true,phone,needPhone:false,tenantId:current.tenant_id,user,auth:auth(user,current.wechat_open_id)}
      db.exec('COMMIT');return out
    }catch(e){db.exec('ROLLBACK');throw e}
  }
}
