# Task 2 Report: Prisma Notification Tables

## Scope Completed

Implemented Prisma persistence scaffolding for the notification system in the `notification-system-redesign` worktree:

1. Added a RED/GREEN shape test for Prisma Client exposure.
2. Extended `backend/prisma/schema.prisma` with notification enums and models.
3. Added a manual PostgreSQL migration SQL directory because no live database is available in this worktree.
4. Generated Prisma Client with a dummy `DATABASE_URL`.
5. Validated the Prisma schema and re-ran the shape test to GREEN.

## Files Changed

- Modified: `backend/prisma/schema.prisma`
- Added: `backend/prisma/migrations/20260629010000_notification_system/migration.sql`
- Added: `backend/src/modules/notification/notification-prisma-shape.spec.ts`

## RED Phase

Added:

`backend/src/modules/notification/notification-prisma-shape.spec.ts`

Test:

```ts
import { PrismaClient } from '@prisma/client';

describe('notification prisma client shape', () => {
  it('exposes notification models', () => {
    const prisma = new PrismaClient();

    expect(prisma.notificationOutbox).toBeDefined();
    expect(prisma.notificationMessage).toBeDefined();

    void prisma.$disconnect();
  });
});
```

Command run:

```bash
cd backend && npx jest src/modules/notification/notification-prisma-shape.spec.ts --runInBand
```

Observed failure:

- TypeScript compile failure from Jest
- `Property 'notificationOutbox' does not exist on type 'PrismaClient'`
- `Property 'notificationMessage' does not exist on type 'PrismaClient'`

This is the expected RED signal proving the test guards the new Prisma client shape.

## Prisma Schema Changes

Added enums near `InboxMessage`:

- `NotificationRecipientKind`
- `NotificationAudience`
- `NotificationSeverity`
- `NotificationOutboxStatus`

Added models:

### `NotificationOutbox`

- `id`, `eventType`, `aggregateType`, `aggregateId`
- unique `idempotencyKey`
- `payload` JSON
- `status` with default `PENDING`
- retry/process bookkeeping: `attempts`, `runAt`, `processingAt`, `processedAt`, `lastError`
- timestamps
- indexes:
  - `[status, runAt]`
  - `[aggregateType, aggregateId]`

### `NotificationMessage`

- recipient routing: `recipientKind`, `recipientKey`, `audience`
- content fields: `category`, `eventType`, `title`, `body`
- `severity` default `INFO`
- entity linkage: `entityType`, `entityId`
- optional `action`, `metadata`
- idempotency and lifecycle fields: `idempotencyKey`, `readAt`, `expiresAt`
- timestamps
- constraints/indexes:
  - unique `[recipientKey, idempotencyKey]`
  - index `[recipientKey, readAt, createdAt]`
  - index `[audience, category, createdAt]`
  - index `[entityType, entityId]`

## Migration

Because no database is available, I created the migration manually instead of using `prisma migrate dev --create-only`:

- `backend/prisma/migrations/20260629010000_notification_system/migration.sql`

The SQL includes:

- 4 PostgreSQL enum types
- `NotificationOutbox` table
- `NotificationMessage` table
- all required unique indexes and secondary indexes

## Validation / GREEN Phase

Commands run:

```bash
cd backend && DATABASE_URL='postgresql://user:pass@localhost:5432/db' npx prisma generate
cd backend && DATABASE_URL='postgresql://user:pass@localhost:5432/db' npx prisma validate
cd backend && npx jest src/modules/notification/notification-prisma-shape.spec.ts --runInBand
```

Results:

- `prisma generate`: passed
- `prisma validate`: passed
- notification Prisma shape test: passed (`1 passed, 1 total`)

## Notes / Concerns

- `prisma generate` and `prisma validate` emit a pre-existing warning that `package.json#prisma` is deprecated in Prisma 7. This task does not change that setup.
- The migration SQL was hand-authored to match the schema because this worktree intentionally has no reachable database.
- No unrelated files were touched or reverted.

## Commit

Commit created after verification:

- Commit message: `feat(notification): add prisma notification tables`
