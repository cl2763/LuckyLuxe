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
  const response = await fetch(`${BASE}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

const tenantId = `mig-${RUN}`
const created = await req('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tenantId, name: `迁移中心测试店 ${RUN}`, plan: 'single' }) })
check('创建隔离测试商家', created.status === 201, JSON.stringify(created.data))
const basePath = `/platform/tenants/${tenantId}/migrations`
const pkg = {
  packageType: 'youji-customer-migration-v1', schemaVersion: 1, sourceSystem: 'meiwen',
  sourceExportedAt: '2026-09-28T01:07:34+08:00', dataCutoffAt: '2026-09-27T21:26:43+08:00',
  sourceTimezone: 'Asia/Shanghai', merchantConfirmedAt: '2026-10-02T07:18:46.093Z', mode: 'initial',
  records: [
    {
      sourceRecordId: 'mw-1', mapped: { name: '有手机号会员', phone: `139${RUN.slice(-8).padStart(8, '0')}`, birthday: '03-14', tags: ['VIP'], balanceCents: 12345, totalSpendCents: 56000 },
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

const mismatch = await req(`${basePath}/execute`, { method: 'POST', body: JSON.stringify({ package: pkg, confirmPackageHash: 'wrong', confirmOpeningBalanceCents: 12345, confirmImportCount: 2, confirmExcludedCount: 1 }) })
check('文件哈希不一致拒绝执行', mismatch.status === 400 && mismatch.data.error.code === 'PACKAGE_CONFIRM_MISMATCH', JSON.stringify(mismatch.data))

const run = await req(`${basePath}/execute`, { method: 'POST', body: JSON.stringify({ package: pkg, confirmPackageHash: preview.data.report.packageHash, confirmOpeningBalanceCents: 12345, confirmImportCount: 2, confirmExcludedCount: 1 }) })
check('正式迁移成功', run.status === 200 && run.data.result.created === 2 && run.data.result.excluded === 1, JSON.stringify(run.data))
check('无手机号会员通过源平台身份导入', db.prepare("SELECT COUNT(*) n FROM user_identities WHERE tenant_id=? AND provider='legacy:meiwen' AND provider_user_id='mw-2'").get(tenantId).n === 1)
check('负累计消费不进入业务负数', db.prepare("SELECT legacy_total_spend_cents n FROM users WHERE tenant_id=? AND display_name='无手机号会员'").get(tenantId).n === 0)
check('期初余额只在 legacy 桶写一笔', db.prepare("SELECT COUNT(*) n, SUM(amount_cents) s FROM stored_value_transactions WHERE tenant_id=? AND type='migrate_opening' AND bucket='legacy'").get(tenantId).n === 1 && db.prepare("SELECT SUM(amount_cents) s FROM stored_value_transactions WHERE tenant_id=? AND type='migrate_opening'").get(tenantId).s === 12345)
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
const noAuth = await req(`${basePath}/preview`, { method: 'POST', body: JSON.stringify({ package: pkg }) }, null)
check('迁移中心只有平台端可调用', noAuth.status === 401)
db.close()

console.log(`\n迁移中心回归通过：${checks} 项断言全绿`)
