/* 判据 · 带 hidden 类的元素,**渲染后** display 必须是 none(D217 / 店主 09-24 立)
 *
 * 起因:`.hidden{display:none}` 定义在前,后面某条 `.moreMenu{display:flex}` 同特异性覆盖了它,
 * 于是六个「更多」菜单**类名是对的、JS 是对的、node --check 也过**,唯独渲染出来全展开。
 * 🔴 所以这条判据**不读 CSS,量 computed style** —— 读 CSS 规则永远追不完覆盖关系。
 *
 * 用法:在浏览器控制台粘贴 SNIPPET,或由 L1 截图流程注入执行。
 * 本批只跑 platform.html;商家后台那几页记在 D229 附表,下批查。
 */
export const SNIPPET = `
(async () => {
  const scan = () => [...document.querySelectorAll('.hidden')]
    .filter(el => getComputedStyle(el).display !== 'none')
    .map(el => ({ tag: el.tagName.toLowerCase(), id: el.id||'', cls: String(el.className).slice(0,50), display: getComputedStyle(el).display }));

  /* ① 判据先挨一刀:造一个真违规,抓不到就说明判据没在看 */
  const k = document.createElement('div');
  k.className = 'hidden'; k.id = '__hidden_knife__'; k.style.cssText = 'display:flex';
  document.body.appendChild(k);
  const knifeHit = scan().some(x => x.id === '__hidden_knife__');
  k.remove();
  if (!knifeHit) return { ok: false, why: '🔴 判据自身失效:造了违规却没抓到' };

  /* ② 逐页扫(平台后台七页),含「更多」菜单展开态 */
  const pages = ['overview','merchants','config','import','leads','billing','kb'];
  const rows = [];
  for (const p of pages) {
    if (typeof nav === 'function') { nav(p); await new Promise(r => setTimeout(r, 900)); }
    rows.push({ page: p, total: document.querySelectorAll('.hidden').length, bad: scan() });
  }
  if (typeof nav === 'function') { nav('merchants'); await new Promise(r => setTimeout(r, 900)) }
  const m = document.querySelector('.moreMenu');
  if (m && typeof toggleMore === 'function') { toggleMore(m.id.replace('more-','')); await new Promise(r => setTimeout(r, 300)) }
  rows.push({ page: 'merchants(更多展开)', total: document.querySelectorAll('.hidden').length, bad: scan() });

  const bad = rows.flatMap(r => r.bad.map(b => ({ ...b, page: r.page })));
  return { ok: bad.length === 0, knifeHit, pages: rows.map(r => ({ page: r.page, total: r.total, bad: r.bad.length })), violations: bad };
})()
`
