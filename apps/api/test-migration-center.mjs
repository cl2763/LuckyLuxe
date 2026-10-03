// 标准顾客迁移中心:预检零写、排除留痕、无手机号身份、旧明细隔离、余额幂等、截止时间续导。
import { DatabaseSync } from 'node:sqlite'
import { assertTestTarget } from './test-guard.mjs'
import { requireOwnerToken } from './owner-token.mjs'

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const DB_PATH = process.env.TEST_DB_PATH
if (!DB_PATH) throw new Error('需要 TEST_DB_PATH（请通过 run-all-tests.sh 运行）')
await assertTestTarget(BASE)
const TOKEN = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const RUN = Date.now().toString(36)
let checks = 0
const check = (name, ok, detail = '') => { checks += 1; if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ''}`); console.log(`ok ${checks} - ${name}`) }
async function req(path, options = {}, token = TOKEN) {
  const response = await fetch(`${BASE}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),...(options.headers||{}) } })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

const tenantId = `mig-${RUN}`
const created = await req('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tenantId, name: `迁移中心测试店 ${RUN}`, plan: 'single', currency:'CNY',timezone:'Asia/Shanghai' }) })
check('创建隔离测试商家', created.status === 201, JSON.stringify(created.data))
const basePath = `/platform/tenants/${tenantId}/migrations`
const pkg = {
  packageType: 'youji-customer-migration-v1', schemaVersion: 1, sourceSystem: 'meiwen',
  sourceExportedAt: '2026-09-28T01:07:34+08:00', dataCutoffAt: '2026-09-27T21:26:43+08:00',
  sourceTimezone: 'Asia/Shanghai', merchantConfirmedAt: '2026-10-02T07:18:46.093Z', mode: 'initial',
  records: [
    {
      sourceRecordId: 'mw-1', mapped: { name: '有手机号会员', phone: `139${RUN.slice(-8).padStart(8, '0')}`, birthday: '03-14', acquisitionSource: '朋友介绍', originalJoinedDate: '2020-02-29', tags: ['VIP'], balanceCents: 12345, totalSpendCents: 56000 },
      source: { 会员号: 'mw-1', 来源渠道: '小红书', 平台专属字段: '必须保留' },
      details: {
        transactions: [{ sourceId: 'tx-1', occurredAt: '2026-09-20T12:00:00+08:00', summary: '旧平台消费', amount: 88 }],
        serviceNotes: [{ sourceId: 'note-1', date: '2026-09-20T12:10:00+08:00', staff: '技师甲', note: '内部服务小记' }],
        cards: [{ sourceId: 'card-1', name: '旧储值卡', balance: 123.45 }], gifts: [{ sourceId: 'gift-1', name: '旧赠品' }], attachments: []
      }, review: { reviewer: '商家' }
    },
    {
      sourceRecordId: 'mw-2', mapped: { name: '无手机号会员', phone: '', balanceCents: 0, totalSpendCents: -100 },
      source: { 会员号: 'mw-2' }, details: { transactions: [], serviceNotes: [], cards: [], gifts: [], attachments: [] }, review: {}
    },
    {
      sourceRecordId: 'mw-del', excluded: true, exclusionReason: '商家备注：可删除', mapped: { name: '排除会员', phone: '123' },
      source: { 会员号: 'mw-del' }, details: { transactions: [{ sourceId: 'tx-del', summary: '被排除会员的旧记录' }], serviceNotes: [], cards: [], gifts: [], attachments: [] }, review: { note: '可删除' }
    }
  ]
}

const preview = await req(`${basePath}/preview`, { method: 'POST', body: JSON.stringify({ package: pkg }) })
check('预检报告人数与排除数正确', preview.status === 200 && preview.data.report.importCount === 2 && preview.data.report.excludedCount === 1, JSON.stringify(preview.data))
check('预检期初余额正确', preview.data.report.openingBalanceCents === 12345)
check('预检展示四类完整明细数', preview.data.report.detailCounts.transactions === 1 && preview.data.report.detailCounts.serviceNotes === 1 && preview.data.report.detailCounts.cards === 1 && preview.data.report.detailCounts.gifts === 1)
check('被排除会员的明细只计入源包总数，不计入待导入数', preview.data.report.sourceDetailCounts.transactions === 2 && preview.data.report.detailCounts.transactions === 1)
const db = new DatabaseSync(DB_PATH)
check('预检完全零写入', db.prepare('SELECT COUNT(*) n FROM migration_batches WHERE tenant_id=?').get(tenantId).n === 0 && db.prepare('SELECT COUNT(*) n FROM users WHERE tenant_id=?').get(tenantId).n === 0)

const mismatch = await req(`${basePath}/execute`, { method: 'POST', body: JSON.stringify({ package: pkg, confirmPendingOnly: true, confirmPackageHash: 'wrong', confirmOpeningBalanceCents: 12345, confirmImportCount: 2, confirmExcludedCount: 1 }) })
check('文件哈希不一致拒绝执行', mismatch.status === 400 && mismatch.data.error.code === 'PACKAGE_CONFIRM_MISMATCH', JSON.stringify(mismatch.data))

const staleClient = await req(`${basePath}/execute`, { method: 'POST', body: JSON.stringify({ package: pkg, confirmPackageHash: preview.data.report.packageHash, confirmOpeningBalanceCents: 12345, confirmImportCount: 2, confirmExcludedCount: 1 }) })
check('旧客户端未确认暂存政策时拒绝执行', staleClient.status === 400 && staleClient.data.error.code === 'PENDING_POLICY_CONFIRM_REQUIRED')

const run = await req(`${basePath}/execute`, { method: 'POST', body: JSON.stringify({ package: pkg, confirmPendingOnly: true, confirmPackageHash: preview.data.report.packageHash, confirmOpeningBalanceCents: 12345, confirmImportCount: 2, confirmExcludedCount: 1 }) })
check('正式迁移成功', run.status === 200 && run.data.result.created === 2 && run.data.result.excluded === 1, JSON.stringify(run.data))
check('无手机号会员通过源平台身份导入', db.prepare("SELECT COUNT(*) n FROM user_identities WHERE tenant_id=? AND provider='legacy:meiwen' AND provider_user_id='mw-2'").get(tenantId).n === 1)
check('负累计消费不进入业务负数', db.prepare("SELECT legacy_total_spend_cents n FROM users WHERE tenant_id=? AND display_name='无手机号会员'").get(tenantId).n === 0)
check('旧余额仅暂存，不生成可用期初余额流水', db.prepare("SELECT COUNT(*) n FROM stored_value_transactions WHERE tenant_id=? AND type='migrate_opening'").get(tenantId).n === 0 && db.prepare('SELECT SUM(snapshot_amount_cents) s FROM migration_pending_balances WHERE tenant_id=? AND status=?').get(tenantId,'pending').s === 12345)
check('回执明确区分已写余额和待核对金额', run.data.result.openingWrittenCents === 0 && run.data.result.pendingWrittenCents === 12345)
check('来源关联未标记为已入账', db.prepare('SELECT SUM(opening_balance_applied_cents) s FROM customer_migration_links WHERE tenant_id=?').get(tenantId).s === 0)
check('消费记录只进旧档案且未造结算单', db.prepare('SELECT COUNT(*) n FROM customer_legacy_transactions WHERE tenant_id=?').get(tenantId).n === 1 && db.prepare('SELECT COUNT(*) n FROM settlements WHERE tenant_id=?').get(tenantId).n === 0)
check('卡和赠品只进旧资产档案', db.prepare('SELECT COUNT(*) n FROM customer_legacy_assets WHERE tenant_id=?').get(tenantId).n === 2)
check('服务小记进入商家内部小记', db.prepare("SELECT COUNT(*) n FROM service_notes WHERE tenant_id=? AND raw_text='内部服务小记'").get(tenantId).n === 1)
const excluded = db.prepare("SELECT status, exclusion_reason FROM customer_migration_records WHERE tenant_id=? AND source_record_id='mw-del'").get(tenantId)
check('商家删除备注保留审计但没有顾客', excluded?.status === 'excluded' && excluded.exclusion_reason.includes('可删除') && db.prepare("SELECT COUNT(*) n FROM users WHERE tenant_id=? AND display_name='排除会员'").get(tenantId).n === 0)
const rawRecord = db.prepare("SELECT source_json FROM customer_migration_records WHERE tenant_id=? AND source_record_id='mw-1'").get(tenantId)
check('平台没有的源字段完整保存', JSON.parse(rawRecord.source_json)['平台专属字段'] === '必须保留')

const rerunPreview = await req(`${basePath}/preview`, { method: 'POST', body: JSON.stringify({ package: pkg }) })
check('同一迁移包二次预检明确阻塞', rerunPreview.data.report.blockingReasons.some((x) => x.includes('已经执行过')))
const oldPkg = structuredClone(pkg); oldPkg.dataCutoffAt = '2026-09-27T21:26:42+08:00'; oldPkg.records[0].mapped.balanceCents = 0
const oldPreview = await req(`${basePath}/preview`, { method: 'POST', body: JSON.stringify({ package: oldPkg }) })
check('截止时间没有前进的批次阻塞', oldPreview.data.report.blockingReasons.some((x) => x.includes('没有晚于上批')))
const history = await req(basePath)
check('批次历史返回四个时间口径所需字段', history.status === 200 && history.data.batches[0].data_cutoff_at && history.data.batches[0].source_exported_at && history.data.batches[0].merchant_confirmed_at && history.data.batches[0].executed_at)
const formal = db.prepare('SELECT acquisition_source,original_joined_date FROM users WHERE tenant_id=? AND display_name=?').get(tenantId,'有手机号会员')
check('迁移正式字段写入且原始资料仍保留', formal.acquisition_source==='朋友介绍' && formal.original_joined_date==='2020-02-29' && JSON.parse(rawRecord.source_json)['来源渠道']==='小红书')
for (const dryRun of [false, undefined, 'true']) {
  const denied = await req(`/platform/tenants/${tenantId}/import/customers`, {method:'POST',body:JSON.stringify({rows:[],dryRun})})
  check('旧CSV入口禁止执行或模糊试跑标记 '+String(dryRun), denied.status===409 && denied.data.error.code==='LEGACY_IMPORT_DISABLED')
}
const csvPreview=await req(`/platform/tenants/${tenantId}/import/customers`,{method:'POST',body:JSON.stringify({rows:[{name:'仅预检',phone:'13812345678',balance:123}],dryRun:true})})
check('旧CSV仍允许只读试跑',csvPreview.status===200,JSON.stringify(csvPreview.data))
const noAuth = await req(`${basePath}/preview`, { method: 'POST', body: JSON.stringify({ package: pkg }) }, null)
check('迁移中心只有平台端可调用', noAuth.status === 401)

const pending=db.prepare('SELECT id,user_id FROM migration_pending_balances WHERE tenant_id=?').get(tenantId)
const activationPath=`/admin/customers/${pending.user_id}/migration-balances/${pending.id}`
const tenantHeaders={'x-admin-tenant-id':tenantId}
const reconcileView=await req(activationPath+'/reconciliation',{headers:tenantHeaders})
check('老板读取分卡对平资料，不提供启用权限',reconcileView.status===200&&reconcileView.data.cards.length===1&&reconcileView.data.canActivate===false)
const beforePreview=db.prepare('SELECT COUNT(*) n FROM stored_value_transactions WHERE tenant_id=?').get(tenantId).n
const reconcileBody={confirmVersion:reconcileView.data.version,currency:reconcileView.data.currency,cards:[{assetId:reconcileView.data.cards[0].id,kind:'stored_value',paidCents:10000,bonusCents:2345,noExpiry:true}]}
const reconciled=await req(activationPath+'/reconciliation',{method:'POST',headers:tenantHeaders,body:JSON.stringify(reconcileBody)})
check('本金赠送分卡合计与原总额对平',reconciled.status===200&&reconciled.data.balanced&&reconciled.data.differenceCents===0&&reconciled.data.canActivate===false,JSON.stringify(reconciled.data))
check('对平预览没有写入权益或余额',db.prepare('SELECT COUNT(*) n FROM stored_value_transactions WHERE tenant_id=?').get(tenantId).n===beforePreview&&db.prepare('SELECT COUNT(*) n FROM member_timecards WHERE tenant_id=?').get(tenantId).n===0)
const cardMismatch=await req(activationPath+'/reconciliation',{method:'POST',headers:tenantHeaders,body:JSON.stringify({...reconcileBody,cards:[{...reconcileBody.cards[0],paidCents:9000}]})})
check('差额不被自动补齐或忽略',cardMismatch.status===200&&!cardMismatch.data.balanced&&cardMismatch.data.differenceCents===1000)
const malformed=await req(activationPath+'/reconciliation',{method:'POST',headers:tenantHeaders,body:JSON.stringify({...reconcileBody,cards:{}})})
check('分卡格式异常明确400',malformed.status===400)
const balancePreview=await req(activationPath,{headers:tenantHeaders})
check('老板在本店读取启用预检',balancePreview.status===200,JSON.stringify(balancePreview.data))
const activationBody={requestId:'activation_'+RUN,confirmVersion:balancePreview.data.version,paidCents:10000,bonusCents:2345,currency:balancePreview.data.currency,mode:'unrestricted_aggregate',noReliableCardBreakdown:true,unrestricted:true,noExpiry:true,sourceUseStopped:true,cutoverAt:new Date().toISOString(),evidence:'隔离测试商家核对汇总余额并停止原系统使用',differenceReason:''}
const activation=await req(activationPath+'/activate',{method:'POST',headers:tenantHeaders,body:JSON.stringify(activationBody)})
check('确认后本金赠送分别启用',activation.status===200&&activation.data.activatedCents===12345,JSON.stringify(activation.data))
const retryActivation=await req(activationPath+'/activate',{method:'POST',headers:tenantHeaders,body:JSON.stringify(activationBody)})
check('接口网络重试返回原回执',retryActivation.status===200&&retryActivation.data.replayed===true)
const facts=await req('/admin/account-adjust/facts?userId='+pending.user_id,{headers:tenantHeaders})
check('现有账户正确读取迁移本金和赠送',facts.status===200&&facts.data.facts.paidCents===10000&&facts.data.facts.bonusCents===2345,JSON.stringify(facts.data))
const refund=await req('/admin/stored-value/refund',{method:'POST',headers:tenantHeaders,body:JSON.stringify({userId:pending.user_id,amountCents:1000,payChannel:'cash',reason:'隔离回归测试退卡，核对迁移本金与赠送不混淆',requestId:'refund_'+RUN})})
check('迁移余额退卡沿用本金优先且不计营收',refund.status===201&&refund.data.paidPartCents===1000&&refund.data.bonusPartCents===0&&refund.data.incomeImpactCents===0,JSON.stringify(refund.data))
const afterRefundMembers=await req('/admin/membership/members',{headers:tenantHeaders})
const afterRefundMember=afterRefundMembers.data.members.find(m=>m.userId===pending.user_id||m.id===pending.user_id)
check('退卡后迁入桶减少且本店桶不为负',afterRefundMember?.legacyBalanceCents===11345&&afterRefundMember?.normalBalanceCents===0,JSON.stringify(afterRefundMember))
const postedView=await req(activationPath+'/reconciliation',{headers:tenantHeaders})
check('已有迁入余额明确标注不能重复增加分卡余额',postedView.status===200&&postedView.data.alreadyPosted&&postedView.data.canActivate===false)
check('源快照不随启用和退卡被覆盖',db.prepare('SELECT snapshot_amount_cents FROM migration_pending_balances WHERE id=?').get(pending.id).snapshot_amount_cents===12345)
const gift=db.prepare("SELECT * FROM customer_legacy_assets WHERE tenant_id=? AND asset_kind='gift'").get(tenantId)
const giftPath=`/admin/customers/${gift.user_id}/migration-gifts/${gift.id}`
const giftView=await req(giftPath,{headers:tenantHeaders})
check('实物赠品最初仅有原始资料',giftView.status===200&&!giftView.data.grant)
const ledgerBefore=db.prepare('SELECT COUNT(*) n FROM stored_value_transactions WHERE tenant_id=?').get(tenantId).n
const financeBefore=db.prepare('SELECT COUNT(*) n FROM finance_transactions WHERE tenant_id=?').get(tenantId).n
const giftBody={requestId:'gift_'+RUN,confirmVersion:giftView.data.version,title:'护理油',specification:'10ml',quantity:3,unitValueCents:1000,noExpiry:true,physicalGoodsConfirmed:true,rulesConfirmed:true,sourceUseStopped:true,reason:'隔离测试核对来源及剩余件数'}
const giftActivate=await req(giftPath+'/activate',{method:'POST',headers:tenantHeaders,body:JSON.stringify(giftBody)})
check('实物确认生成三件权益',giftActivate.status===200&&giftActivate.data.remaining===3,JSON.stringify(giftActivate.data))
const claimBody={requestId:'claim_'+RUN,quantity:2,reason:'顾客当面确认收货'}
const giftClaim=await req(giftPath+'/claim',{method:'POST',headers:tenantHeaders,body:JSON.stringify(claimBody)})
check('领取扣减件数',giftClaim.status===200&&giftClaim.data.remaining===1,JSON.stringify(giftClaim.data))
const giftRetry=await req(giftPath+'/claim',{method:'POST',headers:tenantHeaders,body:JSON.stringify(claimBody)})
check('领取重试不会重复扣减',giftRetry.status===200&&giftRetry.data.replayed&&giftRetry.data.remaining===1)
const giftReturn=await req(giftPath+'/return',{method:'POST',headers:tenantHeaders,body:JSON.stringify({requestId:'return_'+RUN,quantity:1,claimId:giftClaim.data.eventId,reason:'退回一件完好赠品'})})
check('退回关联原领取并恢复件数',giftReturn.status===200&&giftReturn.data.remaining===2)
check('赠品不污染余额或财务流水',db.prepare('SELECT COUNT(*) n FROM stored_value_transactions WHERE tenant_id=?').get(tenantId).n===ledgerBefore&&db.prepare('SELECT COUNT(*) n FROM finance_transactions WHERE tenant_id=?').get(tenantId).n===financeBefore)
check('赠品原始记录完全保留',db.prepare('SELECT raw_json FROM customer_legacy_assets WHERE id=?').get(gift.id).raw_json===gift.raw_json)
db.close()

console.log(`\n迁移中心回归通过：${checks} 项断言全绿`)
