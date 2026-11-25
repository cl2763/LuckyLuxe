const api=require('../../../../utils/api')
Component({
 data:{open:false,items:[],busy:false,error:'',choices:['请选择处理方式','保留权益','作废未使用权益']},
 lifetimes:{detached(){if(this._resolve)this._resolve(null)}},
 methods:{
  async ask(userId,sourceTxnId){const review=await api.adminGet('/admin/account-adjust/gift-review?userId='+encodeURIComponent(userId)+(sourceTxnId?'&sourceTxnId='+encodeURIComponent(sourceTxnId):''));if(!review.required)return {};this._review=review;this.setData({open:true,error:'',items:review.items.map(g=>({...g,choice:0,returnQuantity:'0'}))});return new Promise(resolve=>{this._resolve=resolve})},
  noop(){},cancel(){this.finish(null)},finish(value){const done=this._resolve;this._resolve=null;this.setData({open:false});if(done)done(value)},
  choose(e){this.setData({['items['+e.currentTarget.dataset.i+'].choice']:Number(e.detail.value)})},returned(e){this.setData({['items['+e.currentTarget.dataset.i+'].returnQuantity']:e.detail.value})},
  confirm(){const items=this.data.items.map(g=>({id:g.id,action:g.choice===1?'keep':g.choice===2?'void':'',returnQuantity:Number(g.returnQuantity||0)}));if(items.some(i=>!i.action)){this.setData({error:'请逐项选择权益处理方式'});return}if(items.some((i,n)=>!Number.isSafeInteger(i.returnQuantity)||i.returnQuantity<0||i.returnQuantity>this.data.items[n].claimed||i.returnQuantity&&i.action!=='void')){this.setData({error:'请核对退回件数，并选择作废未使用权益'});return}this.finish({giftReview:{reviewHash:this._review.reviewHash,items}})}
 }
})
