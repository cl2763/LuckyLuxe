window.StoreNavigation = {
 render(store, en) {
  const url=store.navigation && store.navigation.url
  if(typeof url!=='string'||!/^https:\/\/surl\.amap\.com\/[A-Za-z0-9]+$/.test(url))return ''
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${en?'Open Amap':'高德地图导航'}</a>`
 }
}
