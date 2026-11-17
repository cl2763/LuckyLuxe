export function createSetupRulePresentation({getDepositConfig,getMembershipConfig,ONLINE_PAYMENT_READY,depositKeyFacts,depositSummaryRows,depositPolicyText,MEMBER_QUALIFY_MODES,membershipSummaryRows}){
 function deposit(tid){
      const config = getDepositConfig(tid)
      return {
        config,
        onlinePaymentReady: ONLINE_PAYMENT_READY,
        keyFacts: { zh: depositKeyFacts(config, 'zh'), en: depositKeyFacts(config, 'en') },
        // 批④ S7:商家端摘要全量行(小程序只读展示用;与顾客端同一份 config 推导,不各查各的)
        summaryRows: { zh: depositSummaryRows(config, tid, 'zh'), en: depositSummaryRows(config, tid, 'en') },
        editHint: {
          zh: '这些规则在网页后台改:电脑打开后台 → 门店设置 → 定金与取消规则,左边改参数、右边实时看顾客会读到的说法;改完顾客预约页与 AI 客服话术自动跟上。',
          en: 'Edit these in the web admin: Store settings → Deposit & cancellation.'
        },
        text: { zh: depositPolicyText(config, tid, 'zh'), en: depositPolicyText(config, tid, 'en') }
      }
 }
 function membership(tid){
      return {
        config: getMembershipConfig(tid),
        qualifyModes: MEMBER_QUALIFY_MODES,
        // 2026-08-08 店主拍板:会员资格模式与等级体系(含「储值耗完是否保留会员」)由平台统一把关,
        // 商家端只读;充值档位与赠送项仍归商家自助。
        readOnly: true,
        managedBy: 'platform',
        readOnlyNote: '会员资格与等级由平台统一配置,如需调整请联系平台。充值档位与赠送项仍可自助设置。',
        /* 批④ S9(店主 08-24 拍板改定:维持平台统一设置,不放权)——补两件:
           ①**只读展示行**:分不分级 / 怎么算会员 / 各级门槛与权益,商家两端同源读这里(不各查各的);
           ②说明句**写成人话**:改什么、找谁改、怎么找,而不是一句「联系平台」让人猜。 */
        summaryRows: membershipSummaryRows(getMembershipConfig(tid), tid, 'zh'),
        editHint: '会员怎么算、分不分级、每级门槛与权益,由平台统一按店配置(你家的规则已经按你的要求设好了)。要调整:在微信上直接找平台对接人说明改成什么样,平台改完你这边和顾客端同时生效,不用自己操作。充值档位、次卡、优惠券这些仍然你自己在「会员与营销」里改。'
      }
 }
 return {deposit,membership}
}
