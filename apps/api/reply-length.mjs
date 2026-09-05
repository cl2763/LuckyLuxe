/* 回复长度与「定金政策只说一次」(店主 05n 裁 (4);⑤ 像人五通病5)

   ══ 为什么光加提示词不够 ══
   「简洁一点」这种话模型时灵时不灵。提示词那一层已经写死了 120 字,
   但**说过的话有没有算数,得有人数** —— 否则下一次跑出来还是 4/5 通超长,
   而我们只能凭印象说「好像好点了」。所以出口这里再守一道:
   · 超长的**记一笔**(`/health.replyLength.tooLong`),数得出来才治得了;
   · 定金政策整段在**同一通对话里只放一次**,第二次起换成一句回指。

   ══ 为什么只记不砍 ══
   一刀截断会把话截得莫名其妙(「定金是 CAD $5」这种)。
   长度是**说话风格**问题,该在提示词治;这里的职责是**量它**,外加把
   「同一段政策说两遍」这一种确定性的重复真正掐掉。 */

const CJK = /[一-鿿]/

/* 中文按字数、英文按字符数各有一条线 —— 一句 200 字符的英文和 200 字的中文不是一回事 */
export function isTooLong(text = '', { zhLimit = 120, enLimit = 200 } = {}) {
  const t = String(text || '')
  if (!t) return false
  return CJK.test(t) ? t.length > zhLimit : t.length > enLimit
}

export function createReplyLength({ depositPolicyTextOf }) {
  if (typeof depositPolicyTextOf !== 'function') throw new Error('createReplyLength 需要 depositPolicyTextOf')
  const stats = { total: 0, tooLong: 0, depositTrimmed: 0 }
  /* 哪些会话已经听过整段定金政策了。进程内即可:重启后重说一次不算错。 */
  const heardDeposit = new Set()

  /* 把整段定金政策换成一句回指 —— 只在**同一通**里出现第二次时才换。
     判断用「整段是否被包含」,不做模糊匹配:政策原文是后端生成的固定串,
     模糊匹配会把顾客自己复述的政策也误伤。 */
  function dedupeDeposit(text, conversationId) {
    const policy = String(depositPolicyTextOf() || '').trim()
    if (!policy || !conversationId) return { text, trimmed: false }
    if (!String(text || '').includes(policy)) return { text, trimmed: false }
    if (!heardDeposit.has(conversationId)) {
      heardDeposit.add(conversationId)
      return { text, trimmed: false }      // 第一次:原样说完整
    }
    const short = String(text).replace(policy, '定金规则同上').replace(/\s{2,}/g, ' ').trim()
    return { text: short, trimmed: true }
  }

  /* 出口:落库前过一道。**只改这两件事**,别的一个字不动。 */
  function govern(text, conversationId) {
    stats.total += 1
    const { text: out, trimmed } = dedupeDeposit(text, conversationId)
    if (trimmed) stats.depositTrimmed += 1
    if (isTooLong(out)) stats.tooLong += 1
    return out
  }

  const snapshot = () => ({ ...stats, tooLongRate: stats.total ? stats.tooLong / stats.total : null })
  const forget = (conversationId) => heardDeposit.delete(conversationId)
  return { govern, snapshot, forget, isTooLong }
}
