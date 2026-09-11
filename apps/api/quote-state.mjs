export { conversationCard, CARD_TEXT } from './conversation-card.mjs'   // D106:顾客卡句子转出口(local-server 已引本模块,不必再加 import 行)
/* 已报价状态机(店主 31p 开工令;方案=handoff/已报价状态机_实施小方案_2026-08-31l.md,三点核答照录)
   —— 会话=6h 静默切段(每店可配 1~72)/ 有效期 48h(可配 1~336,读时判)/ 四态读推导不另存状态列。
   实现细节一处报明:会话键**由 transcript 读推导**(不给 wechat_conversations 加列)——
   transcript 本身就是真相(append-only),少一份可腐化的状态;报价行钉 session_key(mark 时刻的会话键)。
   改价防线:同会话有效价不同 → 需 confirmOverride,句后端出人话;override 落 quote_price_changes 留痕。 */

/* 🔴 D106:会话列表每行右侧那枚小标 —— **后端出句出色,两端零判断**。
   色语言与横幅同一套(横幅说什么,小标就是什么颜色):
   已报价未过期=实色 / 已过期=警色 / 仅历史参考=灰 / none=**无标**(不是灰标,是根本没有)。
   文案具名导出,判据引用这里(店主 02y:被测对象是文案时引用唯一出处,不复制)。 */
export const QUOTE_BADGE = {
  quoted: { text: '已报价', tone: 'solid' },
  expired: { text: '已过期', tone: 'warn' },
  reference: { text: '历史报价', tone: 'muted' },
}
const badgeOf = (state) => QUOTE_BADGE[state] || null

