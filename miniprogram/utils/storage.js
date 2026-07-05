function read(key, fallback) {
  const value = wx.getStorageSync(key)
  return value || fallback
}

function write(key, value) {
  wx.setStorageSync(key, value)
  return value
}

function getCart() {
  return read('lucky_cart', [])
}

function setCart(cart) {
  const next = write('lucky_cart', cart)
  syncCartBadge(next)
  return next
}

function syncCartBadge(cart) {
  const items = Array.isArray(cart) ? cart : getCart()
  const count = items.length
  if (typeof wx === 'undefined' || !wx.setTabBarBadge) return
  if (count > 0) {
    wx.setTabBarBadge({
      index: 2,
      text: count > 99 ? '99+' : String(count),
      fail() {}
    })
  } else if (wx.removeTabBarBadge) {
    wx.removeTabBarBadge({ index: 2, fail() {} })
  }
}

function addCartItem(item) {
  const cart = getCart()
  const now = Date.now()
  const cartItem = Object.assign(
    {
      _id: `cart_${now}`,
      quantity: 1,
      selected: true,
      createdAt: now,
      updatedAt: now
    },
    item
  )
  cart.unshift(cartItem)
  setCart(cart)
  return cartItem
}

function updateCartItem(id, patch) {
  const cart = getCart().map((item) => {
    if (item._id !== id) return item
    return Object.assign({}, item, patch, { updatedAt: Date.now() })
  })
  setCart(cart)
  return cart
}

function removeCartItem(id) {
  const cart = getCart().filter((item) => item._id !== id)
  setCart(cart)
  return cart
}

function removeCartItems(ids) {
  const idMap = ids.reduce((map, id) => {
    map[id] = true
    return map
  }, {})
  const cart = getCart().filter((item) => !idMap[item._id])
  setCart(cart)
  return cart
}

function getOrders() {
  return read('lucky_orders', [])
}

function setOrders(orders) {
  return write('lucky_orders', orders)
}

function addOrder(order) {
  const orders = getOrders()
  orders.unshift(order)
  setOrders(orders)
  return order
}

function getOrder(id) {
  return getOrders().find((item) => item._id === id || item.orderNo === id)
}

function updateOrder(id, patch) {
  const orders = getOrders().map((item) => {
    if (item._id !== id && item.orderNo !== id) return item
    return Object.assign({}, item, patch, { updatedAt: Date.now() })
  })
  setOrders(orders)
  return getOrder(id)
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function today() {
  return formatDate(new Date())
}

function tomorrow() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return formatDate(date)
}

module.exports = {
  getCart,
  setCart,
  syncCartBadge,
  addCartItem,
  updateCartItem,
  removeCartItem,
  removeCartItems,
  getOrders,
  setOrders,
  addOrder,
  getOrder,
  updateOrder,
  today,
  tomorrow
}
