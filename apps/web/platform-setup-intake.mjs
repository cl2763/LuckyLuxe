import {mountIntake} from './setup-intake.mjs'
export async function openPlatformIntake({tenantId,headers,confirm}){
  const dialog=document.createElement('dialog')
  dialog.style.cssText='width:min(1100px,96vw);height:94vh;max-height:94vh;padding:0;border:1px solid #e3e0d6;border-radius:8px;overflow:hidden'
  dialog.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;border-bottom:1px solid #e3e0d6"><strong>资料与待确认</strong><button type="button" style="min-height:40px;padding:8px 16px">关闭</button></div><iframe title="商家资料收集" style="width:100%;height:calc(100% - 66px);border:0"></iframe>'
  document.body.append(dialog);dialog.showModal()
  const frame=dialog.querySelector('iframe'),doc=frame.contentDocument
  doc.open();doc.write('<!doctype html><html lang="zh" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/web/design-tokens.css"><link rel="stylesheet" href="/web/setup-intake.css"></head><body><main id="root"><p>正在读取资料…</p></main></body></html>');doc.close()
  let controller,closed=false
  const close=async()=>{if(controller?.isDirty()&&!await confirm('资料有未保存的文字修改。关闭将放弃这些文字，已上传文件仍保留。是否关闭？'))return;closed=true;controller?.dispose();dialog.close();dialog.remove()}
  dialog.querySelector('button').onclick=close
  dialog.oncancel=e=>e.preventDefault()
  controller=await mountIntake(doc.getElementById('root'),{base:`/platform/tenants/${encodeURIComponent(tenantId)}/setup-intake`,headers,platform:true})
  if(closed)controller.dispose()
}
