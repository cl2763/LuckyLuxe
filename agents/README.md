# Lucky Luxe Multi-Agent Workspace

这个目录用于把 Lucky Luxe 的微信小程序、网页端、后台、AI 客服和内容工具拆成多个可协作的 Agent。

目标不是让每个 Agent 变成一个独立项目，而是让每个 Agent 有明确职责、上下文和交接文件。这样之后跨对话工作时，不需要重复解释所有背景。

## 最小协作模型

参考视频里的三类 Agent：

1. 管理 Agent：定方向、拆任务、给验收标准。
2. 执行 Agent：完成具体实现、输出结果。
3. 验收 Agent：独立检查、发现问题、推动返工。

Lucky Luxe 在这个基础上扩展为业务可用的多 Agent 团队。

## Agent 列表

| 目录 | Agent | 职责 |
| --- | --- | --- |
| `00-orchestrator` | 总控 Agent | 接收目标、拆分任务、安排顺序、汇总交付 |
| `01-product-manager` | 产品 Agent | 梳理业务逻辑、用户流程、需求优先级 |
| `02-ui-designer` | UI 设计 Agent | 输出 Figma 设计稿、组件规范、视觉验收标准 |
| `03-miniprogram-engineer` | 小程序 Agent | 实现微信小程序端页面、登录、预约、购物车、我的 |
| `04-web-engineer` | 网页 Agent | 实现客户网页端和 Admin 网页端 |
| `05-backend-engineer` | 后端 Agent | API、数据库、权限、预约锁定、支付回调 |
| `06-qa-reviewer` | QA Agent | 做功能验收、UI 对齐、端到端测试、回归测试 |
| `07-deployment-agent` | 部署 Agent | Railway、域名、环境变量、上线检查 |
| `08-ai-customer-service-agent` | AI 客服 Agent | 企业微信/网页客服、报价流程、转人工、回访 |
| `09-growth-content-agent` | 内容增长 Agent | AI 图库、小红书/抖音/Instagram 文案、分享页 |

## 每个 Agent 的标准文件

每个 Agent 目录都包含：

- `README.md`: 这个 Agent 的职责边界。
- `context.md`: 当前项目背景和需要长期记住的信息。
- `tasks.md`: 当前任务列表。
- `handoff.md`: 给其他 Agent 的交接内容。
- `decisions.md`: 已确认的重要决策。

## 工作流

1. 用户提出需求。
2. `00-orchestrator` 判断涉及哪些 Agent。
3. 对应 Agent 在自己的目录更新任务和结果。
4. 执行类 Agent 完成代码或设计。
5. `06-qa-reviewer` 验收。
6. `00-orchestrator` 汇总给用户。

## Figma UI 工作流

之后 UI 相关任务优先走：

1. `02-ui-designer` 生成 Figma 可编辑稿。
2. 用户在 Figma 修改字号、按钮、模块、位置。
3. `02-ui-designer` 输出设计规格。
4. `03-miniprogram-engineer` 和 `04-web-engineer` 分别落地到小程序和网页端。
5. `06-qa-reviewer` 对比 Figma 与真实截图。
