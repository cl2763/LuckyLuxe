/* 顾客端「人气」分区渲染 · 唯一出口(D103②,店主 02y 裁定三)

   从 `customer.js` 搬出来的(公约②边改边拆:动哪个领域就把该领域搬出巨型文件;
   `customer.js` 是现状冻结候拆的棘轮项,只许降不许升 —— 加功能就得先腾地方)。

   规格:**该分区少于 2 张时整个分区不出现。**
   1 张卡占半幅、右半空着,店主会觉得坏了;占满整行又比 2 卡态大一倍,两个分区一大一小更怪。
   而「人气美甲」这个标题本身承诺"有得挑",只有一个项目时这个承诺是假的。
   归族「不该有=整块不出现」+ 店主 02y 新律「不可用即不呈现,呈现即说明」。
   完整目录在「服务」页,不丢东西。小程序端同一条口径(home/index.wxml 的 length >= 2)。 */
window.CustomerRecommend = (() => {
  const MIN_CARDS = 2

  function render({ title, type, items, lang, t, fromPriceLabel }) {
    if (!Array.isArray(items) || items.length < MIN_CARDS) return ''
    return `
    <section class="section">
      <div class="section-row"><h2>${title}</h2><span class="subtle">${type}</span></div>
      <div class="recommend-strip">
        ${items.map((service) => `
          <button class="recommend-card card" data-service-id="${service.id}" type="button">
            ${window.ImgPlaceholder.tag(service.imageUrl, { alt: service.name, zh: lang !== 'en' })}
            <strong>${service.name}</strong>
            <span>${fromPriceLabel(service)} · ${service.durationMin}${t('minutes')}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `
  }

  return { render, MIN_CARDS }
})()
