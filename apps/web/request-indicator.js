// 非阻塞全页请求进度。慢请求才出现，保留当前页面内容供继续查看。
window.RequestIndicator = (() => {
  let pending = 0, timer = null, bar = null
  function begin() {
    pending += 1
    if (!bar) {
      bar = document.createElement('div')
      bar.className = 'request-indicator'
      bar.setAttribute('role', 'status')
      bar.setAttribute('aria-label', '正在加载')
      bar.setAttribute('aria-hidden', 'true')
      bar.innerHTML = '<span></span>'
      document.body.appendChild(bar)
    }
    if (!timer && !bar.classList.contains('on')) timer = setTimeout(() => { timer = null; if (pending) { bar.classList.add('on'); bar.setAttribute('aria-hidden', 'false') } }, 400)
    let done = false
    return () => {
      if (done) return
      done = true
      pending = Math.max(0, pending - 1)
      if (!pending) { clearTimeout(timer); timer = null; bar.classList.remove('on'); bar.setAttribute('aria-hidden', 'true') }
    }
  }
  return { begin }
})()
