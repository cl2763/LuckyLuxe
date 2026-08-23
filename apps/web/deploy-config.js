/* 网页顾客端部署配置(与小程序 miniprogram/utils/deploy.js 同刀,店主 08-23 裁定)。
   defaultTenantId 为空 = 多租户构建:没有 ?store= 也没有本地记忆时**不许默认进任何一家店**,
   直接弹「选择门店」。单店部署在这里填本店 tenantId,不许把店名写回 customer.js。 */
window.LL_DEPLOY = { defaultTenantId: '' }
