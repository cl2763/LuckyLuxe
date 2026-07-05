# Lucky Luxe AI Customer Service Phase 1 Knowledge Base

Generated for Lucky Luxe on 2026-06-26.

## 1. Goal

Phase 1 creates the knowledge-base and workflow foundation for a reusable beauty-service AI front desk.

The system should support Lucky Luxe now, while also being structured so the same platform can later be sold to other salons. The product should not hard-code Lucky Luxe rules into the AI brain. Instead, it should separate:

- platform preset knowledge,
- tenant-specific business rules,
- structured operational data,
- AI tone and response behavior,
- human review and learning loops.

## 2. Knowledge Layers

### 2.1 Platform Preset Knowledge

This layer can be shared by most nail/lash/beauty salons.

It includes:

- nail service basics,
- lash service basics,
- common customer-service tone,
- common booking flow,
- common cancellation and reschedule patterns,
- common after-sales handling,
- common retention and member-operation templates,
- human handoff categories,
- AI safety boundaries.

This layer should not include Lucky Luxe pricing, staff names, exact address, exact promotions, concrete member tier rules, deposit waiver rules, member upgrade thresholds, member benefits, or private policy exceptions.

Important boundary: platform preset knowledge can teach the AI how to run a generic member-operation conversation, but it must not contain Lucky Luxe's actual Silver/Gold/Platinum/Diamond rules. Those rules are Lucky Luxe private tenant knowledge.

### 2.2 Tenant Private Knowledge

This layer belongs to one business tenant.

For Lucky Luxe, it includes:

- brand name: Lucky Luxe,
- assistant name: Lucky Luxe 预约助手,
- currency: CAD,
- store region: Ontario,
- default business hours: Tuesday to Sunday 10:00-19:00, Monday closed,
- deposit amount: CAD $50 for new/Silver customers,
- member levels: Silver, Gold, Platinum, Diamond,
- concrete member upgrade thresholds, deposit waiver logic, and benefits,
- payment rules,
- store-specific promotions,
- final service menu and price table,
- technician list and routing,
- store-specific refund or goodwill handling.

In a packaged SaaS version, each salon will own its tenant-private knowledge and can update it without changing platform knowledge.

### 2.3 Structured Business Data

The AI should not "remember" volatile operational facts by model memory.

These must come from database/tool calls:

- customer profile,
- identity mappings across web, Mini Program, and future WeChat login,
- member level,
- deposit-waiver eligibility,
- bookings,
- payment state,
- quote tasks,
- technician response,
- service catalog,
- store hours,
- reminder tasks,
- image/gallery state.

### 2.4 Tone and Style Layer

The owner's preferred tone should be extracted into reusable guidance:

- warm and professional,
- not robotic,
- gently explanatory,
- does not over-apologize,
- does not sound defensive,
- uses soft transitions such as "我帮您确认一下", "您放心", "这边先帮您整理需求",
- avoids cold policy-only replies.

Customer placeholders such as `XXX` should become variables, not fixed text.

Recommended variable:

```text
${customer_title}
```

Possible future settings:

- "您好",
- "亲爱的",
- "宝贝",
- "小姐姐",
- blank/no title,
- English first name.

## 3. Platform Preset Knowledge

### 3.1 Nail Basics

Nail services can include:

- natural nail service,
- extension,
- old set removal,
- broken nail repair,
- rhinestones,
- charms,
- hand painting,
- gradient,
- French,
- Japanese-style detail,
- heavy decoration,
- custom reference-image design.

The AI can explain these concepts, ask intake questions, and organize customer needs.

The AI must not give a final price for custom nail work unless the service is explicitly fixed-price in the database.

For custom/reference-image nail requests, AI should collect:

- reference images,
- natural nail or extension preference,
- whether old nails need removal,
- whether broken nail repair is needed,
- desired length,
- desired color changes,
- rhinestones/charms/hand painting,
- preferred date/time,
- budget sensitivity,
- any notes.

Then create a technician quote task.

### 3.2 Lash Basics

Lash services are more suitable for fixed pricing.

The AI can explain:

- natural lash,
- volume lash,
- removal,
- lower lashes,
- add-ons,
- expected service duration,
- suitability checks.

Required lash intake:

- desired style,
- whether old lashes need removal,
- whether lower lashes are needed,
- whether this is the customer's first lash service,
- recent eye redness or irritation,
- allergy history,
- eye surgery within the last 3 months,
- pregnancy or medical sensitivity if voluntarily mentioned.

