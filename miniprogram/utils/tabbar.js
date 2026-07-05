function update(page, selected) {
  if (!page || typeof page.getTabBar !== 'function') return
  const tabBar = page.getTabBar()
  if (tabBar && typeof tabBar.update === 'function') {
    tabBar.update(selected)
  }
}

module.exports = {
  update
}
