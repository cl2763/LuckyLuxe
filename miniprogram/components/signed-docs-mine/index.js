/* 顾客端「我签署过的文件」· 只读组件(图 v2 第 5 屏 · 10d §二 批准)
 *
 * 🔴 这一屏的价值全在「不能做什么」,逐条对应到代码:
 *   · **只看自己的** —— 后端按「本人 + 同一家店」两个条件查;**这里一个 id 都不传**,连猜都猜不了
 *   · **不能传 / 不能删 / 不能作废** —— 本组件**一个写请求都没有**(全文只有一次 GET)
 *   · **作废的不显示 · `other` 默认不给看** —— 后端就不下发;前端没有"过滤掉"这一步
 *     (在前端过滤 = 数据已经到过前端,那不叫不给看)
 *   · 句子全部后端出(`blockTitle` / `emptyText` / `signedAtText`),前端零拼串
 *
 * 🔴 为什么是组件不是写进页面:`pages/me/index.js` 已 591 行,公约③ 的上限是 600 ——
 * 再塞一段就超线,而**超线文件不许再加新功能**。做成组件,页面只加一个标签。
 */
const api = require('../../utils/api')

Component({
  options: { styleIsolation: 'apply-shared' },
  data: { docs: [], blockTitle: '', emptyText: '', emptyHint: '', readOnlyNote: '', ready: false },
  lifetimes: {
    attached() { this.load() },
  },
  pageLifetimes: {
    show() { this.load() },
  },
  methods: {
    async load() {
      /* 没登录就整块不出现 —— 不留一个空壳说「还没有签署文件」(那会让人以为店里没给他存) */
      if (!api.isLoggedIn || !api.isLoggedIn()) { this.setData({ ready: false, docs: [] }); return }
      try {
        const r = await api.getMySignedDocs()
        this.setData({
          ready: true,
          docs: r.docs || [],
          blockTitle: r.blockTitle || '',
          emptyText: r.emptyText || '',
          emptyHint: r.emptyHint || '',
          readOnlyNote: r.readOnlyNote || '',
        })
      } catch (e) {
        /* 波及面回归律④:异步失败要有处理。这里**整块收起来**,不画半个界面 */
        this.setData({ ready: false, docs: [] })
      }
    },
  },
})
