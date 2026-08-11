/* 统一导航封装(扫雷批裁决② 2026-08-12):页面栈满(10 层)时裸 wx.navigateTo 会静默 fail ——
   新增代码一律走这里(CI ㉑ 以基线数拦增量);存量 106 处=分叉债 F2,随 S 组各页改造迁移。 */
function fail(kind) {
  return () => wx.showToast({ title: '页面打开失败,请返回后重试', icon: 'none' })
}
module.exports = {
  to(url) { wx.navigateTo({ url, fail: fail('to') }) },
  redirect(url) { wx.redirectTo({ url, fail: fail('redirect') }) },
  tab(url) { wx.switchTab({ url, fail: fail('tab') }) },
  relaunch(url) { wx.reLaunch({ url, fail: fail('relaunch') }) },
  back(delta) { wx.navigateBack({ delta: delta || 1, fail: () => wx.reLaunch({ url: '/pages/entry/index', fail: fail('back') }) }) }
}
