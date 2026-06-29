# Task 3 Report: Outbox Emit and Dispatch

## Scope completed

Implemented Task 3 strictly inside `backend/src/modules/notification`:

- Added `NotificationService.emit()` with idempotent outbox upsert
- Added `NotificationDispatcherService.dispatchPending()` with cron-based polling
- Added `NotificationMessageService` for listing unread/read state and mark-read operations
- Added `NotificationModule`
- Added `notification.service.spec.ts` and executed RED -> GREEN

No integration with legacy inbox or business modules was added in this task.

## Files changed

- `backend/src/modules/notification/notification.service.spec.ts`
- `backend/src/modules/notification/notification.service.ts`
- `backend/src/modules/notification/notification-dispatcher.service.ts`
- `backend/src/modules/notification/notification-message.service.ts`
- `backend/src/modules/notification/notification.module.ts`

## TDD evidence

### RED

Ran:

```bash
cd backend && npx jest src/modules/notification/notification.service.spec.ts --runInBand
```

Observed expected failure:

- `Cannot find module './notification-dispatcher.service'`
- `Cannot find module './notification.service'`

This confirmed the new service test was exercising missing implementation rather than passing accidentally.

### GREEN

Implemented the four required files and reran:

```bash
cd backend && npx jest src/modules/notification/notification.service.spec.ts src/modules/notification/notification.registry.spec.ts --runInBand
```

Observed:

- `Test Suites: 2 passed, 2 total`
- `Tests: 3 passed, 3 total`

## Implementation notes

### 1. Outbox emit

`NotificationService.emit(event, client?)`:

- derives a default idempotency key when one is not supplied
- inserts/upserts one `NotificationOutbox` row per idempotency key
- accepts an optional Prisma-like client so later tasks can call it inside transactions

### 2. Dispatcher

`NotificationDispatcherService`:

- polls pending outbox rows ordered by `createdAt`
- marks each row `PROCESSING` and increments attempts
- resolves messages through `NotificationRegistry`
- upserts `NotificationMessage` rows on `(recipientKey, idempotencyKey)`
- marks successful rows `SENT`
- requeues failures with capped exponential backoff
- marks rows `FAILED` after the fifth attempt

### 3. Cron compatibility

I used:

```ts
@Cron('*/10 * * * * *')
```

instead of `CronExpression.EVERY_10_SECONDS`.

Reason: the task brief explicitly allowed a literal cron fallback, and this avoids depending on whether the installed `@nestjs/schedule` version exports that enum constant.

### 4. Message service

`NotificationMessageService` currently provides:

- `list()`
- `unreadCount()`
- `markRead()`
- `markAllRead()`

It maps rows into the lightweight response shape shown in the task brief. No controller wiring was added in this task.

## Behavioral checks against task brief

- one outbox row per idempotency key: yes
- one recipient message emitted for registered event: yes
- outbox row transitions to `SENT` on success: yes
- limited to notification module files: yes
- no old inbox/business integration: yes

## Concerns / follow-up notes

1. `dispatchPending()` currently processes rows sequentially. That is fine for Task 3, but Task 4+ may want worker-claim semantics if multiple app instances will run the cron concurrently.
2. Failure retry state is based on the pre-read `row.attempts` plus one after the `PROCESSING` update. That matches the intended threshold in this task, but future hardening may want a single atomic attempt readback to remove ambiguity under concurrency.
3. `NotificationMessageService.list()` currently returns both `action` and `target` as the same payload shape because the brief sketch did so. API contract cleanup may be useful once controllers are introduced.

## Verification executed

Fresh verification command run before completion:

```bash
cd backend && npx jest src/modules/notification/notification.service.spec.ts src/modules/notification/notification.registry.spec.ts --runInBand
```

Result:

- 2 suites passed
- 3 tests passed
- exit code 0
