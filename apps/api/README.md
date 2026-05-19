# Lucky Luxe Backend

This folder contains the first local backend for Lucky Luxe.

## Local Run

No Docker or npm install is required for the local demo server because it uses the bundled Node.js runtime and native SQLite.

```bash
/Users/changliu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/api/local-server.mjs
```

The API starts at:

```text
http://localhost:4000
```

Local database file:

```text
apps/api/local-data/lucky-luxe.sqlite
```

## Important Endpoints

- `GET /health`
- `GET /stores`
- `GET /services?type=nail|lash&lang=zh|en`
- `GET /technicians?storeId=store-ontario-01&serviceId=nail-french-01`
- `GET /availability?storeId=store-ontario-01&serviceId=nail-french-01&date=2026-05-20`
- `POST /bookings`
- `POST /payments/mock/confirm`
- `GET /bookings/:id`
- `POST /bookings/:id/cancel`

Owner endpoints use:

```text
Authorization: Bearer owner-demo-token
```

## Scheduling Rules In This Version

- Store hours: Tuesday to Sunday, 10:00 to 19:00.
- Monday is closed.
- Lash services always occupy 120 minutes.
- Nail services occupy at least 120 minutes and can extend with add-ons.
- One booking contains one service only.
- The online deposit is fixed at CAD 50.
- Pending payment holds reserve the technician's slots for 15 minutes.
- Slot conflicts are handled by a database unique constraint on `(technician_id, starts_at)`, so Redis is not needed for this traffic level.

## Production Direction

The `prisma/schema.prisma` file documents the production database shape. For cloud deployment, use PostgreSQL instead of the local SQLite file.
