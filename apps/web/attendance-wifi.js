/* 打卡 WiFi 名单维护(店主 2026-08-31 裁,清单#11):填 BSSID/名单是打字配置,网页可做;
   「打卡动作需真机读 WiFi」的豁免只留给打卡本身(小程序照旧真机读取直加)。
   读写同两口:GET/POST/DELETE /admin/store-wifi(与小程序同源,一份数据两端渲染)。 */
window.AttendanceWifi = (function () {
  'use strict'
  async function mount(el, { request, escapeHtml, toast }) {
    if (!el) return
    const render = async () => {
      let wifis = []
      try { wifis = (await request('/admin/store-wifi')).wifis || [] } catch (e) {
        el.innerHTML = `<p class="subtle">打卡 WiFi 名单加载失败:${escapeHtml(e.message || '')}</p>`
        return
      }
      el.innerHTML = `
        <div class="att-wifi">
          <h4>打卡 WiFi 名单</h4>
          <p class="subtle">员工打卡时手机必须连着名单里的 WiFi。真机连店内 WiFi 时小程序会显示本机 BSSID,抄进来即可;网页这边管名单的增删。</p>
          ${wifis.length ? `<ul class="att-wifi-list">${wifis.map((w) => `
            <li><code>${escapeHtml(w.bssid)}</code>${w.ssid ? ` · ${escapeHtml(w.ssid)}` : ''}
              <button class="ghost slim" data-wifi-del="${escapeHtml(w.id)}" type="button">删除</button></li>`).join('')}
          </ul>` : '<p class="subtle">还没有配置打卡 WiFi —— 未配置时员工端打卡不做 WiFi 校验。</p>'}
          <div class="att-wifi-add">
            <input type="text" data-wifi-ssid placeholder="WiFi 名称(选填)">
            <input type="text" data-wifi-bssid placeholder="BSSID,如 a0:b1:c2:d3:e4:f5">
            <button class="ghost slim" data-wifi-add type="button">添加</button>
          </div>
        </div>`
      el.querySelector('[data-wifi-add]')?.addEventListener('click', async () => {
        const bssid = el.querySelector('[data-wifi-bssid]').value.trim().toLowerCase()
        if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(bssid)) { toast('BSSID 格式应为 6 组十六进制,如 a0:b1:c2:d3:e4:f5'); return }
        try {
          await request('/admin/store-wifi', { method: 'POST', body: JSON.stringify({ bssid, ssid: el.querySelector('[data-wifi-ssid]').value.trim() }) })
          toast('已加入打卡 WiFi 名单')
          render()
        } catch (e) { toast(e.message || '添加失败') }
      })
      el.querySelectorAll('[data-wifi-del]').forEach((btn) => btn.addEventListener('click', async () => {
        try { await request(`/admin/store-wifi/${btn.dataset.wifiDel}`, { method: 'DELETE' }); render() } catch (e) { toast(e.message || '删除失败') }
      }))
    }
    render()
  }
  return { mount }
})()
