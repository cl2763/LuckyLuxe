# Lucky Luxe AI Assistant Roadmap

## Current System Improvements Before AI Support

- Nail pricing must be shown as a base price. Complex design details, extensions, removal, special materials, 3D pieces, heavy rhinestones, or reference-image variance require manual quote confirmation.
- Lash pricing must be shown as fixed pricing. Add-ons are explicit before checkout, and the confirmed add-on total becomes the final quote.
- Reference image upload should support AI analysis before checkout. The analysis should include style tags, complexity, estimated extra time, estimated price guidance, and whether manual quote confirmation is recommended.
- Admin access uses one login system with role-based display:
  - Owner can see finance, customers, service editing, schedule editing, orders, AI gallery, and operational analysis.
  - Staff can see order workflow, technician status, and AI gallery work upload/review actions without finance or customer-sensitive areas.
- After-sales and retention actions should be handled later through AI support and notification workflows, not as isolated static UI.

## AI Support / Sales Assistant Expectations

- Shared backend API for web and WeChat Mini Program.
- Public visitor can ask about services, store rules, pricing boundaries, care guidance, deposits, cancellation policy, and available booking flow.
- Logged-in customer can ask about their own orders, member code, coupons, deposit status, finished work archive, and next-visit suggestions.
- AI can ask guided questions, recommend service categories, and create a booking draft, but final booking confirmation and deposit payment must remain user-confirmed.
- Nail quote questions with custom reference images should trigger conservative AI guidance and offer manual staff quote transfer.
- Lash quote questions can return fixed pricing plus clear add-on rules.
- Admin should have a conversation history page showing solved conversations, transferred cases, customer intent, source channel, and booking conversion.
- AI should never invent prices. It must read service pricing from the system and mark custom nail designs as manual quote required when uncertain.

## Current Architecture Started

- Shared AI core:
  - `createCustomerServiceReply()` in `apps/api/ai-utils.mjs`.
  - Uses the same provider switch as the other AI tools: mock mode by default, real OpenAI-compatible model when `AI_PROVIDER`, `AI_MODEL`, and `AI_API_KEY` are configured.
  - Returns structured fields: intent, bilingual answer, handoff flag, handoff reason, suggested actions, and suggested follow-up questions.
- Shared backend endpoint:
  - `POST /ai/customer-service`.
  - Public visitor context includes active services and stores.
  - Logged-in customer context also includes the customer's recent bookings.
  - The endpoint does not create bookings or charge payment directly. It only replies and suggests the next app action.
- Web customer entry:
  - Floating AI concierge widget in the customer web app.
  - Supports quick prompts, free-text questions, local conversation memory, and handoff notice for manual quote cases.
- Admin customer tracking:
  - Customer profiles now open into a detail view.
  - The detail view shows every booking record tied to that customer, including service, date/time, technician, source channel, image count, deposit/final due, status, and order detail expansion.

## WeChat Customer Service Adapter Plan

- Keep one AI brain:
  - Web chat and WeChat chat should both call the same `/ai/customer-service` core.
  - The WeChat layer should only translate WeChat messages into the internal AI request format and translate the AI reply back into WeChat messages.
- WeChat Mini Program path:
  - Use the Mini Program's customer service message capability after the AppID and required merchant/account setup are available.
  - Map `openid`/unionid to Lucky Luxe user records before exposing personal order data.
  - If the visitor is unknown, only answer public service, price-boundary, policy, and store questions.
- Manual handoff:
  - If `handoffRequired` is true, the WeChat adapter should mark the thread for owner/staff follow-up.
  - Handoff triggers include exact custom nail quote, complaint/refund dispute, payment issue, unclear medical/safety question, or any request outside approved business rules.
- Data privacy boundary:
  - The AI can see only the minimum context needed for the answer.
  - Staff/owner-only finance, other customers' records, and internal notes should never be sent to customer-facing AI.

## Confirmed WeChat Reception Flow

- Public assistant name: `Lucky Luxe 预约助手`.
- Default greeting:
  - `您好欢迎来到 Lucky Luxe，我是您的预约助手，您有任何问题可以随时向我咨询，可以帮您了解美甲/美睫服务、价格规则、预约时间、定金和护理说明。如果是复杂美甲款式，也可以先发参考图，我会帮您整理需求并转给技师确认报价。`
- After the greeting, send a separate channel-source question:
  - Chinese options: `小红书`, `抖音`, `大众点评/美团`, `朋友推荐`, `其他`.
  - English options: `Google`, `Instagram`, `WeChat`, `TikTok`, `Friend referral`, `Other`.
