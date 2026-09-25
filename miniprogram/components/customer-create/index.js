const api=require('../../utils/api')
Component({
  properties:{themeClass:String},
  data:{shown:false,name:'',phone:'',busy:false,error:'',candidates:[],duplicate:false},
  methods:{
    open(){this.key='customer_'+Date.now()+'_'+Math.random().toString(36).slice(2);this.setData({shown:true,name:'',phone:'',busy:false,error:'',candidates:[],duplicate:false})},
    close(){if(!this.data.busy)this.setData({shown:false})},
    stop(){},
    nameInput(e){this.setData({name:e.detail.value,error:'',candidates:[],duplicate:false})},
    phoneInput(e){this.setData({phone:e.detail.value,error:'',candidates:[],duplicate:false})},
    useExisting(e){const customer=this.data.candidates.find(c=>c.id===e.currentTarget.dataset.id);if(customer){this.setData({shown:false});this.triggerEvent('saved',{customer})}},
    duplicate(){this.setData({duplicate:true,candidates:[],error:'已选择仍新建，请点击保存档案。'})},
    async save(){
      if(this.data.busy)return
      if(!this.data.name.trim()){this.setData({error:'请填写顾客姓名。'});return}
      this.setData({busy:true,error:''})
      try{const r=await api.adminPost('/admin/customers',{displayName:this.data.name.trim(),phone:this.data.phone.trim(),requestId:this.key,allowDuplicatePhone:this.data.duplicate});this.setData({shown:false});this.triggerEvent('saved',{customer:r.customer})}
      catch(e){this.setData({error:e.message||'建档失败',candidates:e.code==='PHONE_EXISTS'?(e.details?.candidates||[]):[]})}
      finally{this.setData({busy:false})}
    }
  }
})
