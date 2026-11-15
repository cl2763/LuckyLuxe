// Small hierarchical DOM harness: parse descendants in document order, so nested
// picker buttons compete with outer form buttons exactly as querySelector does.
// Browser/native UI exercises remain separate evidence; this is a regression guard.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
class Element {
 constructor(tag='div',attrs={}){this.tag=tag;this.value='';this.attrs=attrs;this.children=[];this.listeners={};this.dataset={};for(const [k,v]of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5)]=v}
 set innerHTML(html){this.children=[];const stack=[this];for(const token of html.match(/<[^>]*>|[^<]+/g)||[]){if(token.startsWith('</')){if(stack.length>1)stack.pop();continue}if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const attrs={};for(const m of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[m[1]]=m[2]??'';const node=new Element(tag,attrs);stack.at(-1).append(node);if(!['input','br','img'].includes(tag))stack.push(node)}else{stack.at(-1).textContent=(stack.at(-1).textContent||'')+token; if(stack.at(-1).tag==='textarea')stack.at(-1).value=(stack.at(-1).value||'')+token}}}
 append(node){node.parent=this;this.children.push(node)}
 remove(){this.parent.children=this.parent.children.filter(n=>n!==this)}
 matches(s){if(s.startsWith('.'))return (this.attrs.class||'').split(' ').includes(s.slice(1));if(s.startsWith('[')){const [key,value]=s.slice(1,-1).split('=');return key in this.attrs&&(value===undefined||this.attrs[key]===value.replaceAll('"',''))}return this.tag===s}
 querySelectorAll(s){const out=[];for(const child of this.children){if(child.matches(s))out.push(child);out.push(...child.querySelectorAll(s))}return out}
 querySelector(s){return this.querySelectorAll(s)[0]||null}
 setAttribute(k,v){this.attrs[k]=v}
 addEventListener(k,fn){this.listeners[k]=fn}
 focus(){}
 showModal(){this.open=true}
 close(){this.open=false}
 click(){this.onclick?.();this.listeners.click?.({target:this})}
}
export async function verifyMemberPricingDOM(){
 const document={body:new Element('body'),createElement:tag=>new Element(tag)},window={};
 const context={window,document,setTimeout,clearTimeout};
 for(const f of ['member-pricing-shared.js','member-pricing-input.js','member-pricing-member.js'])vm.runInNewContext(readFileSync(new URL('../web/'+f,import.meta.url),'utf8'),context);
 for(const title of ['调整个人折扣','重新确认退款后的个人折扣','重新确认冲销后的个人折扣']){
  let completed=false;
  const promise=window.MemberPricingMember.confirm({id:'synthetic',title,escapeHtml:String,request:async path=>path.endsWith('/config')?{config:{active:true}}:{rateBps:8500,revision:3}}).then(x=>{completed=true;return x});
  await new Promise(r=>setImmediate(r));
  const overlay=document.body.children[0],buttons=overlay.querySelectorAll('button'),outer=buttons.find(b=>b.textContent==='确认折扣并继续'),cancel=buttons.filter(b=>b.textContent==='取消').at(-1),inner=buttons.find(b=>b.textContent==='确认选择'),picker=overlay.querySelector('dialog'),wheel=overlay.querySelector('.mp-wheel');
  outer.click();assert.equal(completed,false);assert.equal(overlay.querySelector('[role=alert]').textContent,'请填写确认原因');
  overlay.querySelector('[data-open]').click();assert.equal(picker.open,true);wheel.scrollTop=20*44;inner.click();assert.equal(picker.open,false);assert.equal(completed,false);assert.equal(document.body.children.length,1);
  overlay.querySelector('[data-open]').click();wheel.scrollTop=0;buttons.filter(b=>b.textContent==='取消')[0].click();assert.equal(picker.open,false);assert.equal(completed,false);
  overlay.querySelector('textarea').value='重新核对';outer.click();const result=await promise;assert.equal(result.discountConfirmation.rateBps,8000);assert.equal(result.discountConfirmation.expectedRevision,3);assert.equal(document.body.children.length,0);
  const cancelled=window.MemberPricingMember.confirm({id:'synthetic',title,escapeHtml:String,request:async path=>path.endsWith('/config')?{config:{active:true}}:{rateBps:8500,revision:3}});await new Promise(r=>setImmediate(r));document.body.children[0].querySelectorAll('button').filter(b=>b.textContent==='取消').at(-1).click();assert.equal(await cancelled,null);assert.equal(document.body.children.length,0);
 }
}
