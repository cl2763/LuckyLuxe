# Handoff

给后端 Agent：

- AI 可调用 API。
- 权限边界。
- 会话摘要存储需求。
- 接入 `apps/api/data/ai-customer-service/phase1-kb.seed.json` 作为后续 RAG/知识库管理 seed。
- 已接入 `apps/api/kb-utils.mjs` 作为第一阶段轻量知识检索；`createCustomerServiceReply` 会接收并返回 `knowledgeContext`。
- 后台微信客服 Mock 的真实/测试会话详情会显示命中的知识条目，便于判断回答问题来自平台模板、Lucky Luxe 私有规则，还是转人工规则。
- 后续需要设计 knowledge_entries 表，字段至少包含 tenant_id、scope、category、status、source、content、variables、version、approved_by、effective_from。
- quote task、reminder task、booking draft、customer profile 都应作为工具/数据库查询，不应该写死进 prompt。

给产品 Agent：

- 需要确认的话术和规则。
- 需要确认会员升级阈值、售后窗口、取消/改期例外、称呼变量、最终服务价目表。
