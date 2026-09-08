/* 出口卫生(D159 / D161,店主 05s §四 读六通 v4 读出来的两病)

   两病都长在**同一个地方**:一句话已经说完了,后面又被拼上一句采集问句。

   · **D159**:「我帮您问一下技师~ **请问这次是否需要下睫毛服务?**」
     顾客刚被告知「问技师」,下一句又被追问表项 —— 转人工/事实答句之后不该再追问。
   · **D161**:顾客说「谢谢」,机器又回一遍「这个我帮您问一下,确认清楚再回复您」——
     待人工态下把告别当成了新问题。

   为什么收在**出口**而不是逐处改:采集问句是从十几条支路拼上去的,
   逐处改必漏(下次新加一条又漏)。D150 那个壳已经证明了这条路能兜住每一个 return。

   🔴 这里只做**减法**:砍掉不该拼的那半句,或把整句换成告别语。
   不生成新事实、不改数字 —— 出口卫生不许变成第二个"会说话"的地方。 */

/* 采集问句长什么样:句尾那一问,来自 `quote-intake` / `booking-intake` 的表项。
   认的是**形状**(「请问…?」+ 表项关键词),不是某一句原文 —— 判据不许锚在会变的字面量上。 */
/* 🔴 05s 补一 §二②(店主亲测):这条正则原来写死成「本甲还是延长」,
   而模板真正说的是「做本甲**还是需要**延长」—— 差两个字,整条守就形同虚设。
   改成认**形状**:句尾一个问句 + 里面出现采集表项的关键词(卸甲/延长/下睫毛/断甲/参考图/款式/哪天…)。
   判据不许锚在某一句原文上,这就是又一次现证。 */
const INTAKE_WORD = /(卸甲|卸睫|延长|下睫毛|断甲|参考图|指定技师|第一次做美睫|眼睛.{0,4}敏感|本甲|款式|哪天|几点方便)/
/* 🔴 全半角都要写全:现测栽过一次 —— 文件里那几个「全角」标点在编辑过程中变成了半角,
   于是 `？`(U+FF1F)根本不匹配,合并那条回复的采集尾巴照样发出去。用转义写死。 */
const Q_END = /[?\uff1f]\s*$/
const SEPS = ['\u3002', '!', '\uff01', '?', '\uff1f', '~', '\uff5e']

/* 「这句话已经把事说完了」的三种形态 —— 后面再拼采集问句就是 D159。 */
const HANDOFF = /(帮您?(问|接)一下|帮您接人工|转(给|接)(同事|人工)|同事看到会|确认清楚再回复)/
const FAREWELL_REPLY = /(随时(来|找|问)|祝您|回头见|不客气)/
/* 事实答句:给了具体数字/时长/价格的那种。有答案了就别再追问表项。 */
const HAS_FACT = /\d+\s*(分钟|小时|元|块|次)|[¥$]\s*\d|\d+\s*[-–~]\s*\d+\s*分钟/

/** 顾客这句是不是在告别。**不含问号**才算 —— 「谢谢,那定金多少?」不是告别。 */
export function isFarewell(text = '') {
  const t = String(text).trim()
  if (!t || /[?\uff1f]/.test(t)) return false
  return /^(谢谢|多谢|感谢|好的?谢谢|thx|thanks|thank you|再见|拜拜|bye)[\s~!!。.]*$/i.test(t)
}

/** D159:把拼在后面的采集问句砍掉。
 *  @returns {{ text: string, cut: boolean }} */
export function stripIntakeTail(text = '') {
  const t = String(text || '')
  if (!t) return { text: t, cut: false }
  const closed = HANDOFF.test(t) || FAREWELL_REPLY.test(t) || HAS_FACT.test(t)
  if (!closed) return { text: t, cut: false }
  /* 尾巴从哪儿起:优先「请问」,否则从最后一个句读(。!?~)之后起。
     不这么切的话,整句都会被当成尾巴 —— 第一版就是这么把「帮您问一下技师~ 请问…」整句吃掉的。 */
  let at = t.lastIndexOf('请问')
  if (at <= 0) {
    const sep = Math.max(...SEPS.map((c) => t.lastIndexOf(c, t.length - 2)))
    at = sep > 0 ? sep + 1 : -1
  }
  if (at <= 0) return { text: t, cut: false }
  const tail = t.slice(at)
  if (!Q_END.test(tail) || !INTAKE_WORD.test(tail)) return { text: t, cut: false }
  const stripped = t.slice(0, at).trim()
  /* 砍完不能把整句砍没了 —— 那说明这句话**本来就只是**一个采集问句,那是正常的,不动它 */
  if (!stripped || stripped.length < 6) return { text: t, cut: false }
  return { text: stripped, cut: stripped !== t.trim() }
}

/** D161:待人工态下顾客说「谢谢」,回告别句,不再重复一遍转人工。 */
export function farewellText(lang = 'zh') {
  return lang === 'en'
    ? 'Anytime — just message us whenever you need. 😊'
    : '不客气~随时来找我们,祝您今天顺心!'
}

/** 出口卫生总入口:给一段回复文本和这一轮的上下文,回该发出去的那一段。
 *  @returns {{ text: string, why: string }} why='' 表示没动过 */
export function hygiene({ text = '', customerText = '', status = '', lang = 'zh', source = '' } = {}) {
  /* 🔴 采集模板那条路**本来就该以采集问句收尾** —— 它整句就是那一问(或「答一句 + 接回那一问」)。
     D159 要治的是「事情说完了还追着问表项」,不是「该问的时候问」。
     现测栽过:D165 给采集模板前面加了一句带价的话,这条守立刻把后面的问句砍了,
     顾客拿到一句价格、没有下一步 —— 守过头和不守一样坏。 */
  if (/collect_template|intake/.test(String(source))) return { text, why: '' }
  /* D161 先判:待人工态 + 顾客在告别 → 整句换告别语(不管原来那句说了什么) */
  if (isFarewell(customerText) && (status === 'needs_human' || status === 'human_active')) {
    return { text: farewellText(lang), why: 'farewell-in-handoff' }
  }
  const cut = stripIntakeTail(text)
  return { text: cut.text, why: cut.cut ? 'intake-tail-cut' : '' }
}
