# Backend / API Agent Diary

## 2026-06-29 01:45 CST

### Problems found
- Quote handoff was too keyword-driven and could react to one message without enough conversation context.
- Technician quote tasks could lose historical reference images when the latest customer message had no image.
- Booking draft intent detection needed to happen only after staff quote was returned.

### Fixes / decisions made
- Added structured nail and lash intake template logic.
- Added member-tier branching for technician preference visibility: Gold, Platinum, and Diamond can see technician preference; Silver/new customers do not.
- Updated quote handoff logic to consider conversation state, historical reference images, and more-than-half completion.
- Added quote-to-booking draft intent detection after staff quote.
- Preserved historical reference images for technician quote tasks.

### Final effect
- Quote requests became more complete and less dependent on fragile keyword matching.
- Staff can receive relevant historical images even if the final form reply has no attachment.

### Verification evidence
- `node --check apps/api/local-server.mjs` passed in the June 29 report.

### Open blockers / risks
- Needed local server restart and full simulator/API validation after the first implementation.

### Next steps
- Validate nail intake, lash intake, quote task creation, staff quote reply, and booking draft link creation.

## 2026-06-29 21:10 CST

### Problems found
- Structured intake parsing gave raw keyword scanning too much priority.
- Nail answers such as `本甲`, `需要卸`, and `没有断甲` were normalized incorrectly.
- Nail removal messages could be misread as lash removal.
- Booking draft creation could bind an `undefined` draft ID into SQLite.

### Fixes / decisions made
- Made structured form answers take priority over raw keyword scanning.
- Corrected nail form normalization for extension, removal, and repair fields.
- Prevented nail removal text from triggering lash-removal interpretation.
- Added appointment-intent detection for phrases such as `可以约吗`, `想预约`, `档期`, and `时间`.
- Fixed booking draft creation so undefined draft IDs are not bound into SQLite.

### Final effect
- Filled intake forms now create cleaner quote tasks.
- Booking draft creation works after customer confirmation instead of failing on undefined IDs.

### Verification evidence
- Local API restarted on `http://127.0.0.1:4128`.
- End-to-end API test created booking draft `draft_mqz8i8yj_69cdna`.

### Open blockers / risks
- More canonicalization cases may appear as customers answer forms naturally.

### Next steps
- Keep adding regression fixtures for natural-language form answers.

## 2026-06-29 21:30 CST

### Problems found
- Natural-language quote flags such as `需要卸` were not canonicalized to `yes`.
- Literal state value `unknown` was being misread as `no`.

### Fixes / decisions made
- Fixed quote flag normalization.
- Fixed English-token edge case around `unknown`.

### Final effect
- Nail quote summaries correctly report removal, extension, and repair fields.

### Verification evidence
- Re-tested the local API on `http://127.0.0.1:4128`.
- Nail flow created quote request `quote_mqz9601b_yca7ls` with `removalNeeded: yes`, `extensionNeeded: no`, `repairNeeded: no`, and `imgs: 1`.

### Open blockers / risks
- Need durable automated tests so these parsing regressions do not return.

### Next steps
- Promote the successful manual scenarios into repeatable API fixtures.

## 2026-06-30 00:42 CST

### Problems found
- The repo has substantial uncommitted backend work across local server, Supabase server, AI utilities, knowledge-base utilities, schema, local data, and API docs.
- Production WeChat/WeCom credentials, trusted IP/domain setup, and payment secrets are not present and should not be committed.

### Fixes / decisions made
- Recorded latest committed backend baseline as `789440a Scaffold WeCom customer service integration`.
- Documented that `apps/wecom-gateway/` is the fixed-IP gateway scaffold for Enterprise WeChat / WeChat Customer Service callbacks.

### Final effect
- Backend status is clear: WeCom scaffold is committed, but current working-tree changes still need review and test grouping before release.

### Verification evidence
- `git show --stat HEAD` confirms the committed WeCom scaffold.
- `git diff --stat` confirms ongoing backend changes.

### Open blockers / risks
- Large uncommitted backend edits raise regression risk until tested end-to-end and split into coherent commits.

### Next steps
- Re-run backend syntax checks and API smoke tests.
- Document final API contracts for Mini Program, Web Admin, and AI customer service.
