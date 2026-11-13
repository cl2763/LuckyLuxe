/** One contract for both clients: payable basis points, a 0.1折 step, explicit no discount. */
export const discountLabel = rateBps => rateBps===null?'按门店默认会员价':rateBps===10000?'无折扣':`${(rateBps/1000).toFixed(1)}折`
export function memberDiscountInput() {
  return {control:'wheel',stepBps:100,decimalPlaces:1,
    unset:{rateBps:null,label:discountLabel(null)},
    options:Array.from({length:100},(_,i)=>{const rateBps=10000-i*100;return {rateBps,label:discountLabel(rateBps)}})}
}
