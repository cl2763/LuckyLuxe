# Production releases: preserve existing merchant data

This is a live merchant system. The user explicitly requires every future bug/UI release to preserve existing merchant records. Read the data-preservation section at the top of CLAUDE.md before any production release.

- Base releases on the verified live commit; review all startup/schema changes.
- Create and verify a WAL-consistent backup using tools/db-backup.mjs. Query production only through tools/prod-ro.mjs.
- Rehearse upgrades and repeat startup on an isolated backup copy; compare every original table/column and ledger trigger, including signed records and account balances.
- Require passing regression checks before publishing. Verify the live version and retained records after publishing; reconcile legitimate concurrent business activity.
- Never reset production, inject demo data, rewrite historical financial/signed records, or replace the live database with a stale backup. Prefer rolling back code while retaining the persistent volume.
- Keep private backups, credentials and raw merchant records out of Git and public reports. Report what was actually deployed and verified.
