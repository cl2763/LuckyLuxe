import {mountIntake} from './setup-intake.mjs'
const token=location.hash.slice(1)
window.addEventListener('hashchange',()=>location.reload())
const root=document.getElementById('intakeRoot')
if(!/^[a-f0-9]{64}$/.test(token))root.textContent='请使用平台提供的开店资料链接，链接中应包含专属填写凭据。'
else mountIntake(root,{base:'/setup-intake',headers:()=>({'x-setup-intake-token':token})})