export function createQuoteState(deps) {
  const { db, iso, apiError, parseJson, randomId, currentTenantId, moneyText } = deps

  function ensureSchema() {
    try { db.exec('ALTER TABLE quote_requests ADD COLUMN session_key TEXT') } catch (error) {
      if (!String(error.message || '').includes('duplicate column')) throw error
    }
    db.exec(`CREATE TABLE IF NOT EXISTS quote_price_changes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      conversation_id TEXT,
      quote_request_id TEXT NOT NULL,
      old_cents INTEGER NOT NULL,
      new_cents INTEGER NOT NULL,
      old_by TEXT,
      new_by TEXT,
      created_at TEXT NOT NULL
    )`)
  }

  function settingsOf(tid) {
    const read = (key, dft, min, max) => {
      const row = db.prepare('SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = ?').get(tid, key)
      const n = row ? Number(String(row.value).replace(/"/g, '')) : NaN
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dft
    }
    return { gapHours: read('session_gap_hours', 6, 1, 72), validHours: read('quote_valid_hours', 48, 1, 336) }
  }

  /* 会话键=本会话第一条消息的时刻(ISO)。从尾往前找第一个 >gap 的静默豁口 */
  function sessionKeyOf(convRow, now = new Date()) {
    const gapMs = settingsOf(convRow.tenant_id).gapHours * 3600 * 1000
    const t = parseJson(convRow.transcript_json) || []
    const times = t.map((m) => new Date(m.at || 0).getTime()).filter((x) => Number.isFinite(x) && x > 0)
    if (!times.length) return convRow.created_at || iso(now)
    /* 最后一条距今超豁口 → 顾客再来即新会话;但「当前会话」以最后活动为锚:静默期内仍属旧会话 */
    let start = times[0]
    for (let i = 1; i < times.length; i += 1) {
      if (times[i] - times[i - 1] > gapMs) start = times[i]
    }
    return new Date(start).toISOString()
  }

  function techNameOf(q, tid) {
    if (q.technician_id) {
      const t = db.prepare('SELECT name FROM technicians WHERE id = ? AND tenant_id = ?').get(q.technician_id, tid)
      if (t) return t.name
    }
    return String(q.quoted_by || '').split('@')[0] || '技师'
  }
  const hoursAgo = (at, now) => Math.max(0, Math.round((now.getTime() - new Date(at).getTime()) / 3600000))
  const daysAgo = (at, now) => Math.max(1, Math.round((now.getTime() - new Date(at).getTime()) / 86400000))
  /* 🔴 03r(店主从七态截图里记的队尾小病):横幅上写着「172 小时前」—— 人不会这么读时间。
     这个横幅原来两种单位并存:未过期走 hoursAgo、已过期/历史走 daysAgo,
     所以同一张卡上「172 小时前」和「2 天前」会并排出现,**同一件事两种说法**。
     收成一个出口:**不到 48 小时说小时,到了就说天**,四处横幅共用。 */
  const agoText = (at, now) => (hoursAgo(at, now) < 48 ? `${hoursAgo(at, now)} 小时前` : `${daysAgo(at, now)} 天前`)
  const cnWhen = (isoStr) => {
    const d = new Date(isoStr)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  /* 四态读推导(方案 §3):A 本次已报价 / B 已报价·已过期 / C 历史报价参考 / D 无 */
  function quoteStateOf(conversationId, tid, now = new Date()) {
    const conv = db.prepare('SELECT * FROM wechat_conversations WHERE id = ? AND tenant_id = ?').get(conversationId, tid)
    if (!conv) return { state: 'none', listBadge: null }
    const sk = sessionKeyOf(conv, now)
    const quoted = db.prepare(`SELECT * FROM quote_requests WHERE conversation_id = ? AND tenant_id = ?
      AND staff_price_cents IS NOT NULL AND quoted_at IS NOT NULL ORDER BY quoted_at DESC`).all(conversationId, tid)
    /* 归会话:钉过 session_key 的按键比;老行(没钉)按 quoted_at ≥ 会话起点归 */
    const inSession = quoted.filter((q) => q.session_key ? q.session_key === sk : String(q.quoted_at) >= sk)
    const latest = inSession[0]
    if (latest) {
      const expired = latest.expires_at && String(latest.expires_at) < iso(now)
      const price = moneyText(latest.staff_price_cents, tid)
      const who = techNameOf(latest, tid)
      if (!expired) {
        return {
          state: 'quoted', sessionKey: sk, quoteRequestId: latest.id, priceCents: latest.staff_price_cents, listBadge: badgeOf('quoted'),
          banner: `本次会话已报价 ${price} · ${who} · ${agoText(latest.quoted_at, now)} · 有效期至 ${latest.expires_at ? cnWhen(latest.expires_at) : '—'}`
        }
      }
      return {
        state: 'expired', sessionKey: sk, quoteRequestId: latest.id, priceCents: latest.staff_price_cents, listBadge: badgeOf('expired'),
        banner: `本次会话已报价(已过期)${price} · ${who} · ${agoText(latest.quoted_at, now)} — 需重新确认`
      }
    }
    const hist = quoted[0]
    if (hist) {
      return {
        state: 'reference', sessionKey: sk, quoteRequestId: hist.id, priceCents: hist.staff_price_cents, listBadge: badgeOf('reference'),
        banner: `历史报价参考:上次(${agoText(hist.quoted_at, now)})报过 ${moneyText(hist.staff_price_cents, tid)} · ${techNameOf(hist, tid)} — 本次尚未报价`
      }
    }
    return { state: 'none', sessionKey: sk, listBadge: null }   // none 态**无标**,不是灰标
  }

  /* mark-quoted 附加件:算会话键与有效期;改价防线(31p 追加句照录) */
  function onMarkQuoted({ quote, newCents, actor, confirmOverride, now = new Date() }) {
    const tid = currentTenantId()
    /* D132:读会话必须带租户(读写两道闸律)——同一个外部用户 id 在两家店各有一行 */
    const conv = quote.conversation_id ? db.prepare('SELECT * FROM wechat_conversations WHERE id = ? AND tenant_id = ?').get(quote.conversation_id, tid) : null
    const sk = conv ? sessionKeyOf(conv, now) : null
    const validHours = settingsOf(tid).validHours
    const expiresAt = iso(new Date(now.getTime() + validHours * 3600 * 1000))
    if (conv && sk) {
      const rival = db.prepare(`SELECT * FROM quote_requests WHERE conversation_id = ? AND tenant_id = ?
        AND staff_price_cents IS NOT NULL AND quoted_at IS NOT NULL AND id != ?
        ORDER BY quoted_at DESC`).all(quote.conversation_id, tid, quote.id)
        .filter((q) => (q.session_key ? q.session_key === sk : String(q.quoted_at) >= sk))
        .find((q) => (!q.expires_at || String(q.expires_at) >= iso(now)) && q.staff_price_cents !== newCents)
      if (rival) {
        if (!confirmOverride) {
          throw apiError(409, 'QUOTE_OVERRIDE_NEEDED',
            `本会话 ${agoText(rival.quoted_at, now)}已由 ${techNameOf(rival, tid)} 报价 ${moneyText(rival.staff_price_cents, tid)},确认要按新价 ${moneyText(newCents, tid)} 重报吗?`)
        }
        db.prepare(`INSERT INTO quote_price_changes (id, tenant_id, conversation_id, quote_request_id, old_cents, new_cents, old_by, new_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(randomId('qpc'), tid, quote.conversation_id, quote.id, rival.staff_price_cents, newCents, rival.quoted_by || '', actor || '', iso(now))
      }
    }
    return { sessionKey: sk, expiresAt }
  }

  /* AI 改口句唯一常量(31p 条件:入 kb 平台层 + 单独断言;注入点下批落,句先立此为真相) */
  const EXPIRED_REPRICE_SENTENCE = '上次报价已过期,我帮您重新确认。'

  return { ensureSchema, settingsOf, sessionKeyOf, quoteStateOf, onMarkQuoted, EXPIRED_REPRICE_SENTENCE }
}
