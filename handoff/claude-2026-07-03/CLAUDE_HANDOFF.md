# Lucky Luxe Project Handoff For Claude

Generated: 2026-07-03
Workspace root: `/Users/changliu/Documents/Codex/2026-04-29/new-chat`

This handoff package is intended to let Claude inspect and modify the current Lucky Luxe codebase. It intentionally excludes secrets such as `.env`, API keys, AppSecrets, database passwords, and service tokens.

The packaged source snapshot also excludes heavy/generated files such as `node_modules`, local SQLite database files, temporary media, and build output. Their paths are documented when relevant.

## Current Product Scope

Lucky Luxe has grown from a single WeChat Mini Program into a broader beauty-business operating system:

- Customer-facing web app.
- WeChat Mini Program customer app.
- Web Admin for owner/staff.
- Local API backend with SQLite demo data.
- Supabase/PostgreSQL production path.
- AI customer-service simulator and rule engine.
- AI customer-service knowledge base and workflow rulebook.
- Early WeCom/WeChat customer-service gateway scaffold.
- Multi-agent project-management documentation.

The intended long-term product is a SaaS platform for beauty businesses with:

- Appointment booking.
- Deposit/payment workflow.
- Customer/member CRM.
- Staff scheduling.
- Owner/staff permissions.
- AI customer service.
- Human handoff.
- Quote task pool.
- Service gallery.
- Multi-store support.
- Plan-based feature limits.

## Important Local URLs

When the local API server is running:

- Customer web app: `http://127.0.0.1:4128/`
- Admin: `http://127.0.0.1:4128/admin`
- AI customer-service simulator: `http://127.0.0.1:4128/wechat-simulator`

The API port has also previously been run on `4000`, `4100`, `4113`, and `4128`. The current active development URL in recent testing has been `4128`.

## Common Local Run Command

From workspace root:

```bash
/Users/changliu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/api/local-server.mjs
```

If a port is busy, inspect the process and restart the server. Do not assume the app is deployed just because local pages load.

## Main File Areas

### Backend

- `apps/api/local-server.mjs`
  - Main local API server.
  - Contains customer-service simulator endpoints, booking/draft logic, AI integration, admin endpoints, WeChat mini login, mock payment, scheduling, and local demo data.

- `apps/api/supabase-server.mjs`
  - Production/Supabase-oriented server path.

- `apps/api/ai-utils.mjs`
  - AI provider integration. Currently uses an OpenAI-compatible API key variable pattern.

- `apps/api/local-data/lucky-luxe.sqlite`
  - Local SQLite demo database. Treat as non-production test data.
  - This file is large and is excluded from the handoff zip by default. Ask the owner for it separately only if database-level debugging is required.

- `apps/api/data/ai-customer-service/phase1-kb.seed.json`
  - Structured seed data for AI customer service knowledge base.

- `apps/api/test-customer-service-matrix.mjs`
  - Regression matrix for AI customer-service logic.

- `apps/api/test-working-memory.mjs`
  - Working-memory test script.

- `apps/api/test-after-sales-handoff.mjs`
  - After-sales/handoff regression test.

- `apps/api/test-human-handoff.mjs`
  - Human handoff regression test.

- `apps/api/test-silent-handoff.mjs`
  - Silent handoff regression test.

### Web Frontend

- `apps/web/index.html`
- `apps/web/customer.js`
- `apps/web/admin.html`
- `apps/web/admin.js`
- `apps/web/wechat-simulator.html`
- `apps/web/wechat-simulator.js`
- `apps/web/styles.css`

The web frontend is plain HTML/CSS/JS. Customer, admin, and simulator are separate pages but share styles and backend APIs.

### WeChat Mini Program

- `miniprogram/app.js`
- `miniprogram/app.json`
- `miniprogram/app.wxss`
- `miniprogram/utils/api.js`
- `miniprogram/utils/mock-data.js`
- `miniprogram/utils/storage.js`
- `miniprogram/utils/i18n.js`
- `miniprogram/custom-tab-bar/*`

Important pages:

- `miniprogram/pages/home/*`
- `miniprogram/pages/services/*`
- `miniprogram/pages/service-detail/*`
- `miniprogram/pages/booking/*`
- `miniprogram/pages/cart/*`
- `miniprogram/pages/checkout/*`
- `miniprogram/pages/me/*`
- `miniprogram/pages/orders/*`
- `miniprogram/pages/order-detail/*`
- `miniprogram/pages/member-benefits/*`
- `miniprogram/pages/portfolio/*`
- `miniprogram/pages/admin/*`
- `miniprogram/pages/admin-login/*`