The AI should avoid medical claims. When in doubt, route to staff.

First-time lash notice after technician quote:

- Ask the customer to tell staff in advance if they had eye surgery within 3 months or currently have conjunctivitis, redness, inflammation, allergy, or eye discomfort.
- Recommend natural or lightweight styles for the first appointment.
- Ask the customer to avoid mascara/heavy eye makeup on appointment day and keep the eye area clean.
- Ask the customer to tell the technician immediately if there is stinging, fumes, tearing, or discomfort.
- Aftercare: avoid steam/water, rubbing eyes, and oil-based remover for about 6 hours; avoid sauna/steaming/long hot-water steam for 24 hours.
- Do not add unrelated accessory-wearing advice unless the customer asks.

### 3.3 Booking Basics

General rules:

- one booking contains one service only,
- nail and lash need separate bookings,
- booking draft can hold a time slot for 30 minutes,
- final confirmation and payment must be completed by the customer,
- AI can create a draft but should not silently confirm or charge payment.

### 3.4 Cancellation and Reschedule Basics

Rules can be machine-readable, but exceptions require human handling.

General handling:

- more than 24 hours before appointment: normally cancellable/reschedulable according to salon policy,
- within 24 hours: route to human,
- same-day cancellation/reschedule: route to human,
- late arrival: route to human if it affects service duration or deposit,
- illness/emergency: route to human,
- disputes: route to owner.

Important customer-facing rule:

Never reply with "this cannot happen" or "impossible". Internal notes may say that a case is unlikely, but customer-facing AI should respond by checking the order or routing to staff.

### 3.5 After-Sales Basics

Common after-sales categories:

- rhinestone/charm fell off,
- lifting,
- color mismatch,
- dissatisfaction after leaving,
- lash fallout,
- discomfort or allergy,
- request to delete photos,
- complaint about technician.

General handling:

- ask for photos if needed,
- check service date,
- route quality disputes to staff/owner,
- avoid promising unlimited redo,
- follow store-specific warranty window.

Executable routing rules:

- After-sales signals must interrupt quote and booking templates. If the customer says 开胶、起翘、掉钻、掉色、不满意、掉睫、红肿、刺痛、过敏、售后、返修, the AI must not send the nail/lash intake form.
- For known after-sales issues, AI may acknowledge, ask for current photo and service date, and route to staff/owner. It must not decide refund, free repair, compensation, or blame.
- Health or discomfort issues such as eye redness, stinging, allergy, or inflammation should route to owner/staff with higher priority and should avoid medical advice.
- If the message is outside the knowledge base or the AI cannot confidently classify it, use silent human handoff: mark the conversation as needing human attention without telling the customer an incorrect answer.

## 4. Lucky Luxe Private Knowledge v1

### 4.1 Brand and Assistant

- Brand: Lucky Luxe
- Assistant display name: Lucky Luxe 预约助手
- Default language: Chinese, but reply in the customer's language.
- Tone: gentle, professional, human front-desk style.

### 4.2 Currency and Deposit

- Currency: CAD
- New customers are Silver members.
- Silver/new customers pay CAD $50 deposit when confirming a booking.
- Deposit is applied toward the final bill.
- Remaining balance is paid in store.
- Gold, Platinum, and Diamond members can normally waive deposit.
- Deposit waiver can be suspended if the customer has repeated cancellation/no-show risk.

### 4.3 Member Levels

Confirmed level names:

1. Silver
2. Gold
3. Platinum
4. Diamond

The exact upgrade thresholds still need final confirmation by owner.

Suggested placeholder rule:

- Silver: default new customer level.
- Gold: after a defined cumulative spend or visit threshold.
- Platinum: higher cumulative spend or visit threshold.
- Diamond: highest loyalty tier.

System requirement:

Member level must affect checkout deposit logic. If the customer is eligible for deposit waiver, checkout should show deposit waived instead of charging CAD $50.

### 4.4 Nail Pricing Rule

Current Lucky Luxe rule:

- Nail services show base price.
- Custom/reference-image nail work requires technician quote.
- AI can organize the customer need.
- Technician confirms can/cannot do, approximate price, duration, missing elements, and notes.
- AI rewrites technician response warmly for the customer.
- Final in-store adjustment may still happen if the customer changes the design.

