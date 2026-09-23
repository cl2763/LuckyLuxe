/* D217 · 平台页到期日相关的前端闸(12l补 + J-118)
 * 不起浏览器 —— 把 platform.html 里的 extend/setExpiry/setPerpetual 抠出来在假 DOM 上跑,
 * 数**网络请求次数**。判据要能分辨「拦住了」和「发了但后端拒了」,所以数的是请求,不是结果。 */
import { readFileSync } from 'node:fs'
const html = readFileSync(new URL('../web/platform.html', import.meta.url), 'utf8')
const grab = (name) => {
  const i = html.indexOf(`async function ${name}(`)
  if (i < 0) throw new Error(`找不到 ${name}`)
  let d = 0, j = html.indexOf('{', i)
  for (let k = j; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) { j = k; break } } }
  return html.slice(i, j + 1)
}
let calls = [], toasts = [], confirmRet = true
const ctx = {
  api: async (u, o) => { calls.push({ u, body: JSON.parse(o.body) }); return {} },
  toast: (m) => toasts.push(m), confirm: () => confirmRet, loadBilling: () => {},
  _billTenants: [{ id: 'perp', name: '永久店', planExpiresAt: null },
                 { id: 'norm', name: '普通店', planExpiresAt: '2027-03-01T23:59:00.000Z' }],
}
const fns = {}
for (const n of ['extend', 'setExpiry', 'setPerpetual']) {
  fns[n] = new Function('ctx', `with(ctx){ ${grab(n)}; return ${n} }`)(ctx)
  ctx[n] = fns[n]
}
let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  🔴 ' + m)) }
const reset = () => { calls = []; toasts = [] }

console.log('\n── 刀:永久店点 +1月 ──')
reset(); await fns.extend.call(ctx, 'perp', 'month')
ok(calls.length === 0, `零网络请求(实得 ${calls.length} 次)`)
ok(toasts.some((t) => t.includes('永久店') && t.includes('日期框')), `提示了出路:「${toasts[0] || '(没提示)'}」`)

console.log('\n── 反向守:普通店点 +1月 ──')
reset(); await fns.extend.call(ctx, 'norm', 'month')
ok(calls.length === 1, `恰一次请求(实得 ${calls.length})`)
ok(calls[0]?.body?.planExpiresAt === '2027-04-01', `日期正确 2027-04-01(实得 ${calls[0]?.body?.planExpiresAt})`)

console.log('\n── setExpiry:清空日期框不许发请求 ──')
reset(); await fns.setExpiry.call(ctx, 'norm', '')
ok(calls.length === 0, `零请求(实得 ${calls.length})`)
ok(toasts.some((t) => t.includes('设为长期')), '提示指向「设为长期」按钮')
reset(); await fns.setExpiry.call(ctx, 'norm', '2028-01-01')
ok(calls.length === 1 && calls[0].body.planExpiresAt === '2028-01-01' && calls[0].body.perpetual === undefined,
   '填日期 → 走 planExpiresAt,不带 perpetual(取消永久的回路)')

console.log('\n── setPerpetual:只传 perpetual:true ──')
reset(); await fns.setPerpetual.call(ctx, 'norm')
ok(calls.length === 1 && calls[0].body.perpetual === true && calls[0].body.planExpiresAt === undefined,
   '只传 perpetual:true,不带空串')
console.log(`\n  ${pass} 过 · ${fail} 红`)
process.exit(fail ? 1 : 0)
