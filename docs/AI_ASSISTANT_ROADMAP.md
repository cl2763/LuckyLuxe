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

## Future AI Workflow Ideas To Revisit

- AI customer support in web and Mini Program.
- AI sales assistant for style recommendation and booking draft creation.
- AI after-care messages after order completion.
- AI retention reminders for refill, rebalance, or next appointment timing.
- AI referral/member-code follow-up.
- AI content generation from approved gallery images for RED, Douyin, Instagram, and customer share pages.
- Owner-only AI business insights: channels, retention, popular styles, technician performance, and pricing opportunities.
