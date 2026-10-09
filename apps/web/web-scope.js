// Explicit URL scoping; never replace fetch globally or alter external links.
;(function () {
  const prefix = /^\/experience(?:\/|$)/.test(window.location.pathname) ? '/experience' : ''
  const path = value => typeof value === 'string' && /^\/(?!\/)/.test(value)
    && !/^\/experience(?:[/?#]|$)/.test(value) ? prefix + value : value
  const shopsPath = prefix ? '/shops?include=demo' : '/shops'
  const filterShops = shops => prefix ? shops.filter(s => ['demo-ai','demo-basic','demo-empty'].includes(s.tenantId)) : shops
  window.WebScope = Object.freeze({ prefix, path, shopsPath, filterShops })
})()
