// 全站非阻塞请求指示：慢于 400ms 才显示，短请求不闪；并发请求全部结束才收起。
let pending = 0
let timer = null
let visible = false
function begin() {
  pending += 1
  if (!timer && !visible) timer = setTimeout(() => {
    timer = null
    if (!pending) return
    visible = true
    try { wx.showNavigationBarLoading({ fail: () => {} }) } catch (e) { /* 旧基础库无此能力 */ }
  }, 400)
  let done = false
  return () => {
    if (done) return
    done = true
    pending = Math.max(0, pending - 1)
    if (pending) return
    if (timer) { clearTimeout(timer); timer = null }
    if (visible) {
      visible = false
      try { wx.hideNavigationBarLoading({ fail: () => {} }) } catch (e) { /* 页面切换时可无导航栏 */ }
    }
  }
}
module.exports = { begin }