This rule is appropriate for current data maturity. It avoids premature AI final pricing and keeps service quality controlled.

### 4.5 Lash Pricing Rule

- Lash services should follow fixed prices and explicit add-ons.
- AI should ask whether the customer needs lower lashes.
- AI should ask suitability questions when relevant.
- AI should not finalize if allergy, eye irritation, recent surgery, or pregnancy/health uncertainty is raised.

### 4.6 Manual Handoff

Route to human when:

- exact custom nail quote is needed,
- customer asks to change/cancel/reschedule,
- refund dispute,
- illness/emergency exception,
- complaint,
- allergy/health concern,
- payment issue,
- technician change request,
- customer is upset,
- AI confidence is low,
- policy exception is requested.

Customer-facing handoff language should not say "接人工". It should say:

```text
我先帮您转给工作人员确认一下，这样能给您更准确的处理结果。
```

Internal system action:

```json
{
  "handoffRequired": true,
  "handoffType": "owner|technician|frontdesk",
  "reason": "..."
}
```

## 5. Conversation Memory Model

### 5.1 Session Memory

Used only during the current conversation.

Examples:

- reference images,
- current requested style,
- preferred date,
- budget concern,
- customer says they may be late,
- customer wants lower lashes.

### 5.2 Customer Long-Term Memory

Stored in customer profile with privacy controls.

Examples:

- member level,
- order history,
- preferred technician,
- allergy/sensitivity notes if voluntarily provided,
- style preferences,
- cancellation/no-show risk flags,
- referral relationship.

### 5.3 Tenant Knowledge Memory

Store-specific business facts.

Examples:

- price table,
- store hours,
- technician list,
- booking policy,
- active promotions,
- member rules.

### 5.4 Learning Memory

AI should not automatically learn every chat as truth.

Recommended workflow:

1. AI or owner flags a useful conversation.
2. AI summarizes it into a candidate knowledge entry.
3. Owner reviews and approves.
4. Approved entry becomes active knowledge with tenant scope.
5. Each entry has version, owner, status, and effective date.

## 6. AI Reply Rules

### 6.1 What AI Can Do

- answer common service questions,
- explain deposit and booking flow,
- ask structured intake questions,
- create quote tasks,
- draft booking intent,
- explain member benefits,
- send reminders,
- summarize customer needs for staff,
- polish technician replies.

### 6.2 What AI Must Not Do

- invent final nail prices,
- promise exact 1:1 recreation of reference images,
- promise unlimited redo,
- make medical claims,
- confirm refund exceptions,
- change appointment time without customer confirmation,
- expose other customers' data,
- expose internal notes,
- treat internal notes such as "不可能发生" as customer-facing text.

### 6.3 Recommended Response Pattern

For difficult customer messages:

1. acknowledge emotion or request,
2. explain the boundary gently,
3. offer the next concrete step,
4. route to human if needed.

Example:

```text
我理解您想先确认清楚价格再决定预约。复杂款式这边需要技师根据参考图、材料和实际耗时确认，才不会给您一个不准确的价格。您可以先把参考图发我，我帮您整理需求并转给技师确认，通常 10 分钟左右会有回复。
```

## 7. Phase 1 Deliverables

Phase 1 should produce:

- platform preset knowledge structure,
- Lucky Luxe private knowledge structure,
- customer-service tone rules,
- handoff rules,
- memory model,
- initial Q&A entries from owner examples,
- quote task workflow,
- reminder task workflow,
- testing workbench for uploading images and simulating customer stages,
- a clear list of missing owner decisions.

## 8. Missing Owner Decisions

These should be confirmed before production AI launch:

- final service menu and price table,
- lash add-on prices,
- member upgrade thresholds,
- exact deposit waiver exceptions,
- final cancellation/refund wording,
- warranty window and what counts as free after-sales,
- preferred customer title variable,
- whether customer photo deletion is always allowed or needs owner review,
- final channel list for Chinese and English customers,
- staff routing map,
- SMS/email/WeChat reminder channels,
- final privacy and consent wording.

## 9. Future Phase 2 Connection

This phase-1 knowledge base is designed to connect to:

- vector search/RAG,
- admin knowledge-base editor,
- AI customer-service prompt builder,
- WeChat/WeCom adapter,
- web chat adapter,
- booking draft creation API,
- quote task API,
- reminder task API,
- customer identity matching across web and Mini Program,
- multi-tenant SaaS packaging.
