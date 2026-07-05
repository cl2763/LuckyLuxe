# Current Open Questions And Suggested Next Steps

## Do Not Modify Yet

The user requested this handoff package only. Do not modify code unless the user later approves.

## Most Important Open Questions

1. **Real customer-service workbench architecture**
   - Should implementation begin with channel-neutral backend tables first, or with the web admin UI first?
   - Recommendation: backend state model first, then web admin workbench.

2. **Unified identity**
   - How exactly should web users, Mini Program users, Google users, phone users, and WeCom users be merged?
   - Need account-linking and conflict resolution rules.

3. **AI customer-service memory**
   - Current working memory exists but user still observed context failures.
   - Need inspect `local-server.mjs` and tests to confirm memory update order, prompt construction, state transition locking, and human handoff boundaries.

4. **Human takeover**
   - User expects Admin to have explicit controls:
     - take over / keep human.
     - return to AI.
     - auto return after 10 minutes only when appropriate.
   - Verify UI and backend state are consistent.

5. **Quote task pool**
   - Quote tasks must include all historical reference images, not only images attached to the latest message.
   - If customer sends image while quote is pending, task context should update.
   - Technician free-text quote must be preserved fully when AI polishes it.

6. **Booking draft creation**
   - Must not create draft without date and time.
   - If requested time is unavailable, reply in chat with nearest available time and business hours, not just a toast.
   - Applies to nail and lash.

7. **Unknown/out-of-knowledge messages**
   - AI should silently mark human-needed instead of hallucinating.
   - It should not tell customer "I will transfer you" unless the rule explicitly requires a visible handoff message.

8. **After-sales**
   - Need verify `sim024`-style scenarios and after-sales tests.
   - AI should not turn gratitude/photo sharing into booking workflow.

9. **SaaS packaging**
   - Need plan entitlements and tenant/store isolation.
   - Do not hardcode Lucky Luxe private rules as platform defaults.

## Suggested Technical Next Steps

1. Read:
   - `docs/ai-customer-service/RULEBOOK.md`
   - `docs/ai-customer-service/PHASE1_KNOWLEDGE_BASE.md`
   - `apps/api/local-server.mjs`
   - `apps/api/test-customer-service-matrix.mjs`
   - `apps/web/wechat-simulator.js`
   - `apps/web/admin.js`

2. Run existing tests:

```bash
node apps/api/test-customer-service-matrix.mjs
node apps/api/test-working-memory.mjs
node apps/api/test-human-handoff.mjs
node apps/api/test-silent-handoff.mjs
node apps/api/test-after-sales-handoff.mjs
```

3. Inspect whether tests actually cover:
   - multi-turn intake;
   - human reply then no AI;
   - manual return to AI;
   - auto return after 10 minutes;
   - unavailable time suggestion;
   - draft creation guards;
   - after-sales silent handoff;
   - old customer welcome + contextual second reply.

4. If modifying later, lock current rules by expanding regression tests first.

## Known Sensitive Config Not Included

Claude should not receive raw secrets. Configure locally if needed:

- `AI_API_KEY` or provider-specific model API key.
- `WECHAT_MINI_APPID`
- `WECHAT_MINI_SECRET`
- `WECHAT_MINI_TOKEN_SECRET`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `STRIPE_SECRET_KEY`
- `WECOM_CUSTOMER_SERVICE_SECRET`
- `WECOM_CUSTOMER_SERVICE_TOKEN`
- `WECOM_GATEWAY_SHARED_SECRET`
- `OWNER_DEMO_TOKEN`
- `FINANCE_PASSWORD`

