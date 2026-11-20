# Production releases: preserve existing merchant data

This is a live merchant system. The user explicitly requires every future bug/UI release to preserve existing merchant records. Read the data-preservation section at the top of CLAUDE.md before any production release.

- Base releases on the verified live commit; review all startup/schema changes.
- Create and verify a WAL-consistent backup using tools/db-backup.mjs. Query production only through tools/prod-ro.mjs.
- Rehearse upgrades and repeat startup on an isolated backup copy; compare every original table/column and ledger trigger, including signed records and account balances.
- Match the exact production runtime version (including Node minor/patch) for startup and retained-backup rehearsals; a CI major-version label is insufficient.
- Require passing regression checks before publishing. Verify the live version and retained records after publishing; reconcile legitimate concurrent business activity.
- Never reset production, inject demo data, rewrite historical financial/signed records, or replace the live database with a stale backup. Prefer rolling back code while retaining the persistent volume.
- Keep private backups, credentials and raw merchant records out of Git and public reports. Report what was actually deployed and verified.

# Web and mini-program parity

For every functional or UI change, inspect the corresponding web and mini-program screens before editing. Compare their entry points, data source, states, actions, feedback, and visual layout; update both surfaces where the same capability exists. Preserve each platform's approved layout and permissions. Run regression checks for both surfaces, and record any deliberate platform-specific difference or unverified real-device behavior before handing a version to the user.

## 发布顺序：星野验收后全店推广（店主2026-11-20最新确认）

1. 每一批新改动先在星野店完整提供可实际操作的验收版本，包含本批全部功能、界面、状态及相关流程；先完成自测，不以设计图或代码完成代替实际验收。验收期间不得提前改变其他营业门店的行为或数据；共享后端改动须做好租户隔离和向后兼容。
2. 等店主明确确认本批实际效果可以后，才推广到所有门店。先前批次的确认不能代替新批次验收；不能长期只在星野启用，却报告全店已经上线。
3. 店主确认后，若小程序已具备正式发布条件（含审核及发布权限），网页和小程序同步正式上线，并验证所有门店真实可用。
4. 若小程序暂不能正式发布，不因等待小程序而搁置已确认的网页更新：先上线所有门店的网页版；小程序代码和可用体验版保持同步，正式版待具备条件后发布。上传或设置体验版不等于正式发布。
5. 网页先发布时必须核对旧版小程序共用接口、资金及权益规则的兼容。不得默默让旧版业务报错；如无法兼容，应在上线前向店主说明具体受影响流程及过渡安排。本次同意临时通过网页办理充值/退款/开单，只适用于本次发布，不能当作未来任意停用旧版功能的授权。
6. 每次上线保护商家存量数据：一致性备份、生产完整运行时副本升级与重复启动、双端回归、发布后逐店生效及原字段核对。保留原价格、配置、顾客、余额、权益和历史单据，不用演示数据覆盖或重置营业数据。
7. 发布回执分别列明：星野验收与店主确认、网页全店生效、小程序体验版、审核/正式发布、兼容安排及数据核对结果。

此顺序优先于旧文档中“检查通过立即部署”的笼统表述。规则更新本身不触发生产发布；代码仓库中的规则随下一批实际代码一并提交/上线，遵守不为纯文档重启生产的纪律。
