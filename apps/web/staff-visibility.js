/* 员工端展示(全店)三选一 —— 店主 2026-08-31k 小合同五条落地。
   位置:员工管理 → 业绩目标面板顶部(店级一行,与按技师的 display_mode 行分开);仅此一处 UI
   (配置编辑=网页,既有裁定;小程序不加编辑口)。
   写口=既有 PUT /admin/staff-visibility(仅老板,后端 400 终闸);点即保存、保存后回读高亮;
   作用面不变(staffPerformanceView 清块 / salary/my-estimate 403 —— 三态行为断言在 test-daily-close)。 */
window.StaffVisibility = (function () {
  'use strict'
  const OPTS = [
    ['perf_only', '只业绩', '只业绩=不展示工资估算'],
    ['perf_and_salary', '业绩+工资', '业绩+工资=现状默认'],
    ['salary_only', '只工资', '只工资=不展示业绩明细']
  ]
  let cur = null
  async function mount(el, { request, toast }) {
    if (!el) return
    const render = async (reload) => {
      if (cur === null || reload) {
        try { cur = (await request('/admin/staff-visibility')).visibility } catch (e) { el.innerHTML = ''; return }
      }
      el.innerHTML = `
        <div class="staff-vis-row">
          <span class="lab">员工端展示(全店)</span>
          <span class="seg2" data-vis-seg>
            ${OPTS.map(([v, l]) => `<button type="button" class="${v === cur ? 'on' : ''}" data-vis-value="${v}" title="${OPTS.find((o) => o[0] === v)[2]}">${l}</button>`).join('')}
          </span>
          <span class="subtle small">${(OPTS.find((o) => o[0] === cur) || [])[2] || ''}</span>
        </div>
        <p class="subtle small staff-vis-note">上面这行管全店给不给看;每位技师的「显示」开关管业绩分项细到哪。</p>`
      el.querySelectorAll('[data-vis-value]').forEach((b) => b.addEventListener('click', async () => {
        try {
          const resp = await request('/admin/staff-visibility', { method: 'PUT', body: JSON.stringify({ visibility: b.dataset.visValue }) })
          cur = resp.visibility
          toast('已保存,员工端立即生效')
        } catch (e) {
          /* 判据四(不许静默):后端拒了必须开口说 */
          toast(e.message || '保存失败')
        }
        render(true)   // 保存回读:高亮以库值为准,不以点击为准
      }))
    }
    render()
  }
  return { mount }
})()
