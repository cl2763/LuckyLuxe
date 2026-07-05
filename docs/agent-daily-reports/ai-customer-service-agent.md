# AI Customer Service Agent Diary

## 2026-06-29 01:45 CST

### Problems found
- AI needed clearer intake rules for nail/lash quotes.
- Booking draft links could be sent too early without staff quote and customer booking intent.

### Fixes / decisions made
- Added a platform-level structured intake form rule.
- Added a platform-level rule that booking draft links are sent only after staff quote and customer booking intent.

### Final effect
- AI is guided to collect standardized answers before asking staff for quote.
- Booking link generation is gated by real customer intent.

### Verification evidence
- Captured in the June 29 report and AI knowledge-base rules.

### Open blockers / risks
- Human handoff and owner approval rules still need deeper production design.

### Next steps
- Continue separating platform-level rules from Lucky Luxe private tenant rules.

## 2026-06-29 21:10 CST

### Problems found
- Needed to confirm the structured nail and lash flows actually behaved as intended.

### Fixes / decisions made
- Verified nail flow: greeting does not create a quote task; style/capability question with image returns nail intake; mostly completed form creates pending quote task; quote task retains historical reference image.
- Verified quote-to-booking flow: staff quote becomes customer-facing reply; after customer says `确认预约`, system creates a real 30-minute booking draft link.
- Verified Gold returning lash flow: asks lower lashes, lash removal, date/time, eye sensitivity, notes, and eligible technician preference.

### Final effect
- AI customer service can move from intake to technician quote to booking draft with less ambiguity.

### Verification evidence
- End-to-end API test created booking draft `draft_mqz8i8yj_69cdna` with local draft link.

### Open blockers / risks
- Real production channel integration still pending.

### Next steps
- Add stable scenario tests for each customer-service path.

## 2026-06-29 21:30 CST

### Problems found
- Needed to verify member-tier branching and corrected nail-removal summary.

### Fixes / decisions made
- Confirmed Silver/new nail customers receive the nail intake template without the technician field.
- Confirmed Gold/returning lash customers receive lash intake with technician-selection field.
- Confirmed nail intake summarizes `需要卸甲` correctly.

### Final effect
- Customer-service forms now respect member-tier visibility rules and produce accurate nail summaries.

### Verification evidence
- Nail flow created quote request `quote_mqz9601b_yca7ls`.
- Customer confirmation created draft `draft_mqz9604j_gy94tv`.
- Separate Gold lash template test confirmed lower-lash and technician-selection fields appear.

### Open blockers / risks
- Need automated tests for tier branching and form normalization.

### Next steps
- Turn the verified scenarios into repeatable regression tests.

## 2026-06-30 00:42 CST

### Problems found
- Appointment draft API requirements, WeCom/member-account route, editable `knowledge_entries` table, and owner approval flow remain open.
- Customer-service behavior spans prompt, RAG, state-machine code, and business data, which makes regressions hard to detect without fixtures.

### Fixes / decisions made
- Recorded WeCom gateway scaffold as the current path toward production customer-service channel integration.
- Kept AI customer-service status as partially validated, not production-complete.

### Final effect
- AI customer-service history now shows what was solved and what still needs production hardening.

### Verification evidence
- Reviewed prior report evidence, AI task/handoff files, knowledge-base docs, and WeCom gateway docs.
- No fresh AI conversation test was run in this update.

### Open blockers / risks
- Real WeCom callback configuration and production tenant knowledge approval flow are not yet complete.

### Next steps
- Add test scenarios for greeting, nail intake, lash intake, quote request, staff quote, booking draft, human handoff, and knowledge-hit display.
