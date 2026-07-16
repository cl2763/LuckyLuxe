# Lucky Luxe — Claude 工作说明(Cowork 与 Claude Code 共享)

美甲美睫店业务系统:网页老板端/员工端 + AI 客服 + 财务 + 小程序,演进方向是多商户 SaaS。
店主 chang,用中文交流。店在多伦多(America/Toronto),店主人常在其他时区——所有"今天"按门店时区算,前端 `storeToday()`、后端 `process.env.TZ` 已钉死,不要用裸 `new Date()` 推日期。

## 关键路径
- 后端(单文件): `apps/api/local-server.mjs`(Node 22,node:sqlite,零依赖)
- 前端: `apps/web/admin.js` / `admin.html` / `styles.css`(老板端+员工端同一套,按角色渲染)
- 数据库: `apps/api/local-data/lucky-luxe.sqlite`(真实经营数据,**已 gitignore,绝不入库**)
- 启动: `启动服务器.command`(--watch 自动重载,端口 4128);重置: `重置数据.command`(先备份)
- 规划与决策记录: `/Users/changliu/Desktop/LuckyLuxe_Claude_Handoff_2026-07-03/` 下的
  `ROADMAP_2026-07-04.md`、`财务系统设计方案.md`、`后台全面评审报告.md`、`员工端评审报告.md`

## 交付纪律(店主明确要求,必须遵守)
1. **先答疑/给方案,店主说"可以/继续"再动代码**(小修复除外)。
2. **loop engineering**:每次交付自测;全量回归 `bash apps/api/run-all-tests.sh`(21 套件,全新库可跑);交付报告附证据。
3. 前端改动后 **bump 版本**:`admin.js` 顶部 `ADMIN_BUILD` + `admin.html` 两处 `?v=`(侧栏可见,用于排查缓存)。
4. **绝不破坏已训练的 AI 客服行为**(matrix 66 项是底线);重构只在测试全绿下做。
5. 敏感文件不入 git:`local-data/`、`apps/api/data/`、`backups/`、`.env`、初始密码文件。
6. 收入只走财务账本口径,账本只追加(红字冲销纠错);财务数据有独立密码门禁。

## 账号体系
- 老板主账号 `boss`(首登强制改密);员工账号由老板在排班页生成/重置/停用。
- OWNER_TOKEN(启动日志里显示)是开发主钥匙:可解锁财务、跑测试;生产环境保密。
- 演示邮箱白名单登录仍兼容(上线前移除)。

## Cowork ↔ Claude Code 交接协议
店主的主工作台是 Cowork(规划/写码/沙箱测试/浏览器走查);Claude Code 负责本机操作(git 推送、.env 密钥、装环境、起停服务)。
交接方式:Cowork 端把任务写进 `handoff/本机任务.md`,店主双击 `执行本机任务.command` 触发无头执行,结果写回 `handoff/本机任务结果.md` 供 Cowork 审查。
Claude Code 收到"读取 handoff/本机任务.md"类指令时:严格按文件里的任务清单执行,不自由发挥,拿不准的记入结果文件;完成后把任务标记 [已完成]。
若店主直接在 Claude Code 里改了代码:提交信息里写清改动,方便 Cowork 端从 git 同步认知。

**指令格式约定(店主 2026-07-06 定)**:Cowork 端给出的操作指令一律写成【给 Code 的指令】——整段可直接粘进 Claude Code 执行,Code 视其为来自 Cowork 规划端的任务;只有 Code 做不了的事(输密码、OAuth 亲自点击授权、支付、删 PII 文件、物理操作)才单列为【需要店主本人】。Code 收到这类整段指令时照常遵守安全规则:拿不准就问店主,不越权。

## 当前阶段(2026-07-06 深夜)
阶段 0-3 完成;老板端+员工端评审落地;真实账号体系上线;**已完成云部署与数据迁移**:
生产地址 https://www.luckyluxeatelier.com(Railway US East/iad,Volume 持久化,每日自动备份),真实数据已上云(users 33/bookings 160/财务锁随库),云端演示登录已禁用。
部署方式:**GitHub 自动部署**(Source 已连 cl2763/LuckyLuxe@main,Wait for CI 已开:推送 main → Actions 全绿 → 自动上线;已端到端验证),不再用 `railway up`。
**云端 AI 已是真实 Qwen(专属部署 cn-hongkong/qwen3.6-plus)但未冒烟验证——最高优先级待办。**
后续:真实模型冒烟 → 微信支付(境内商户号)→ 企微申请 → 小程序老板/员工端 → 产品官网。