- Nail quote flow:
  - AI asks for and receives reference images.
  - AI extracts quote elements: extension needed, removal needed, broken nail repair, charms/rhinestones/decoration, complexity level, missing information.
  - AI creates an internal quote task for a nail artist. This is not a customer-facing manual handoff.
  - The artist returns rough keywords: can/cannot do, price, estimated duration, missing elements, and notes.
  - AI rewrites the artist response into a warm professional customer-facing reply.
  - AI asks whether the customer wants an appointment draft.
  - If yes, AI creates a draft and sends a Mini Program deep link for final confirmation and CAD $50 deposit payment.
- Draft lifecycle:
  - 10 minutes without deposit: send one payment reminder.
  - 30 minutes without deposit: release and expire the draft.
  - Deposit paid: send an appointment-confirmed message in the chat.
- Quote timeout:
  - Tell the customer the quote is being checked and is expected within 10 minutes.
  - If no artist reply within 10 minutes, send a polite waiting notice: the artist is currently serving a client, and the customer will be notified as soon as there is a reply.
- Human takeover:
  - Cancellation/reschedule goes to the relevant technician.
  - Complaints, refunds, payment issues, allergy/health questions, and complex disputes go to owner.
  - When a human fully takes over, AI stops replying to the customer until the human explicitly transfers the conversation back to AI.
- Follow-up:
  - 7 days after service: ask about retention/current condition, fallout/discomfort, and whether care advice is needed.
  - 3-4 weeks after service: refill/rebalance/rebooking reminder.
  - When AI gallery work is ready: notify the customer to check finished photos.

## Productized Packaging Direction

- The system should be designed as a reusable beauty-service AI front desk, not a Lucky-Luxe-only custom script.
- Recommended commercial packaging path:
  - Use WeCom / WeChat Customer Service as the default China-WeChat adapter.
  - Keep the AI brain, booking workflow, quote workflow, and reminder workflow platform-agnostic.
  - Treat WeChat, web chat, future Instagram/WhatsApp/SMS, and Mini Program as replaceable channel adapters.
- Multi-tenant principles:
  - Each salon has its own tenant config: brand name, greeting, service menu, price rules, staff list, store locations, booking policy, channel options, AI tone, and handoff rules.
  - Secrets and WeChat credentials must be tenant-scoped.
  - Customer data, bookings, chat summaries, and finance data must be isolated per tenant.
- White-label settings to avoid hard-coding:
  - Assistant display name.
  - Greeting text.
  - Source-channel options by language.
  - Service categories and price-boundary rules.
  - Deposit amount and draft expiry policy.
  - Handoff routing rules.
  - Follow-up schedule.
  - Mini Program/app deep-link targets.
- Sales-friendly product modules:
  - AI front desk.
  - Reference-image quote triage.
  - Staff quote task workflow.
  - Booking draft and deposit reminder.
  - AI gallery and customer photo delivery.
  - Retention follow-up.
  - Owner dashboard and customer profile tracking.
- Important packaging decision:
  - Do not build the product around a personal WeChat bot. It is fragile and hard to sell safely.
  - Build around official WeCom / WeChat Customer Service adapters so another salon can authorize their own account and use the same system with their own staff.

## Mock Implementation Status

- Admin now includes a `WeChat Mock` workbench for the `Lucky Luxe 预约助手` flow.
- The mock workbench previews:
  - inbound customer source capture,
  - AI welcome and channel question,
  - custom nail reference-image quote triage,
  - staff quote return,
  - AI-polished customer reply,
  - booking draft creation,
  - 10-minute payment reminder,
  - 30-minute draft release,
  - reschedule/manual takeover routing.
- This mock is frontend-only and does not require real WeChat, WeCom, Mini Program, or model API credentials yet.
- The mock page is intentionally available to both owner and staff accounts because technicians need to see quote tasks, while owner-only finance/customer data remains restricted elsewhere.

## Real API Inputs Needed Later

- For real WeCom / WeChat Customer Service integration, Lucky Luxe will need to provide:
  - WeCom company account or WeChat Customer Service account access.
  - `CorpID` if using WeCom.
  - customer-service `Secret` / API credential.
  - customer-service account identifier such as `open_kfid`.
  - webhook `Token` and `EncodingAESKey` generated in the WeChat admin console.
  - approved callback URL, likely under `https://www.luckyluxeatelier.com`.
  - staff accounts to receive quote tasks and manual takeover.
  - Mini Program `AppID` and target draft-booking page path after the Mini Program account is approved.
  - final service price table and quote rules for model grounding.
- For the current mock version, no new credential is required from the owner.

## Future AI Workflow Ideas To Revisit

- AI customer support in web and Mini Program.
- AI sales assistant for style recommendation and booking draft creation.
- AI after-care messages after order completion.
- AI retention reminders for refill, rebalance, or next appointment timing.
- AI referral/member-code follow-up.
- AI content generation from approved gallery images for RED, Douyin, Instagram, and customer share pages.
- Owner-only AI business insights: channels, retention, popular styles, technician performance, and pricing opportunities.
