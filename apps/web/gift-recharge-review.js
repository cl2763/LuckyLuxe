/* Recharge review is read-only. Only the existing recharge mutation commits funds and gifts. */
window.GiftRechargeReview = {
  ask({name, pkg, principal, bonus, discountText, channel, technician, money, escapeHtml:e}) {
    return new Promise(resolve => {
      const overlay=document.createElement('div'), opener=document.activeElement;
      overlay.className='store-switch-overlay gift-recharge-overlay';
      const gifts=pkg?.giftItems||[];
      const row=(label,value)=>'<div class="gift-review-row"><span>'+e(label)+'</span><strong>'+e(value)+'</strong></div>';
      overlay.innerHTML='<section class="store-switch-panel gift-recharge-panel" role="dialog" aria-modal="true" aria-label="确认充值与赠送权益"><header><h2>确认充值与赠送权益</h2><button type="button" class="ghost" data-close>× 关闭</button></header><div class="gift-recharge-columns"><div><section class="gift-review-card"><h3>'+e(name)+' · 本次充值</h3><p>充值套餐</p><strong>'+e(pkg?.label||pkg?.name||'手动充值')+'</strong>'+row('充值本金',money(principal,2))+row('赠送卡金',money(bonus,2))+row('充值后个人折扣',discountText)+row('付款方式',channel)+row('经手技师',technician)+'<p class="subtle">需要修改金额或折扣，请返回调整；本次确认会留痕。</p></section><section class="gift-review-card"><h3>随本次充值发放</h3>'+(gifts.length?gifts.map(g=>'<div class="gift-review-row"><div><strong>'+e(g.name)+'</strong><p class="subtle">'+e([g.kindLabel,g.expiryText,g.unitValueCents==null?'未填写参考价值':'单件参考价值 '+money(g.unitValueCents,2)].filter(Boolean).join(' · '))+'</p></div><strong>'+e(String(g.quantity)+(g.unitLabel||'份'))+'</strong></div>').join(''):'<p class="subtle">本次无套餐赠送权益。</p>')+'</section></div><aside class="gift-review-card"><h3>发放与使用</h3><p>充值到账后，赠送权益进入'+e(name)+'的卡包。</p><p class="gift-review-notice">如果是随单充值：先签含充值的服务单，再签同行朋友的单。朋友单可预览新增券优惠，正式签署前须确认权益已经到账。</p><p>此确认记录不代表实物已领取，也不代表赠送服务已经核销。</p><p class="subtle">本页为独立充值。确认后立即到账并发放权益，请先核实已收到款项。</p><div class="gift-review-actions"><button type="button" class="ghost" data-back>返回调整</button><button type="button" class="primary" data-confirm>确认到账并发放</button></div></aside></div></section>';
      document.body.append(overlay);
      const finish=result=>{overlay.remove();opener?.focus();resolve(result)};
      overlay.querySelector('[data-close]').onclick=()=>finish(false);
      overlay.querySelector('[data-back]').onclick=()=>finish(false);
      overlay.querySelector('[data-confirm]').onclick=()=>finish(true);
      overlay.querySelector('[data-back]').focus();
    });
  }
};
