/* 12k —— 对比包「可点反馈」组件(单文件,内联进对比包,不引任何外链)
 *
 * 店主 09-24 原话:再出对比包,要能在页面里直接点「过 / 不过 / 有什么问题」,反馈更精准。
 * 这同时是 12i补 §一-3「店主偏好数据集」的采集口 —— 每点一次就是一条带标签的数据。
 *
 * 🔴 三条硬要求(12k §一):
 *   ① 本地单文件,顾客照片不出她的机器 —— 不上传、不 fetch、不引 CDN;
 *   ② 点选即存浏览器本地存储,刷新不丢;
 *   ③ 每格的名字 = 12e §六 的人话文件名,导出的反馈文件里带同一个名字,
 *      这样她说「哪版」和文件对得上。
 *
 * 自动发现格子,不要求 build-report 改结构 —— 这样第五轮那种已经生成的页面也能回炉嵌。
 *   行  = 含 <td><img> 的 <tr>
 *   行号 = 该行第一个 td 里的 <b>
 *   格名 = 该格 <a href> 指向的文件名(人话名);取不到才退回列标题
 */
(function () {
  'use strict'
  var 档 = ['过', '不过', '有问题']
  /* 🔴 存储键:**写死的常量 + 页面标题**。12k §二-3④ 那一刀就是改坏它 →
     刷新后应当丢失 → 断言必须红。所以它必须是稳定可预测的,不许掺时间戳/随机数。 */
  var KEY = 'llfb:' + (document.title || 'unknown')

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch (e) { return {} } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch (e) { warn('本地存储写不进去(隐身模式?)—— 这一页的反馈刷新会丢') } }
  var state = load()

  function notice(msg) {
    var b = document.getElementById('fb-notice')
    if (!b) {
      b = document.createElement('div'); b.id = 'fb-notice'
      b.style.cssText = 'background:#fdf6e7;border:1px solid #c9a227;color:#7a5c00;padding:7px 12px;border-radius:8px;margin:8px 0;font-size:12.5px'
      document.body.insertBefore(b, document.body.firstChild)
    }
    b.textContent = 'ℹ️ ' + msg
  }

  function warn(msg) {
    var b = document.createElement('div')
    b.style.cssText = 'background:#fdf1f0;border:1px solid #b3413a;color:#b3413a;padding:8px 12px;border-radius:8px;margin:8px 0;font-size:12.5px'
    b.textContent = '⚠️ ' + msg
    document.body.insertBefore(b, document.body.firstChild)
  }

  function nameOf(td, colLabel, rowNo) {
    var a = td.querySelector('a[href]')
    if (a) {
      var h = a.getAttribute('href') || ''
      var base = decodeURIComponent(h.split('/').pop() || '').replace(/\.(jpg|jpeg|png)$/i, '')
      if (base) return base
    }
    return (rowNo || '?') + '_' + (colLabel || '?')
  }

  var cells = []
  function build() {
    var headCache = new Map()
    Array.prototype.forEach.call(document.querySelectorAll('table'), function (tb) {
      var ths = Array.prototype.map.call(tb.querySelectorAll('tr th'), function (t) { return t.textContent.trim() })
      headCache.set(tb, ths)
    })
    Array.prototype.forEach.call(document.querySelectorAll('tr'), function (tr) {
      var tds = Array.prototype.slice.call(tr.children).filter(function (e) { return e.tagName === 'TD' })
      if (!tds.some(function (td) { return td.querySelector('img') })) return
      var ths = headCache.get(tr.closest('table')) || []
      var first = tds[0]
      var rowNo = (first.querySelector('b') || {}).textContent
      rowNo = (rowNo || '').trim() || String(cells.length)
      var rowCells = []
      tds.forEach(function (td, i) {
        if (!td.querySelector('img')) return
        var colLabel = (td.querySelector('.meta b') || {}).textContent || ths[i] || ''
        var id = nameOf(td, colLabel.trim(), rowNo)
        rowCells.push({ id: id, 行: rowNo, 版本: colLabel.trim(), td: td })
      })
      rowCells.forEach(function (c) { cells.push(c); mount(c) })
      if (rowCells.length) mountRowPick(tr, rowNo, rowCells)
    })
  }

  function mount(c) {
    var box = document.createElement('div')
    box.className = 'fb'
    box.style.cssText = 'margin-top:6px;border-top:1px dashed #d8d1c6;padding-top:5px'
    var bar = document.createElement('div')
    档.forEach(function (label, i) {
      var b = document.createElement('button')
      b.type = 'button'; b.textContent = label; b.dataset.v = label
      b.style.cssText = 'font:inherit;font-size:11px;padding:2px 8px;margin-right:4px;border-radius:999px;border:1px solid #cfc7ba;background:#fff;cursor:pointer'
      b.onclick = function () { setV(c, label); render(c) }
      bar.appendChild(b)
    })
    var ta = document.createElement('textarea')
    ta.rows = 2; ta.placeholder = '有什么问题?(选「有问题」才用得上)'
    ta.style.cssText = 'display:none;width:100%;margin-top:4px;font:inherit;font-size:11.5px;border:1px solid #cfc7ba;border-radius:6px;padding:4px;box-sizing:border-box'
    ta.oninput = function () { st(c).备注 = ta.value; save(state); count() }
    box.appendChild(bar); box.appendChild(ta)
    c.td.appendChild(box)
    c.bar = bar; c.ta = ta
    render(c)
  }

  function mountRowPick(tr, rowNo, rowCells) {
    var td = tr.children[0]
    var wrap = document.createElement('div')
    wrap.style.cssText = 'margin-top:8px;border-top:1px dashed #d8d1c6;padding-top:6px;font-size:11px'
    var sel = document.createElement('select')
    sel.style.cssText = 'font:inherit;font-size:11px;max-width:150px;margin-top:3px'
    sel.appendChild(new Option('（未选）', ''))
    rowCells.forEach(function (c) { sel.appendChild(new Option(c.版本 || c.id, c.id)) })
    var k = '行最喜欢:' + rowNo
    sel.value = state[k] || ''
    sel.onchange = function () { if (sel.value) state[k] = sel.value; else delete state[k]; save(state) }
    wrap.appendChild(document.createTextNode('这行我最喜欢哪版'))
    wrap.appendChild(sel)
    td.appendChild(wrap)
  }

  function st(c) { if (!state[c.id]) state[c.id] = { 行: c.行, 版本: c.版本 }; return state[c.id] }
  function setV(c, v) { var s = st(c); s.判定 = (s.判定 === v ? null : v); save(state); count() }
  function render(c) {
    var s = state[c.id] || {}
    Array.prototype.forEach.call(c.bar.children, function (b) {
      var on = s.判定 === b.dataset.v
      b.style.background = on ? (b.dataset.v === '过' ? '#e7f3e9' : b.dataset.v === '不过' ? '#fdf1f0' : '#fdf6e7') : '#fff'
      b.style.borderColor = on ? '#8a7a66' : '#cfc7ba'
      b.style.fontWeight = on ? '700' : '400'
    })
    c.ta.style.display = s.判定 === '有问题' ? 'block' : 'none'
    c.ta.value = s.备注 || ''
  }

  var badge
  function filled() { return cells.filter(function (c) { return (state[c.id] || {}).判定 }).length }
  function count() { if (badge) badge.textContent = '已填 ' + filled() + ' / 共 ' + cells.length + ' 格' }

  function rows() {
    return cells.map(function (c) {
      var s = state[c.id] || {}
      return { 序号: c.行, 版本名: c.id, 列: c.版本, 判定: s.判定 || null, 备注: s.备注 || '',
               行最喜欢: state['行最喜欢:' + c.行] || null }
    }).filter(function (r) { return r.判定 || r.备注 })
  }

  function dl(name, text, mime) {
    var a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: mime }))
    a.download = name; document.body.appendChild(a); a.click()
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove() }, 0)
  }

  function today() {
    try { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto' }).format(new Date()) }
    catch (e) { return new Date().toISOString().slice(0, 10) }
  }

  function exportAll() {
    var r = rows()
    var 轮 = (document.title.match(/第([一二三四五六七八九十\d]+)轮/) || [, '?'])[1]
    /* 🔴 12k §一 原文是「没填完导出时**提示但不拦**」。
       第一版我用 window.confirm 实现「提示」—— 那是**拦**(取消即不导出),规格写反了。
       而且原生对话框在不同环境下行为不一:嵌入式浏览器里 confirm 可能**不弹、直接返回 false**,
       表现就是「点了导出什么也没发生」,静默失败(实测:本机内嵌浏览器 1ms 返回 false)。
       改成页内提示条,永不拦。 */
    var 缺 = cells.length - r.length
    if (缺 > 0) notice('还有 ' + 缺 + ' 格没填 —— 已按现在填的这 ' + r.length + ' 条导出。')
    var payload = { 轮次: 轮, 日期: today(), 页面: document.title, 共几格: cells.length, 已填: r.length, 条目: r }
    dl('反馈_对比包_第' + 轮 + '轮_' + today() + '.json', JSON.stringify(payload, null, 2), 'application/json')
    var md = ['# 反馈 · 对比包第' + 轮 + '轮 · ' + today(),
              '', '共 ' + cells.length + ' 格,已填 ' + r.length + ' 格。', ''].concat(
      r.map(function (x) {
        return '- ' + x.序号 + ' / ' + x.版本名 + ' / ' + (x.判定 || '—') +
               (x.备注 ? ' / ' + x.备注.replace(/\n/g, ' ') : ' / ') +
               ' / 这行最喜欢:' + (x.行最喜欢 || '—')
      })).join('\n')
    dl('反馈_对比包_第' + 轮 + '轮_' + today() + '.md', md, 'text/markdown')
  }

  function topBar() {
    var bar = document.createElement('div')
    bar.style.cssText = 'position:sticky;top:0;z-index:99;background:#fff;border:1px solid #e6e0d8;border-radius:10px;padding:10px 14px;margin:0 0 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;box-shadow:0 2px 10px rgba(0,0,0,.05)'
    badge = document.createElement('b'); badge.style.cssText = 'font-size:13px'
    var btn = document.createElement('button')
    btn.type = 'button'; btn.textContent = '导出反馈'
    btn.style.cssText = 'font:inherit;font-size:13px;font-weight:700;padding:6px 16px;border-radius:999px;border:1px solid #8a7a66;background:#2b2622;color:#fff;cursor:pointer'
    btn.onclick = exportAll
    var clr = document.createElement('button')
    clr.type = 'button'; clr.textContent = '清空本页反馈'
    clr.style.cssText = 'font:inherit;font-size:12px;padding:5px 12px;border-radius:999px;border:1px solid #cfc7ba;background:#fff;cursor:pointer'
    clr.onclick = function () {
      if (!confirm('把这一页已点的全部清掉?')) return
      state = {}; save(state); cells.forEach(render); count()
      document.querySelectorAll('select').forEach(function (s) { s.value = '' })
    }
    var how = document.createElement('div')
    how.style.cssText = 'font-size:11.5px;color:#7a6f62;line-height:1.5;flex:1 1 320px;min-width:240px'
    how.innerHTML = '<b>30 秒说明</b>:每张图下面点 <b>过 / 不过 / 有问题</b>(点第二下取消);选「有问题」会弹出格子写一句。' +
      '每行最左边有「这行我最喜欢哪版」。点完按<b>导出反馈</b>,会下载一个 .json 和一个 .md,' +
      '把它们放回产出夹的 <code>_反馈/</code> 就行。<br>' +
      '键盘:鼠标停在某一格上时按 <b>1</b>=过 <b>2</b>=不过 <b>3</b>=有问题。点选随时自动保存,刷新不丢。'
    bar.appendChild(badge); bar.appendChild(btn); bar.appendChild(clr); bar.appendChild(how)
    document.body.insertBefore(bar, document.body.firstChild)
  }

  function keys() {
    var hot = null
    document.addEventListener('mouseover', function (e) {
      var td = e.target.closest && e.target.closest('td')
      var c = td && cells.filter(function (x) { return x.td === td })[0]
      if (c) hot = c
    })
    document.addEventListener('keydown', function (e) {
      if (!hot || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return
      var i = ['1', '2', '3'].indexOf(e.key)
      if (i < 0) return
      setV(hot, 档[i]); render(hot); e.preventDefault()
    })
  }

  function go() { build(); topBar(); count(); keys()
    if (!cells.length) warn('这一页没找到可反馈的图格 —— 组件嵌上了但没接到东西,别当成「都填完了」') }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go()
})()
