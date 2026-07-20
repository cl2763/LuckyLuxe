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
    this.hist = [] // 传给后端的对话历史 [{role,content}]
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
    if (!text || this.data.sending) return
    this.setData({ input: '', sending: true })
    this.push('c', text)
    this.hist.push({ role: 'customer', content: text })
    try {
      const r = await api.aiCustomerService(text, this.hist.slice(-10))
      const d = (r.reply && r.reply.data) || {}
      const answer = d.answerZh || d.answer || d.answerEn || '不好意思,我没太明白,能换个说法吗?'
      this.push('a', answer, !!d.handoffRequired)
      this.hist.push({ role: 'assistant', content: answer })
      if (d.handoffRequired) {
        this.push('a', '已为你转接人工,店员看到后会尽快回复;着急的话也可以直接到店或电话联系门店哦。', false)
      }
    } catch (err) {
      this.push('a', '网络有点不稳定,稍后再试一下~')
    } finally {
      this.setData({ sending: false })
    }
  }
})
