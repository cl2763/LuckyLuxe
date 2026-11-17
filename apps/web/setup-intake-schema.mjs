// Shared by the merchant intake UI and API. Materials never constitute applied configuration.
export const INTAKE_VERSION = 1
export const FILE_MAX = 10 * 1024 * 1024
export const TOTAL_MAX = 50 * 1024 * 1024
export const ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.pdf,.csv,.xlsx,.docx,.txt'
export const INTAKE_SECTIONS = Object.freeze([
  { id:'basic', title:'开店基本信息', level:'required', files:true, description:'只填写联系和经营所需的信息。已有门店资料可直接上传。', fields:[
    {id:'name',label:'门店／工作室名称',required:true}, {id:'city',label:'所在城市',required:true},
    {id:'contact',label:'联系电话或微信',required:true}, {id:'currency',label:'经营币种',type:'select',options:['CNY','CAD','USD','HKD','SGD','其他'],required:true},
    {id:'address',label:'详细地址',hint:'居家工作室可先说明希望公开到哪一级地址；由平台核对后发布。'},
    {id:'ownerName',label:'负责人称呼'}]},
  {id:'services',title:'服务与价格',level:'required',description:'价目表照片、Excel、PDF任选一种即可。展示价和实际结算价不同，可分别上传；平台整理后再请你确认。',files:true,fields:[
    {id:'priceRelation',label:'展示价格与实际收费',type:'select',options:['相同','不同，分别提供','需要协助整理']},
    {id:'note',label:'补充说明',type:'textarea',hint:'没有现成文件时可先写主要项目和价格，或标记稍后补充。'}]},
  {id:'hours',title:'营业安排',level:'required',description:'填写常规时间，或上传现成营业时间截图；特殊日期可以以后补充。',files:true,fields:[
    {id:'mode',label:'营业方式',type:'select',options:['固定营业时间','仅预约营业','时间不固定，请联系确认']},
    {id:'weekdays',label:'营业日',type:'days'}, {id:'opens',label:'开始时间',type:'time'}, {id:'closes',label:'结束时间',type:'time'},
    {id:'note',label:'休息、午休或特殊安排',type:'textarea'}]},
  {id:'membership',title:'会员、充值与次卡',level:'conditional',feature:'membership',description:'有这类业务再提供。上传活动海报或现成表格即可，不必重新抄写全部档位。',files:true,fields:[
    {id:'uses',label:'需要配置',type:'checks',options:['会员资格与折扣','充值赠送卡金','实物赠品','服务赠项（需核对支持范围）','次卡']},
    {id:'zeroBalance',label:'余额为零时会员资格',type:'select',options:['需要平台协助确认','保留会员资格','取消会员资格及折扣资格']},
    {id:'note',label:'金额、次数、有效期或其他说明',type:'textarea'}]},
  {id:'marketing',title:'优惠券与积分',level:'conditional',feature:'membership',description:'没有活动可以选暂不使用，后续随时补充。',files:true,fields:[
    {id:'uses',label:'需要配置',type:'checks',options:['优惠券','积分兑换']},{id:'note',label:'活动规则／适用范围',type:'textarea'}]},
  {id:'team',title:'员工与排班',level:'conditional',feature:'staff_schedule',description:'个人经营无需填写；团队可上传姓名、岗位及排班表。无需提供员工密码。',files:true,fields:[
    {id:'count',label:'服务人员数量',type:'number'}, {id:'note',label:'人员分工与初始排班说明',type:'textarea'}]},
  {id:'deposit',title:'预约定金与取消规则',level:'conditional',feature:'booking',description:'不收定金可直接选暂不使用。定金可由商家登记线下已收，或按现有规则使用储值余额抵扣。',files:true,fields:[
    {id:'note',label:'定金金额、免定金条件、取消与退回规则',type:'textarea'}]},
  {id:'migration',title:'原有顾客及剩余权益',level:'conditional',feature:'crm',description:'已有顾客、余额、次卡需要迁移时再提供。原始文件只供核对，不会因上传就直接入账。',files:true,fields:[
    {id:'cutoff',label:'导出数据截至日期',type:'date'}, {id:'uses',label:'文件包含',type:'checks',options:['顾客资料','储值余额','次卡余次','其他权益']}, {id:'note',label:'原系统及核对说明',type:'textarea'}]},
  {id:'branding',title:'门店照片与到店指引',level:'optional',description:'可后补，不影响先提交基本资料。',files:true,images:true,fields:[
    {id:'note',label:'停车、入口、上楼或门铃说明',type:'textarea'}]},
  {id:'works',title:'作品与服务介绍',level:'optional',feature:'gallery',description:'可上传有使用权的作品作为待整理材料；不会自动生成服务记录。',files:true,images:true,fields:[
    {id:'note',label:'作品分类或介绍',type:'textarea'}]},
  {id:'salary',title:'薪资与经营规则',level:'optional',feature:'staff_schedule',description:'可在开店后由老板自行设置；如需代配，上传方案后由老板核对。',files:true,fields:[
    {id:'note',label:'底薪、提成与适用日期说明',type:'textarea'}]},
  {id:'knowledge',title:'客服问答与接入资料',level:'optional',feature:'ai_customer_service',description:'常见问题、服务注意事项、客服接入资料；不收取微信密码。',files:true,fields:[
    {id:'note',label:'常见问答与服务边界',type:'textarea'}]}
])
export const allowedSections = entitlements => INTAKE_SECTIONS.filter(s => !s.feature || entitlements.features?.[s.feature]?.enabled === true)
export function intakeProgress(sections, answers, files = []) {
  return sections.map(s => {
    const a=answers[s.id] || {}, uploaded=files.some(f=>f.section===s.id)
    const missing=s.fields.filter(f=>f.required && !String(a[f.id] || '').trim()).map(f=>f.label)
    const hasContent=uploaded || s.fields.some(f=>Array.isArray(a[f.id]) ? a[f.id].length : String(a[f.id] || '').trim())
    return {id:s.id,title:s.title,level:s.level,status:missing.length?'missing':a.status==='later'?'later':a.status==='unused'?'unused':hasContent?'provided':'empty',missing}
  })
}
export function validateAnswers(value, sections) {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('资料格式无效。')
  const result={}
  for(const [id,answer] of Object.entries(value)){
    const section=sections.find(s=>s.id===id)
    if(!section)throw new Error('该资料模块未开通或不存在。')
    if(!answer || typeof answer!=='object' || Array.isArray(answer))throw new Error('资料项目格式无效。')
    const out={}
    for(const [key,v] of Object.entries(answer)){
      if(key==='status'){
        if(!['provided','later','unused'].includes(v)||v==='unused'&&section.level==='required')throw new Error('资料状态无效。')
        out[key]=v;continue
      }
      const f=section.fields.find(f=>f.id===key)
      if(!f)throw new Error('资料字段不存在。')
      if(['checks','days'].includes(f.type)){
        const options=f.type==='days'?['一','二','三','四','五','六','日']:f.options
        if(!Array.isArray(v)||v.length>options.length||v.some(x=>!options.includes(x)))throw new Error('选项无效。')
        out[key]=[...new Set(v)]
      }else{
        if(typeof v!=='string'||v.length>(f.type==='textarea'?4000:200))throw new Error('文字超长或格式无效。')
        if(f.type==='select'&&v&&!f.options.includes(v))throw new Error('选项无效。')
        if(f.type==='number'&&v&&(!/^\d+$/.test(v)||Number(v)>999))throw new Error('数量应为0至999之间的整数。')
        if(f.type==='time'&&v&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw new Error('时间格式无效。')
        if(f.type==='date'&&v&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))))throw new Error('日期格式无效。')
        out[key]=v.trim()
      }
    }
    result[id]=out
  }
  return result
}
