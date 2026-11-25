Component({
  data:{review:null},
  methods:{
    ask(review){return new Promise(resolve=>{this._resolve=resolve;this.setData({review})})},
    finish(value){const resolve=this._resolve;this._resolve=null;this.setData({review:null});if(resolve)resolve(value)},
    confirm(){this.finish(true)},
    cancel(){this.finish(false)},
    noop(){}
  },
  lifetimes:{detached(){if(this._resolve)this._resolve(false)}}
})
