const api = require('../../utils/api')

const QUICK = ['做美甲多少钱?', '明天有空位吗?', '营业时间是几点?', '地址在哪里?']

Page({
  data: {
    msgs: [],        // {id, side:'c'|'a', text, handoff}
    input: '',
    sending: false,
    quick: QUICK,
    scrollTo: ''
  },

  onLoad() {
    /* D155:**不再自己攒 history**。这一页问的那条接口已经和企微、模拟器并成同一个出口,
       记忆的唯一真相是后端的会话流水;页面这边再存一份,刷新就没、还和后端对不上(两处真相)。 */
    this.seq = 0
    this.push('a', '你好呀~我是本店的 AI 客服 ✨\n价格、款式、空位、预约都可以直接问我;需要人工的话我也会帮你转接。')
  },

  push(side, text, handoff) {
    this.seq += 1
    const msgs = this.data.msgs.concat({ id: 'm' + this.seq, side, text, handoff: !!handoff })
    this.setData({ msgs, scrollTo: 'm' + this.seq })
  },

  onInput(e) { this.setData({ input: e.detail.value }) },
  tapQuick(e) { this.send(e.currentTarget.dataset.q) },
  onConfirm() { this.send() },

  async send(preset) {
    const text = String(preset || this.data.input || '').trim()
    /* 🔴 D151:**不许拿 `sending` 挡住第二句**。合并窗要的就是「顾客连发几句」,
       而窗一开就是 8 秒 —— 挡住的话顾客在这 8 秒里根本发不出第二句,窗永远合不到东西,
       等于功能做了个寂寞。所以这里只挡空串;`sending` 只用来显示「正在输入」那一行。 */
    if (!text) return
    this.inflight = (this.inflight || 0) + 1
    this.setData({ input: '', sending: true })
    this.push('c', text)
    try {
      const r = await api.aiCustomerService(text)
      /* 🔴 D151 入站合并窗:连着发几句时,后端**只对最后一句出一条回复**,
         早到的那几次回 `reply: null`(「作废不发」)。这里必须**什么都不画** ——
         画一个「我没太明白」出来,就是把「正在等你说完」演成了「机器听不懂」。 */
      if (!r || !r.reply) return
      const d = (r.reply && r.reply.data) || {}
      const answer = d.answerZh || d.answer || d.answerEn || '不好意思,我没太明白,能换个说法吗?'
      this.push('a', answer, !!d.handoffRequired)
      if (d.handoffRequired) {
        this.push('a', '已为你转接人工,店员看到后会尽快回复;着急的话也可以直接到店或电话联系门店哦。', false)
      }
    } catch (err) {
      this.push('a', '网络有点不稳定,稍后再试一下~')
    } finally {
      /* 几句同时在飞时,最后一个回来才收掉「正在输入」—— 早回的那几次是被合并窗作废的,
         它们一回来就把点点点关掉,顾客会以为「答完了」,而真正的回复还在路上。 */
      this.inflight = Math.max(0, (this.inflight || 1) - 1)
      if (this.inflight === 0) this.setData({ sending: false })
    }
  }
})
