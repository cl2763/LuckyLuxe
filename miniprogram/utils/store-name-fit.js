function fit(page) {
  // Measure the same native text in an unconstrained hidden span; no guessed character widths.
  const name=page.data.shopName||page.data.store?.storeName||''
  page.setData({storeNameMeasure:name,storeNameSize:48},()=>{
    page.createSelectorQuery().select('.shop-card-name').boundingClientRect().select('.store-name-measure').boundingClientRect().exec(rows=>{
      const available=rows[0]?.width,full=rows[1]?.width
      if(available&&full)page.setData({storeNameSize:Math.max(36,Math.min(48,Math.floor(48*available/full)))})
    })
  })
}
function show(page) {
  wx.showModal({title:page.data.lang==='en'?'Store name':'完整店名',content:page.data.shopName||page.data.store?.storeName||'',showCancel:false,fail(){wx.showToast({title:'暂时无法打开',icon:'none'})}})
}
module.exports={fit,show}
