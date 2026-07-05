# Lucky Luxe 多 Agent 协作方案

本文基于视频《让 Codex 多 Agent 自主协同，只要说了一句话！》中展示的协作思路整理，用于 Lucky Luxe 微信小程序、网页端、Admin、后端、AI 客服和内容工具的长期开发。

## 1. 视频里可复用的核心逻辑

视频中的关键不是“让一个 AI 一次性完成所有事”，而是把工作拆成多个职责明确的 Agent：

- 管理 Agent：负责方向、标准和任务拆解。
- 执行 Agent：负责具体实现和结果交付。
- 验收 Agent：负责独立检查、发现问题、推动返工。

进一步扩展后，可以让不同 Agent 拥有自己的工作区、日志、产出物和交接记录。这样它们之间可以跨对话协作，而不是每次都从零开始解释背景。

## 2. Lucky Luxe 应采用的 Agent 团队

### 00 Orchestrator Agent

总控 Agent。负责把用户需求拆给其他 Agent，并在最后汇总。

适合处理：

- “这次需求涉及哪些端？”
- “先做 UI，还是先做后端？”
- “哪些内容需要用户确认？”
- “这轮改动完成了吗？”

### 01 Product Manager Agent

产品 Agent。负责业务逻辑、页面流程和规则边界。

适合处理：

- 美甲价格和人工报价边界。
- 美睫固定价格说明。
- 会员规则。
- 预约、取消、改期、退款规则。
- AI 客服能回答什么，什么必须转人工。

### 02 UI Designer Agent

UI 设计 Agent。之后要和 Figma 插件联动，负责把页面做成可编辑设计稿。

适合处理：

- 小程序移动端页面。
- Web 客户端页面。
- Web Admin 页面。
- 登录弹窗。
- 首页、服务、购物车、我的、订单详情。
- 把 Figma 修改稿翻译成实现规格。

输出应包括：

- Figma 可编辑稿。
- 组件列表。
- 字号、颜色、间距、圆角标准。
- 截图验收标准。

### 03 Mini Program Engineer Agent

小程序工程 Agent。负责微信小程序真实实现。

适合处理：

- WXML/WXSS/JS。
- 微信登录。
- 手机号授权。
- 预约和购物车。
- 与后端 API 对接。
- 小程序体验版和真机问题。

### 04 Web Engineer Agent

网页工程 Agent。负责 Web 客户端和 Web Admin。

适合处理：

- 客户网页端。
- Owner/Admin 后台。
- AI 图库页面。
- 订单管理。
- 客户档案。
- 财务和数据看板。

### 05 Backend Engineer Agent

后端 Agent。负责服务端、数据库、权限和支付。

适合处理：

- Supabase/Postgres。
- Railway API。
- 微信登录 code 换 openid/session。
- 手机号授权解密。
- 预约锁定。
- 支付订单和回调。
- 多门店和多租户。

### 06 QA Reviewer Agent

验收 Agent。负责独立检查。

适合处理：

- 小程序真机 UI 是否和 Figma 一致。
- 页面是否溢出。
- 登录按钮是否真的能触发。
- 预约和支付流程是否闭环。
- Admin 数据是否能追溯到订单。

### 07 Deployment Agent

部署 Agent。负责上线环境。

适合处理：

- Railway。
- Supabase。
- Cloudflare DNS。
- 小程序合法域名。
- 小程序上传体验版/提审。
- 环境变量检查。

### 08 AI Customer Service Agent

AI 客服 Agent。负责客服工作流。

适合处理：

- Lucky Luxe 预约助手。
- 渠道询问。
- 美甲参考图需求整理。
- 美甲师报价转接。
- 预约草稿创建。
- 支付提醒。
- 回访和复购。

### 09 Growth Content Agent

内容增长 Agent。负责 AI 图库和平台内容。

适合处理：

- 作品图整理。
- AI 修图流程。
- 小红书/抖音/Instagram 文案。
- 分享链接。
- 技师作品集。

## 3. 目录结构

当前已建立：

```text
agents/
  README.md
  00-orchestrator/
  01-product-manager/
  02-ui-designer/
  03-miniprogram-engineer/
  04-web-engineer/
  05-backend-engineer/
  06-qa-reviewer/
  07-deployment-agent/
  08-ai-customer-service-agent/
  09-growth-content-agent/
```

每个 Agent 都有：

```text
README.md
context.md
tasks.md
handoff.md
decisions.md
```

## 4. 跨对话协作方式

每次开始一个较大任务时：

1. Orchestrator 先读 `agents/README.md`。
2. 判断涉及哪些 Agent。
3. 相关 Agent 读取自己的 `context.md` 和 `decisions.md`。
4. 在 `tasks.md` 中记录本轮任务。
5. 完成后把交接内容写入 `handoff.md`。
6. QA Agent 独立检查。
7. Orchestrator 汇总交付。

## 5. UI + Figma 工作流

之后 UI 需求优先走这个流程：

1. UI Designer Agent 生成 Figma 可编辑稿。
2. 用户在 Figma 内修改文字、字号、模块、按钮和布局。
3. UI Designer Agent 读取最终稿并输出实现规格。
4. Mini Program Engineer Agent 落地小程序。
5. Web Engineer Agent 落地网页端。
6. QA Reviewer Agent 对比 Figma 和真机/网页截图。

这样可以避免用户用文字反复描述“往左一点、撑满一点、字号大一点”，而是直接在 Figma 里改出目标效果。

## 6. 视频文案工具如何进入 Agent 流程

新建的 `tools/video-transcript` 工具可以作为“资料输入工具”：

1. 用户给一个视频链接。
2. 工具提取字幕或转写音频。
3. Product Manager Agent 分析视频内容。
4. Orchestrator 把可复用流程拆给 UI、工程、QA 或 AI 客服 Agent。

后续可扩展为：

- 自动提取 SOP。
- 自动生成 Agent 分工。
- 自动生成产品需求文档。
- 自动生成 UI 参考清单。
