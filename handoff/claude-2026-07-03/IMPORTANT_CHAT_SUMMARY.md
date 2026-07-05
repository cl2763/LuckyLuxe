# Important Conversation Summary For Claude

This is a reconstructed summary of the long Codex conversation. It is not a raw transcript. It omits secrets and credentials.

## Original Goal

The user first wanted a Lucky Luxe WeChat Mini Program demo for a nail/lash business, then expanded the system into:

- WeChat Mini Program.
- Web customer app.
- Web Admin.
- Shared backend/database.
- Real deployment.
- Supabase/Railway deployment path.
- WeChat login and future WeChat Pay.
- AI customer service.
- WeCom/WeChat customer-service integration.
- SaaS packaging for other beauty merchants.

## Important UI History

The user repeatedly emphasized:

- Web and Mini Program customer logic should match.
- Mini Program must be true mobile layout, not web layout squeezed into phone.
- Service cards and recent order cards must fill the available width.
- The "My/Profile" page must not show fake member data when guest.
- Login modal should be simple and functional.
- Admin heavy work should remain web-first.
- The user cares strongly about visual alignment, button text centering, and consistent card widths.
- If Figma UI differs from Mini Program implementation, the Figma export is not useful.

## Authentication History

WeChat Mini Program login went through multiple attempts:

- `wx.login` works as identity login and returns backend-created user ID.
- Avatar/nickname native selection has been unreliable in real-device testing.
- Phone authorization hit privacy scope/configuration issues.
- User later accepted a simpler one-click login where a system-generated ID is used, with profile completion optional.
- User wants future profile completion to remain possible.
- Need unified internal user table so web and Mini Program can match the same person.

Important identity requirement:

- Every customer should have a unique member code.
- Web login methods may include phone, email, Google, and WeChat.
- Mini Program login uses WeChat.
- All identities should link to one internal `global_user_id` where possible.

## Payment And Booking

Deposit and payment rules:

- CAD currency.
- Fixed CAD 50 deposit for normal/new users.
- Higher member tiers may waive deposit.
- Balance is paid in store.
- WeChat Pay is not fully connected yet.
- Stripe placeholder/mock exists for web.

Booking rules:

- One appointment contains one service.
- Nail and lash appointments are separate if both are booked.
- Lash service is normally 2 hours.
- Nail minimum is 2 hours, with duration depending on extensions/removal/design/add-ons.
- Booking time should only be locked after successful deposit or valid deposit waiver.
- If requested time is unavailable, system should propose nearest available time and explain store hours if outside business hours.

## AI Customer Service Evolution

The simulator began as rule/mock logic, then real Qwen API was connected.

User was unhappy when:

- AI seemed to ignore previous messages.
- AI triggered quote tasks too early.
- AI created booking drafts before date/time were confirmed.
- AI invented missing facts.
- AI failed to pass historical images to technician quote tasks.
- AI lost technician quote details when polishing.
- AI replied to out-of-scope messages instead of silently handing off.
- Human replies did not properly stop AI.

Key rules user wants:

- Do not invent unmentioned information.
- Preserve all technician key information when polishing.
- Quote task should include historical images from the conversation.
- If customer sends more images during quote waiting, append them to the quote context.
- If human takes over, AI must not reply until explicitly returned or auto-return after 10 minutes.
- If out of knowledge base, silently mark as needs human; do not tell customer "I will transfer you".
- If after-sales issue, do not promise refund/free redo; collect context and hand off.
- New customer welcome path must not be overwritten.
- Returning customer should receive two messages: fixed welcome plus contextual reply.
- Old customer with consumption history should not be treated like a new quote-only customer.

## AI Customer Service Current Design Direction

Use structured working memory:

- customerType
- memberTier
- serviceType
- channel
- language
- workflowStage
- intakeFields
- referenceImages
- quoteStatus
- technicianQuote
- date/time candidates
- draft status
- human takeover state
- unresolved fields

Use rule precedence:

1. Safety, privacy, payment, refund, medical, handoff boundaries.
2. Lucky Luxe private rules.
3. Working memory.
4. Current message.
5. Model wording.

## Intake Templates

Nail intake template:

1. 项目类型：美甲
2. 想做日期和时间：
3. 是否需要卸甲：
4. 是否需要延长：
5. 是否有断甲需要修补：
6. 是否有参考图：有的话请直接发图；没有也可以写“无图”
7. 其他备注：

The user later specified:

- Do not require every field before human quote.
- If most critical info is available, send to technician.
- Do not ask about rhinestones/pearls/complex decorations as required precondition.
- If customer is unsure between natural nails and extensions, technician may quote both.

Lash:

- Ask upper/lower lash needs where relevant.
- If first-time lash customer, mark it for technician.
- After technician quote, send first-time lash notes.

## After-Sales Knowledge

After-sales topics include:

- Nail lifting/opening.
- Broken nail.
- Gems or decorations falling off.
- Color dissatisfaction.
- Lash falling.
- Eye redness, stinging, allergy, discomfort.
- Complaint/refund.

AI should:

- Acknowledge gently.
- Ask for service date and current photo if needed.
- Hand off to human/owner.
- Avoid promising refund, compensation, free redo, or fault.

## SaaS Direction

The user wants the system to eventually be sold to:

1. Individual nail artists.
2. Small studios.
3. Chain/multi-store businesses.
4. Custom enterprise clients.

Suggested product structure:

- Core booking/CRM system.
- AI customer service add-on.
- Feature flags by plan.
- Tenant/store isolation.
- Merchant self-service settings.
- Platform preset knowledge base + tenant private knowledge base.

Membership rules are Lucky Luxe private knowledge, not platform preset.

## Current User Request Before This Handoff

The user asked not to modify code yet and to package:

- All important project files.
- Important chat records.
- File paths.
- Enough context for Claude to inspect and potentially modify the project.

This handoff package is for that purpose only.

