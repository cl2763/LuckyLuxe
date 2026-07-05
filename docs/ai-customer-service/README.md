# Lucky Luxe AI Customer Service Knowledge Base

## 中文

这个文件夹是 Lucky Luxe AI 客服系统第一阶段的知识库基础。

它把可复用的平台知识和 Lucky Luxe 单店私有规则分开，方便未来把同一套系统打包给其他美业商家使用。

### 文件

- `PHASE1_KNOWLEDGE_BASE.md`  
  面向店主和产品侧阅读的第一阶段知识库说明，是业务和运营规则的主要来源。

- `RULEBOOK.md`  
  工程规则手册，规定 AI 客服的路由、记忆、转人工、报价、预约和回归测试锁。它比普通知识库更严格，改 AI 工作流代码前必须先检查它。

- `apps/api/data/ai-customer-service/phase1-kb.seed.json`  
  未来用于 AI 客服后端、RAG 检索、后台知识库编辑器和多商家打包的结构化种子数据。

### 设计原则

- 平台预置知识负责通用美业流程和通用会员运营模板。
- 单店私有知识负责一家店自己的品牌、价目表、员工、营业时间、具体会员规则和特殊政策。
- Lucky Luxe 当前 Silver/Gold/Platinum/Diamond 等级、免定金逻辑、升级门槛和会员权益是 Lucky Luxe 私有知识，不是平台默认规则。
- AI 不应该编造最终美甲报价。
- 复杂美甲参考图需求需要创建技师报价任务。
- 美睫因为价格更固定，可以自动化程度更高，但仍需要确认适配性和是否需要下睫毛。
- 取消、改期、退款、健康、过敏、投诉等问题应转人工。
- 真实对话学习必须经过 owner 审核，才能变成可复用知识。

## English

This folder is the phase-1 foundation for the Lucky Luxe AI customer-service system.

It separates reusable platform knowledge from Lucky Luxe-specific operating rules so the same system can later be packaged for other salons.

## Files

- `PHASE1_KNOWLEDGE_BASE.md`  
  Human-readable product and operations document. This is the owner-facing source of truth for phase 1.

- `RULEBOOK.md`  
  Engineering rulebook for routing, memory, handoff, quote, booking, and regression-lock behavior. This is stricter than the knowledge base and should be checked before changing AI workflow code.

- `apps/api/data/ai-customer-service/phase1-kb.seed.json`  
  Structured seed data for the future AI customer-service backend, RAG retrieval, admin knowledge-base editor, and multi-tenant packaging.

## Design Principles

- Platform preset knowledge should cover common beauty-service workflows and generic member-operation templates.
- Tenant/private knowledge should cover one salon's brand, price table, staff, hours, concrete member rules, and special policies.
- Lucky Luxe's current Silver/Gold/Platinum/Diamond rules, deposit waiver logic, thresholds, and benefits are Lucky Luxe private knowledge, not platform defaults.
- AI should not invent final nail pricing.
- Custom nail reference-image requests create a quote task for a technician.
- Lash pricing can be more automated because service prices are fixed, but suitability and lower-lash needs still need intake questions.
- Cancellation, reschedule, refund, health, allergy, and complaint cases should route to humans.
- Real conversation learning must go through owner approval before it becomes reusable knowledge.
