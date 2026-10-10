const api = require('./api')
const i18n = require('./i18n')
function share(page, title, params) {
  const tenantId = api.currentTenantId()
  if (!tenantId) return { title: '有迹', path: '/pages/entry/index', query: '' }
  if (!['home', 'services', 'service-detail', 'portfolio'].includes(page)) return { title: '有迹', path: '/pages/entry/index', query: '' }
  const fields = { tenantId }
  const key = page === 'service-detail' ? 'id' : page === 'portfolio' ? 'workId' : ''
  if (key && params && params[key]) fields[key] = params[key]
  const query = Object.entries(fields).filter(([, v]) => v).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&')
  return { title: title || (i18n.getLang() === 'en' ? 'Youji · Our services' : '有迹 · 门店服务'), path: '/pages/' + page + '/index?' + query, query }
}
module.exports = { share }
