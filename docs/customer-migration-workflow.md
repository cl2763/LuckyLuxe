# 顾客迁移中心工作流 v1

适用于美问及后续接入的其他门店管理平台。原平台数据先转换为统一迁移包，再进入平台后台预检；未经预检确认不得直接写入商家库。

## 固定流程

1. **源平台快照**：记录源平台、原始文件哈希、源文件导出时间与源平台时区。原始文件只读保存，不提交 Git。
2. **确定业务截止时间**：取本批确实包含的最后一笔订单、卡耗、服务小记等业务记录时间，写入 `dataCutoffAt`。文件名中的报表结束日期不能替代实际记录时间。
3. **转换标准包**：各平台适配器只负责把源字段转换为 `youji-customer-migration-v1`。无法确定语义的字段完整放入 `source` 或 `details`，不得猜测映射。
4. **商家核对**：每位会员可被确认、修改或标记排除。排除记录不会创建顾客，但会在迁移批次中保留原因和源记录，便于复核。
5. **平台预检**：在“平台运营 → 顾客导入 → 标准迁移包”上传 JSON。预检不写库，并显示导入人数、排除人数、冲突、期初余额、明细数量及四个时间。
6. **最终确认并执行**：回传迁移包哈希、导入/排除人数和期初余额。任一项与预检不一致就拒绝执行。执行使用数据库事务，整批成功或整批回滚。
7. **结果核对**：保存批次号；复核顾客数、期初余额、服务小记和旧档案数。生产发布或真实导入仍须遵守仓库 `AGENTS.md` 的备份、同运行时副本演练和发布后核对要求。
8. **增量续导**：下一包标记 `mode: "incremental"`，其 `dataCutoffAt` 必须晚于上一批。只提取上次截止时间之后的新业务；同一源记录通过 `sourceSystem + sourceRecordId` 继续关联同一顾客。

## 字段落点

| 源数据 | 落点 | 是否参与当前业务计算 |
|---|---|---|
| 姓名、手机号、生日、标签 | `users` 顾客主档 | 是 |
| 储值卡余额 | `stored_value_transactions` 的 `legacy` 期初余额 | 只形成负债余额，不计收入 |
| 累计消费 | `users.legacy_total_spend_cents` | 可用于会员资格，不补造收入 |
| 服务小记 | `service_notes` | 商家内部可见，顾客端不可见 |
| 旧订单/消费记录 | `customer_legacy_transactions` | 只读展示，不进结算、财务、业绩 |
| 主卡、其他卡、赠品、附件 | `customer_legacy_assets` | 只读展示，不自动变成可核销权益 |
| 源平台专属字段 | `customer_migration_records.source_json/details_json` | 完整保留，不猜测业务语义 |
| 商家排除/修改记录 | `customer_migration_records.review_json` | 审计用途 |

## 四个时间

- `sourceExportedAt`：源文件实际导出的时间。
- `dataCutoffAt`：本批数据实际覆盖到的最后业务时间；增量导入以它为唯一边界。
- `merchantConfirmedAt`：商家完成核对的时间。
- `executedAt`：有迹平台正式写库的时间，由服务端生成。

这四个时间不得互相替代。尤其不能用商家回传文件的时间推断数据已经覆盖到同一时刻。

## 标准包最小结构

```json
{
  "packageType": "youji-customer-migration-v1",
  "schemaVersion": 1,
  "sourceSystem": "meiwen",
  "sourceExportedAt": "2026-09-28T01:07:34+08:00",
  "dataCutoffAt": "2026-09-27T21:26:43+08:00",
  "sourceTimezone": "Asia/Shanghai",
  "merchantConfirmedAt": "2026-10-02T07:17:20.631Z",
  "mode": "initial",
  "records": []
}
```
