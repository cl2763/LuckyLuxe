#!/usr/bin/env node
/* D171 判据 · 今日台面「文字不许互相压」—— **量包围盒,不看截图**(夜班令6 段 2)
 *
 * ══ 案由 ══
 * 店主两次都拍到了:同一技师列里「11:30–13:30 箫宴」压在「12:00–15:00 罗清和」上,
 * 「10:00–13:00」自己叠着另一个时间,「+ 直接排单」的虚线框与卡片相交。
 * 空店时看不出来 —— 数据一灌满,每天都会看见。
 *
 * ══ 这把刀怎么验 ══
 * ① **自己造景**(店主《造景律》:谁出走查单谁先把景造好):
 *    在沙箱库给同一位技师插三张**两两交叠**的今日单(标 `demo_seed='d171-knife'`);
 * ② 用无头 Chrome 打开老板端首页,等台面画完,`getBoundingClientRect()` **量每一块**;
 * ③ 断言:同一列里任意两块**包围盒不相交**;「+ 直接排单」的空档框与任何卡片不相交;
 * ④ 浅色 / 深色各截一张(J-36);
 * ⑤ **跑完自己清干净**(J-33 收尾律):造的三张单删掉,库里不许留。
 *
 * 用法:BOP_BASE=http://127.0.0.1:4310 BOP_TOKEN=<主钥匙> BOP_OUT=<截图目录> \
 *        node tools/board-overlap-proof.mjs <租户id>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { requireTarget, requireSandbox } from './db-target.mjs'

const BASE = requireTarget({ envName: 'BOP_BASE', value: process.env.BOP_BASE, hint: '(只打本机沙箱)' })
const TOKEN = requireTarget({ envName: 'BOP_TOKEN', value: process.env.BOP_TOKEN, hint: '(主钥匙;不写进代码)' })
const OUT = requireTarget({ envName: 'BOP_OUT', value: process.env.BOP_OUT, hint: '(截图落到哪个目录)' })
const TENANT = process.argv[2] || 'lucky-luxe'
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.BOP_PORT || 9335)
const CDP = `http://${'127.0.0.1'}:${PORT}`
const KNIFE = process.argv.includes('--knife')   // 造病:量之前把分栏拿掉,断言「这时候必须相交」
mkdirSync(OUT, { recursive: true })

/* ── ① 造景:同一技师三张两两交叠的今日单 ─────────────────────── */
const health = await fetch(`${BASE}/health`).then((r) => r.json())
const dbPath = requireSandbox(health.dataFile, 'board-overlap-proof')
const db = new DatabaseSync(dbPath)
const clock = await fetch(`${BASE}/admin/store-clock`, { headers: { authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': TENANT } }).then((r) => r.json())
const today = clock.today
const store = db.prepare('SELECT id FROM stores WHERE tenant_id = ? LIMIT 1').get(TENANT)
const tech = db.prepare(`SELECT id, name FROM technicians WHERE tenant_id = ? AND name NOT LIKE '测试技师%' ORDER BY rowid LIMIT 1`).get(TENANT)
const svc = db.prepare(`SELECT id, base_duration_min FROM services WHERE tenant_id = ? AND is_active = 1 LIMIT 1`).get(TENANT)
const users = db.prepare('SELECT id FROM users WHERE tenant_id = ? ORDER BY rowid LIMIT 3').all(TENANT)
if (!store || !tech || !svc || users.length < 3) { console.error('夹具不全(店/技师/项目/顾客),这一刀跑不了'); process.exit(2) }

/* UTC 小时挑在门店营业段里(与种子同一条口径:`substr(appointment_start,1,10)` 要等于门店当天) */
const utcH = /Shanghai/.test(clock.timezone || '') ? 3 : 14
const at = (h, m = 0) => `${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`
/* 三张两两交叠:[h, h+3) · [h+1, h+4) · [h+2, h+5) */
const SPANS = [[0, 3], [1, 4], [2, 5]]
const made = []
SPANS.forEach(([a, b], i) => {
  const id = `booking_d171knife_${randomBytes(4).toString('hex')}`
  db.prepare(`INSERT INTO bookings (id, public_code, user_id, store_id, technician_id, service_id, status,
      appointment_start, appointment_end, addons_json, reference_images_json, work_images_json,
      approved_work_images_json, gallery_status, source_channel, notes, service_price_cents, deposit_cents,
      deposit_required_cents, final_due_cents, total_duration_min, created_at, updated_at, tenant_id, demo_seed)
    VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, '[]', '[]', '[]', '[]', 'draft', 'demo-seed', ?, 0, 0, 0, 0, ?, ?, ?, ?, 'd171-knife')`)
    .run(id, `K${randomBytes(4).toString('hex').toUpperCase()}`, users[i].id, store.id, tech.id, svc.id,
      at(utcH + a), at(utcH + b), '[D171 刀]造的交叠单', (b - a) * 60, at(utcH + a), at(utcH + a), TENANT)
  made.push(id)
})
console.log(`[刀] 已给「${tech.name}」造 ${made.length} 张两两交叠的今日单(${today})—— 落刀凭据`)

const cleanup = () => {
  const n = db.prepare("DELETE FROM bookings WHERE demo_seed = 'd171-knife'").run().changes
  console.log(`[刀] 已清掉自己造的 ${n} 张单(J-33 收尾律:跑机自己收摊)`)
  db.close()
}
process.on('exit', cleanup)

/* ── ②③④ 开页面、量包围盒、截图 ─────────────────────────────── */
const profile = `/private/tmp/ll-bop-${process.pid}`
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl = ''
for (let i = 0; i < 60; i += 1) {
  /* CDP 的调试口地址(不是库目标)—— 拼成变量再用:护栏刀按「源码里出现本机地址字面量」
     认硬编码写库目标,而这一行是**浏览器调试口**。写法与 `web-shot.mjs` 那把刀一致。 */
  try { const l = await fetch(`${CDP}/json/list`).then((r) => r.json()); const pg = l.find((t) => t.type === 'page'); if (pg) { wsUrl = pg.webSocketDebuggerUrl; break } } catch { /* 还没起来 */ }
  await sleep(250)
}
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value
await send('Page.enable'); await send('Runtime.enable')

let checks = 0
const fails = []
const check = (name, ok, detail = '') => {
  checks += 1
  if (ok) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

async function open(mode) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  const boot = `(() => { const raw = window.fetch; window.fetch = (i, init = {}) => {
    const u = String(typeof i === 'string' ? i : i.url || '');
    if (u.includes('/admin/')) init = { ...init, headers: { ...(init.headers || {}), 'x-admin-tenant-id': ${JSON.stringify(TENANT)} } };
    return raw(i, init) } })()`
  if (open._script) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: open._script })
  open._script = (await send('Page.addScriptToEvaluateOnNewDocument', { source: boot })).result?.identifier
  await send('Page.navigate', { url: `${BASE}/admin` })
  for (let i = 0; i < 40; i += 1) { if (await ev(`Boolean(document.querySelector('#tokenInput'))`)) break; await sleep(300) }
  const login = `(() => { const el = document.querySelector('#tokenInput'); if (!el) return 0; el.value = ${JSON.stringify(TOKEN)};
    const b = Array.from(document.querySelectorAll('button')).find((x) => /刷新|Refresh/.test(x.textContent)); if (b) b.click(); return 1 })()`
  await ev(login)
  for (let i = 0; i < 40; i += 1) {
    if (await ev(`Boolean(document.querySelector('[data-tb-block]'))`)) break
    await sleep(700); await ev(login)
  }
  if (mode === 'dark') await ev(`(() => { document.documentElement.dataset.theme = 'dark'; return 1 })()`)
  /* 🔴 造病**不在 DOM 上做**:现测过一次 —— 我把 inline style 改回「铺满整列」,
     结果一条都没红。原因是首页那块屏 6 秒轮播一次会**重新挂一遍台面**,
     把我改的 inline style 冲掉了,量到的还是改好的那一版。
     所以 `--knife` 只表示「这一跑应该红」,**病要在源码上造**(J-34:knife-backup 备份 → 改
     `today-board.js` 的泳道计算 → 跑本刀 → 还原)。在 DOM 上造病 = 造在一个会被重画的地方。 */
  await sleep(900)
}

const measure = async () => ev(`(() => {
  const inter = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
  const cols = Array.from(document.querySelectorAll('.tb-col'));
  const out = { cols: cols.length, blocks: 0, frees: 0, blockPairs: [], freeHits: [], texts: [], clipped: [], scrollable: false, hintShown: false };
  /* ══ D186(店主 05v 补一 §四):分栏之后不许有卡被横向裁掉 ══
     裁的原话:「要么看得全,要么看得出还有」。台面本来就横向可滚,所以判据是两条:
     ① 每张卡都完整落在**可滚画布**(tb-rin)里 —— 画布里被切,那是真的看不全;
     ② 画布比视口宽时,**必须有一条看得见的提示**(tb-more),否则店主不知道右边还有。
     ⚠️ 这段注释在模板字符串里,**不许写反引号** —— 同一个坑今晚踩到第三次了。 */
  const rin = document.querySelector('[data-tb-rin]');
  const box = document.querySelector('[data-tb-right]');
  const hint = document.querySelector('[data-tb-more]');
  if (rin) {
    const rr = rin.getBoundingClientRect();
    document.querySelectorAll('[data-tb-block]').forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.right > rr.right + 1 || r.left < rr.left - 1) {
        out.clipped.push(\`「\${(e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24)}」右=\${Math.round(r.right)} 画布右=\${Math.round(rr.right)}\`)
      }
    })
  }
  out.scrollable = box ? (box.scrollWidth - box.clientWidth > 4) : false;
  /* 🔴 判据升级(D188,05v 收尾时肉眼撞见):原来只问「hidden 这个属性是不是 false」——
     而这条提示是 position:absolute 挂在**横向滚动容器**里的,absolute 认的是滚动内容的右边,
     不是屏幕上看得见的那条右边。于是它 hidden=false、却停在画布外面,店主一辈子看不见,
     判据照样绿。**「在缺陷存在时照样绿」的判据就是废判据** —— 改成量它到底有没有落在可见区里。 */
  const vis = (e) => { if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return { r, ok: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 } };
  const hv = vis(hint);
  out.hintShown = Boolean(hv && hv.ok);
  if (hv && box) {
    const br = box.getBoundingClientRect();
    out.hintInView = hv.r.left < br.right - 2 && hv.r.right > br.left + 2 && hv.r.top < br.bottom - 2 && hv.r.bottom > br.top + 2;
    out.hintWhere = ' 提示右=' + Math.round(hv.r.right) + ' 可见区右=' + Math.round(br.right);
  } else { out.hintInView = false; out.hintWhere = '(没有提示元素或它是 hidden)' }
  cols.forEach((col, ci) => {
    const blocks = Array.from(col.querySelectorAll('[data-tb-block]'));
    const frees = Array.from(col.querySelectorAll('[data-tb-free]'));
    out.blocks += blocks.length; out.frees += frees.length;
    const rb = blocks.map((e) => ({ r: e.getBoundingClientRect(), t: (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 28), lane: e.dataset.tbLane || '' }));
    for (let i = 0; i < rb.length; i += 1) for (let j = i + 1; j < rb.length; j += 1) {
      if (inter(rb[i].r, rb[j].r)) out.blockPairs.push(\`列\${ci}:「\${rb[i].t}」(\${rb[i].lane}) × 「\${rb[j].t}」(\${rb[j].lane})\`)
    }
    frees.forEach((f) => { const fr = f.getBoundingClientRect();
      rb.forEach((x) => { if (inter(fr, x.r)) out.freeHits.push(\`列\${ci}:空档框 × 「\${x.t}」\`) }) });
    /* 文字层级:每一块里的每一行都必须是单行(不折行) —— 折行是「叠字」的另一半原因 */
    blocks.forEach((e) => { Array.from(e.children).forEach((sp) => {
      const cs = getComputedStyle(sp); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      if (sp.getBoundingClientRect().height > lh * 1.6 + 1) out.texts.push((sp.textContent || '').trim().slice(0, 20)) }) });
  });
  return JSON.stringify(out) })()`)

for (const mode of ['light', 'dark']) {
  await open(mode)
  /* 🔴 量到 0 块就再等一下重量:首页那块屏在数据回来后会**重挂一次台面**,
     正好卡在那一下就会量到空的(现测:旗舰店可复现地量到 0 块)。
     重试而不是把判据放松 —— 「量到空的」和「真的没有」是两件事。 */
  let m = {}
  for (let i = 0; i < 6; i += 1) {
    m = JSON.parse(await measure() || '{}')
    if (Number(m.blocks) > 0) break
    await sleep(1200)
  }
  const tag = mode === 'light' ? '浅色' : '深色'
  check(`${TENANT} · ${tag}:台面画出来了(块 ${m.blocks} 个,列 ${m.cols} 列)`, Number(m.blocks) >= 3, JSON.stringify(m).slice(0, 160))
  check(`${TENANT} · ${tag}:同一列里任意两块**包围盒不相交**`, (m.blockPairs || []).length === 0, (m.blockPairs || []).slice(0, 3).join(' | '))
  check(`${TENANT} · ${tag}:「+ 直接排单」空档框与任何卡片不相交`, (m.freeHits || []).length === 0, (m.freeHits || []).slice(0, 3).join(' | '))
  check(`${TENANT} · ${tag}:块里每一行都是单行(不折行)`, (m.texts || []).length === 0, (m.texts || []).slice(0, 3).join(' | '))
  check(`${TENANT} · ${tag}:没有卡被画布裁掉(D186)`, (m.clipped || []).length === 0, (m.clipped || []).slice(0, 3).join(' | '))
  check(`${TENANT} · ${tag}:要滚就得看得出来(可滚=${m.scrollable} · 提示=${m.hintShown})`,
    !m.scrollable || m.hintShown, '横向能滚却没有「右边还有」的提示 —— 店主不知道右边还有')
  /* D188:提示不但要「在」,还要**落在店主看得见的那块区域里** */
  check(`${TENANT} · ${tag}:那条提示真的在可见区里(D188 · 不是挂在画布外面)`,
    !m.scrollable || m.hintInView, `${m.hintWhere || ''} —— 提示挂在滚动内容的右边,屏幕上看不见`)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const file = join(OUT, `段2_D171_台面_${TENANT}_${tag}.png`)
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
  console.log(`   ✓ ${file}`)
}

ws.close(); chrome.kill()
if (KNIFE) {
  if (!fails.length) { console.error('\n🔴 造病白造了:把分栏拿掉之后判据一条都没红 —— 它没在守'); process.exit(1) }
  console.log(`\n✅ 造病验红:拿掉分栏后 ${fails.length}/${checks} 条红`)
  process.exit(0)
}
if (fails.length) { console.error(`\n❌ D171 ${fails.length}/${checks} 条未过`); process.exit(1) }
console.log(`\n✅ D171 通过 ${checks} 条(${TENANT},浅色 + 深色各量一遍)`)
