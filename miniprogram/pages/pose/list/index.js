const catalog=require('../catalog')
const access=require('../access')
const nav=require('../../../utils/nav')
Page({data:{filters:{length:'不限',shot:'不限',style:'不限'},dimensions:[{key:'length',label:'甲长',values:catalog.values('length')},{key:'shot',label:'拍法',values:catalog.values('shot')},{key:'style',label:'风格',values:catalog.values('style')}],groups:[],count:0,message:'',imageErrors:{}},
 onShow(){if(access.guard())this.refresh()},
 refresh(){this.setData(catalog.filterCards(this.data.filters))},
 select(e){const {key,value}=e.currentTarget.dataset;if(!['length','shot','style'].includes(key)||!catalog.values(key).includes(value))return;this.setData({filters:{...this.data.filters,[key]:value}});this.refresh()},
 open(e){const id=e.currentTarget.dataset.id;if(catalog.find(id))nav.to('/pages/pose/detail/index?id='+encodeURIComponent(id))},
 imageError(e){this.setData({['imageErrors.'+e.currentTarget.dataset.id]:true})}
})
