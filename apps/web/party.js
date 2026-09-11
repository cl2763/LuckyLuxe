/* 顾客端「技师 / 门店」的**唯一出口**(07a 裁 #45,日1 段1 落)
 *
 * ══ 病 ══
 * 服务端给这两个字段用的是 `.get()`,**查不到返回 undefined**;
 * 而 `booking_drafts.technician_id` 本来就可空 ——「顾客还没选技师」是**正常业务态**。
 * `customer.js` 原来有 11 处直接写 `order.technician.name`,取到 undefined/null 就当场抛错:
 * **整页白**,而不是少显示一个名字。06i 我自己的购物车夹具就这么把整页搞崩过,
 * 当时还被误判成「点不到结算入口」—— 那正是 J-47 的由来。
 *
 * ══ 为什么单独成文件 ══
 * `customer.js` 有**行数棘轮**(2,811,只许降不许升;店主 09-02 批的是「冻结现状」,
 * 不是「这个体量是对的」)。按公约「新功能一律新模块 / 边改边拆」,
 * 这三个出口搬出来住,`customer.js` 只留调用 —— 加功能不加行,而且别的网页件也能用。
 *
 * 拿不到名字时给的是**「未指定」**,不是空串:空串会让人以为是渲染坏了。
 */
(function attachParty(global) {
  const FALLBACK = { zh: '未指定', en: 'Unassigned' }
  const langOf = () => {
    try { return (localStorage.getItem('lucky-web-lang') || 'zh') === 'en' ? 'en' : 'zh' } catch (e) { return 'zh' }
  }
  global.partyName = function partyName(party) {
    return party && party.name ? party.name : FALLBACK[langOf()]
  }
  global.partyField = function partyField(party, key) {
    return party && party[key] ? party[key] : ''
  }
  global.partyId = function partyId(party) {
    return party && party.id ? party.id : null
  }
}(window))
