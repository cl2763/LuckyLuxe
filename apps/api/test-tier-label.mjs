/* 梯子名刀(D129,店主 03s §一 裁,2026-09-03 落)

   ══ 判词(店主原话)══
   **显示 `label`,永远不显示 `key`。键是程序用的,名字是人看的;
   `gold` 露出来就是这条的反面教材。**

   案由:03r 那批从七态截图里咬出顾客卡上一枚裸的 `gold` ——
   `TIER` 映射表的键是首字母大写,而 `memberTier` 来自 AI 抽取的记忆,大小写随来源,
   取不到就兜底到原值,把内部枚举当中文名显示了。
   当时我把「分级店自定义梯子键显示 key 还是 label」挂了 ⬜ 待裁;店主 03s 裁了。

   ══ 三条 ══
   ① 自定义梯子**新建/编辑时 `label` 必填**(与金额更正「原因必填」同口径,**后端硬拦** ——
      后端是最终闸律:前端拦只算体验);
   ② 存量 `label` 为空的**条件迁移**:label 空则填 key(一次性、幂等、不覆盖已有 label),
      并打 `labelFromKey` 标记供设置页提示「等级名沿用了键名,建议改成中文名」;
   ③ 消费方一律读 label;取不到走「认不出的等级」兜底(`conversation-card.mjs` 的
      `CARD_TEXT.tierUnknown`),**不显示原值**。

   ══ 本刀守什么 ══
   静态:归一化出口在、必填闸在、迁移分支在;消费方不许回落到 key。
   行为(沙箱):空 label 必 400 `TIER_LABEL_REQUIRED`;**有 label 必须放行**(反向守)。
   —— 一把见谁都拒的闸,跟没有闸一样守不住任何东西。 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CARD_TEXT } from './conversation-card.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ① 归一化出口在,且必填闸 + 迁移分支都在 */
const cfg = readFileSync(join(ROOT, 'apps/api/membership-config.mjs'), 'utf8')
check('① 梯子档位有归一化唯一出口 `normalizeTiers`,保存路径经过它(不是各处各写一套)',
  /function normalizeTiers\(/.test(cfg) && /tiers: normalizeTiers\(/.test(cfg), '')
check('①b label 必填闸在后端(TIER_LABEL_REQUIRED)—— 后端是最终闸,前端拦只算体验',
  /TIER_LABEL_REQUIRED/.test(cfg), '')
check('①c 存量条件迁移分支在:调用方没给 tiers 时,label 空的补成 key 并打 labelFromKey 标记'
  + '(一次性、幂等、不覆盖已有 label)',
/labelFromKey: true/.test(cfg) && /String\(t\?\.key \|\| ''\)/.test(cfg), '')

/* ② 消费方不许回落到 key */
const tags = readFileSync(join(ROOT, 'apps/web/customer-tags.js'), 'utf8')
check('② 网页等级徽标读 label(租户梯子 label → 内置中文名 → 「会员」兜底),**永不落到 key**',
  /memberTiers/.test(tags) && /fromLadder/.test(tags) && !/const shown = .*: tier\b/.test(tags),
  '仍有回落到 tier 原值的分支')
check(`②b 「认不出的等级」这句有唯一出处,判据引用它不抄字面量(现为「${CARD_TEXT.tierUnknown}」)`,
  typeof CARD_TEXT.tierUnknown === 'string' && CARD_TEXT.tierUnknown.length > 0, '')

/* ③ 顺带同族:ai-desk 那句 none 态文案的第二份已收 */
const desk = readFileSync(join(ROOT, 'apps/web/ai-desk.js'), 'utf8')
check('③ 同族:`ai-desk.js` 的 `qsLabel` 不再自存一份 none 态文案 —— '
  + '取不到就不呈现(不可用即不呈现),不自己补句',
!/quoteLabel \|\| '本会话暂无报价'/.test(desk) && /card\.quoteLabel \|\| ''/.test(desk), '')

/* ④ 行为层:空 label 必 400;有 label 必须放行(只打沙箱 4310,店主 03e 结构闸) */
const { ensureSandbox } = await import('./test-need-sandbox.mjs')
const sb = await ensureSandbox({ label: '[tier-label]' })
if (!sb.ok) {
  console.log('   ⚠️ 沙箱不可用 —— **行为层两条本轮未跑**(不静默跳过,如实说)')
} else {
  const SANDBOX = 'http://127.0.0.1:4310'
  /* 用**演示店**做现测(账本现测关门闸之外的配置口,且演示店本就可重置);
     造完当场还原(夹具收尾:判据不收尾就变成非幂等)。 */
  const TID = 'demo-lucky-luxe'
  const put = async (tiers) => {
    const r = await fetch(`${SANDBOX}/admin/membership/config`, {
      method: 'PUT',
      headers: { authorization: 'Bearer owner-demo-token', 'x-admin-tenant-id': TID, 'content-type': 'application/json' },
      body: JSON.stringify({ config: { tiersEnabled: true, memberQualify: 'any_recharge', tiers } }),
    }).catch(() => null)
    if (!r) return { status: 0, code: '(请求失败)', labels: [] }
    const j = await r.json().catch(() => ({}))
    return { status: r.status, code: j?.error?.code || '', labels: ((j?.config || j)?.tiers || []).map((t) => t.label) }
  }
  const before = await fetch(`${SANDBOX}/admin/membership/config`, {
    headers: { authorization: 'Bearer owner-demo-token', 'x-admin-tenant-id': TID },
  }).then((r) => r.json()).catch(() => null)

  const blank = await put([{ key: 'gold', label: '  ', minSpendCents: 0 }])
  check(`④ 行为层:label 只有空白 → 必须 400 TIER_LABEL_REQUIRED(实测 ${blank.status} ${blank.code})`,
    blank.status === 400 && blank.code === 'TIER_LABEL_REQUIRED', JSON.stringify(blank))

  const okr = await put([{ key: 'gold', label: '金卡', minSpendCents: 0 }])
  check(`④b 反向守:填了 label 必须放行(实测 ${okr.status} labels=${JSON.stringify(okr.labels)})`,
    okr.status === 200 && okr.labels.includes('金卡'), JSON.stringify(okr))

  /* 收尾:把演示店配置还原成现测前的样子 */
  if (before && before.config) {
    await fetch(`${SANDBOX}/admin/membership/config`, {
      method: 'PUT',
      headers: { authorization: 'Bearer owner-demo-token', 'x-admin-tenant-id': TID, 'content-type': 'application/json' },
      body: JSON.stringify({ config: before.config }),
    }).catch(() => null)
    console.log('   [收尾] 演示店会员配置已还原成现测前的值')
    /* 🔴 06a §六 查明并留痕:**值还原得回来,`updated_at` 还不回去** ——
       所以沙箱库的逐行指纹上,这一行会显示「旧行消失 1 行」。
       上一批我在回执里写「没有直接证据指到是哪一步写的」,答案就是这里。
       以后每跑一次都把这句打出来,回执照抄即可,不用再查一遍。 */
    console.log('   [夹具动过] 沙箱库 · demo-lucky-luxe · tenant_settings/membership_config —— '
      + '值已还原,但 updated_at 会刷新;逐行指纹会把它记成「旧行消失 1 行」,这是**夹具动的**,不是业务写的。')
  }
}

console.log('\n[梯子名] 显示 label,永不显示 key —— 必填闸 + 条件迁移 + 消费方零回落')
if (fails.length) { console.error(`\n❌ test-tier-label ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-tier-label 通过 ${checks} 项`)