The owner has recently decided that the heavy Admin should remain web-first. The Mini Program may keep customer-facing features and possibly lightweight staff/owner functions later.

### AI Customer Service Docs

- `docs/ai-customer-service/RULEBOOK.md`
- `docs/ai-customer-service/PHASE1_KNOWLEDGE_BASE.md`
- `docs/ai-customer-service/README.md`
- `docs/ai-customer-service/Lucky_Luxe_AI_Customer_Service_Phase1_KB.pdf`

These files are important. `RULEBOOK.md` is stricter than the general knowledge base and should be treated as the workflow source of truth.

### Agent Docs

- `agents/README.md`
- `agents/00-orchestrator/*`
- `agents/01-product-manager/*`
- `agents/02-ui-designer/*`
- `agents/03-miniprogram-engineer/*`
- `agents/04-web-engineer/*`
- `agents/05-backend-engineer/*`
- `agents/06-qa-reviewer/*`
- `agents/07-deployment-agent/*`
- `agents/08-ai-customer-service-agent/*`
- `agents/09-growth-content-agent/*`
- `docs/agent-daily-reports/*`

The user expects daily or periodic agent-style progress summaries.

## Current High-Level Architecture Recommendation

The project should move toward:

```text
Unified customer/service backend
  |
  |-- Web customer channel
  |-- WeChat Mini Program channel
  |-- WeCom / WeChat customer-service channel
  |-- Admin customer-service workbench
```

Do not build separate business logic for web and Mini Program. Build:

- One user identity system.
- One membership system.
- One booking/draft system.
- One scheduling system.
- One AI customer-service memory layer.
- Channel adapters for web, Mini Program, and WeCom/WeChat.

## Identity Design Direction

Use a unified identity model:

- `global_user_id`: internal platform user.
- `member_code`: user-visible member code.
- `tenant_id`: merchant/business/brand.
- `store_id`: physical store.
- `tenant_customer_id`: customer membership profile under one tenant.
- `identity_links`: phone, email, Google ID, WeChat Mini Program openid, unionid, WeCom external_userid, web WeChat identity.

Important: Mini Program login does not automatically give customer-service access to member information. We must map WeChat identity to the backend `global_user_id` / `tenant_customer_id`.

## AI Customer Service Current State

Recent development focused on:

- Qwen real API integration for simulator responses.
- Customer-service simulator.
- Working memory.
- Quote workflow.
- Human handoff.
- Silent handoff for unknown/out-of-knowledge messages.
- Intake templates for nail/lash appointment/quote collection.
- Technician quote task pool.
- Draft appointment creation.
- Regression tests.

Major current concern from user:

- AI must not invent missing facts.
- AI must preserve all technician-provided key information.
- AI must remember multi-turn context, not only one message.
- Human takeover must stop AI replies until explicitly returned or the 10-minute auto-return rule applies.
- If AI does not know how to answer, it should silently mark human-needed in admin, not hallucinate.
- Customer-service simulator must allow realistic continuous chat testing.

## Current Business Decisions

Lucky Luxe private rules:

- Currency: CAD.
- Deposit: CAD 50 by default.
- New customers are treated as Silver Member.
- Member tiers: Silver, Gold, Platinum, Diamond.
- Higher tiers may waive deposit according to configured rules.
- Lucky Luxe membership rules are private tenant knowledge, not platform preset knowledge.

Future SaaS target segments:

1. Individual nail artist.
2. Small studio with staff.
3. Multi-store/chain business.
4. Custom enterprise plan.

AI customer service should be an add-on module or included by tier with usage limits/trial.

## Recent Council Conclusion

The LLM Council judged:

- Build a real customer-service middle layer first.
- Keep web and Mini Program data unified.
- Treat WeChat/Mini Program/Web as channel adapters.
- Do not assume WeChat can freely push messages or expose member data automatically.
- Store all conversation memory in our own database.
- Design for SaaS tenant/store isolation now.
- Keep heavy Admin web-first; Mini Program admin should be lightweight if added.

## Security Notes

Do not commit or share:

- `apps/api/.env`
- API keys
- AppSecret
- Supabase database password
- Stripe secret
- WeCom secret/token
- Cloudflare token
- Railway tokens

This bundle excludes `.env`. If Claude needs to run real integrations, configure local environment variables manually.
