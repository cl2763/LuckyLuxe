#!/usr/bin/env node
/* 把商家最终确认的美问会员核对包转换成平台迁移中心 v1 标准包。
   原始商家记录只读；输出路径由调用方指定，真实数据文件不得提交 Git。 */
import { readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { migrationProfileFields } from './profile-fields.mjs'

const args = process.argv.slice(2)
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : '' }
const input = arg('--input')
const output = arg('--output')
const sourceExportedAt = arg('--source-exported-at')
const dataCutoffAt = arg('--data-cutoff-at')
const sourceTimezone = arg('--source-timezone') || 'Asia/Shanghai'
const applyReviewedExclusions = args.includes('--apply-reviewed-exclusions')

if (!input || !output || !sourceExportedAt || !dataCutoffAt) {
  console.error('用法: node tools/migrations/build-meiwen-package.mjs --input <确认包.json> --output <标准包.json> --source-exported-at <ISO> --data-cutoff-at <ISO> [--apply-reviewed-exclusions]')
  process.exit(2)
}

const raw = JSON.parse(readFileSync(input, 'utf8'))
if (raw.packageType !== 'youji-member-migration-review-v1' || !Array.isArray(raw.members)) throw new Error('输入不是美问会员最终核对包。')

const moneyCents = (value) => {
  const clean = String(value ?? '').replace(/[¥￥,$，\s]/g, '')
  const n = Number(clean || 0)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.round(n * 100))
}
const text = (value) => String(value ?? '').trim()
const splitTags = (...values) => Array.from(new Set(values.flatMap((value) => text(value).split(/[,，、|;]/)).map((v) => v.trim()).filter(Boolean)))
const reviewedDelete = (note) => /^(?:可删|可删除|退卡可删|无服务小计可删除)[。.!！\s]*$/.test(text(note))

const records = raw.members.map((member) => {
  const p = member.profile || {}
  const d = member.details || {}
  const review = member.review || {}
  const excluded = applyReviewedExclusions && reviewedDelete(review.note)
  return {
    sourceRecordId: text(member.sourceMemberId || p['会员号']),
    excluded,
    exclusionReason: excluded ? `商家最终核对备注：${text(review.note)}` : '',
    mapped: {
      ...migrationProfileFields(p),
      name: text(p['会员名称']),
      phone: text(p['手机号']),
      birthday: text(p['生日']),
      tags: splitTags(p['个性标签'], p['会员级别'], p['生命周期']),
      note: '',
      balanceCents: moneyCents(p['储值卡余额']),
      totalSpendCents: moneyCents(p['累计消费'])
    },
    source: p,
    details: {
      transactions: Array.isArray(d.transactions) ? d.transactions : [],
      serviceNotes: Array.isArray(d.serviceNotes) ? d.serviceNotes : [],
      cards: Array.isArray(d.cards) ? d.cards : [],
      gifts: Array.isArray(d.gifts) ? d.gifts : [],
      attachments: Array.isArray(d.customerAttachments?.items) ? d.customerAttachments.items : [],
      completeness: {
        serviceComplete: d.serviceComplete === true,
        attachmentsComplete: d.customerAttachments?.complete === true,
        selectedMainCardId: text(member.selectedMainCardId || d.suggestedMainCardId)
      }
    },
    review
  }
})

const merchantConfirmedAt = records.map((r) => Date.parse(r.review?.reviewedAt || '')).filter(Number.isFinite).sort((a, b) => b - a)[0]
const packageData = {
  packageType: 'youji-customer-migration-v1',
  schemaVersion: 1,
  sourceSystem: 'meiwen',
  sourceExportedAt,
  dataCutoffAt,
  sourceTimezone,
  sourceHash: raw.sourceSha256 || createHash('sha256').update(readFileSync(input)).digest('hex'),
  merchantConfirmedAt: Number.isFinite(merchantConfirmedAt) ? new Date(merchantConfirmedAt).toISOString() : raw.preparedAt,
  mode: 'initial',
  records,
  anonymousOrders: []
}

writeFileSync(output, `${JSON.stringify(packageData, null, 2)}\n`, 'utf8')
chmodSync(output, 0o600)
const kept = records.filter((r) => !r.excluded)
const count = (key) => kept.reduce((sum, r) => sum + (Array.isArray(r.details[key]) ? r.details[key].length : 0), 0)
console.log(JSON.stringify({
  output,
  records: records.length,
  importCount: kept.length,
  excludedCount: records.length - kept.length,
  openingBalanceCents: kept.reduce((sum, r) => sum + r.mapped.balanceCents, 0),
  details: { transactions: count('transactions'), serviceNotes: count('serviceNotes'), cards: count('cards'), gifts: count('gifts'), attachments: count('attachments') },
  sourceExportedAt,
  dataCutoffAt,
  merchantConfirmedAt: packageData.merchantConfirmedAt
}, null, 2))
