# Customer Service Realtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make buyer/admin customer-service conversations remain correct and visible across Socket disconnects, retries, concurrent close/transfer operations, proactive outreach, and App polling.

**Architecture:** Socket.IO remains the primary realtime channel. The admin current-session query polls every 5 seconds only while Socket is disconnected, and both clients merge persisted messages by ID so stale HTTP responses cannot remove newer Socket messages. Backend state transitions use conditional updates and authenticated Socket identities; all optimistic admin actions wait for server acknowledgement or authoritative events.

**Tech Stack:** NestJS 11, Socket.IO 4, Prisma/PostgreSQL, React 19, React Native/Expo 54, TanStack Query, Jest, Node test runner.

## Global Constraints

- Keep the existing `/cs` namespace and event names compatible with deployed App clients.
- Never use wildcard Socket CORS; `ALLOWED_ORIGINS` may override, otherwise reuse `CORS_ORIGINS`.
- Buyer and admin Socket authentication must honor account status and active login sessions; admin mutations require realtime `cs:manage` permission.
- Preserve closed-session agent attribution for historical reporting while making close effects idempotent.
- Current production is one PM2 process; shared cross-instance presence is documented for future scaling, not added in this change.
- Every confirmed bug receives a failing regression test before production code changes.

---

### Task 1: Backend session state transitions

**Files:**
- Modify: `backend/src/modules/customer-service/cs.service.ts`
- Modify: `backend/src/modules/customer-service/cs-cleanup.service.ts`
- Test: `backend/src/modules/customer-service/cs.service.spec.ts`

**Interfaces:**
- `transferToAgent(sessionId): Promise<boolean>` only assigns an agent while the session remains `QUEUING`; failed final CAS releases the reserved agent slot.
- `closeSession(sessionId, expectedAgentId?): Promise<{ alreadyClosed: boolean }>` applies close side effects exactly once and optionally requires the current assigned agent.

- [x] Add failing tests for final transfer CAS losing to close, repeated close, and wrong-agent forced close.
- [x] Run `cd backend && npx jest cs.service.spec.ts --runInBand` and confirm the new tests fail on unconditional updates/repeated release.
- [x] Replace the final transfer `update` with `updateMany({ where: { id, status: 'QUEUING', agentId: null } })`; release the reserved slot when count is zero.
- [x] Make close use a status/agent conditional update before releasing the slot or resolving the ticket; return `alreadyClosed: true` when another closer won.
- [x] Make cleanup use a conditional status update so cleanup and manual close cannot both release the same slot.
- [x] Re-run the focused tests and confirm they pass.

### Task 2: Socket authentication, lifecycle, authorization, and acknowledgements

**Files:**
- Create: `backend/src/modules/customer-service/cs-socket-auth.service.ts`
- Create: `backend/src/modules/customer-service/cs-socket-auth.service.spec.ts`
- Modify: `backend/src/modules/customer-service/cs.module.ts`
- Modify: `backend/src/modules/customer-service/cs.gateway.ts`
- Modify: `backend/src/modules/customer-service/cs.gateway.spec.ts`

**Interfaces:**
- `CsSocketAuthService.authenticate(token)` returns `{ userId }` or `{ adminId, canRead, canManage }` only for active accounts and active login sessions using realtime database permissions.
- `cs:send` acknowledges `{ ok: true, message }` after persistence or `{ ok: false, error }` on failure.

- [x] Add failing auth tests for revoked buyer/admin sessions, disabled accounts, and admin without `cs:read`.
- [x] Add failing gateway tests for two tabs on one admin, unauthorized typing, wrong-agent close, and persisted-message ACK.
- [x] Run the two focused Jest files and confirm each new case fails for the expected reason.
- [x] Add the shared Socket auth service and store authenticated capabilities in `client.data`.
- [x] Track active socket IDs per admin so one tab disconnect cannot start offline cleanup while another remains connected.
- [x] Require room membership for typing and `canManage` plus assigned-agent ownership for mutations.
- [x] Acknowledge admin sends with the persisted message; keep broadcasting to the buyer room.
- [x] Re-run focused tests and confirm they pass.

### Task 3: Proactive outreach message preservation and realtime broadcast

**Files:**
- Modify: `backend/src/modules/customer-service/cs-outreach.service.ts`
- Modify: `backend/src/modules/customer-service/cs-admin.controller.ts`
- Test: `backend/src/modules/customer-service/cs-outreach.service.spec.ts`
- Test: `backend/src/modules/customer-service/cs-admin-crud.spec.ts`

**Interfaces:**
- `CsOutreachService.create()` always persists the submitted initial message, including when reusing the current agent's active session, and returns the persisted `message`.
- `POST /admin/cs/outreach` broadcasts that persisted message to `session:{sessionId}` after the transaction succeeds.

- [x] Change the existing reuse test to expect message persistence and add a failing controller broadcast test.
- [x] Run both focused Jest files and confirm failure on the current silent reuse/no-broadcast behavior.
- [x] Persist the reused-session message without reserving a second agent slot and return the complete message from all outreach branches.
- [x] Inject `CsGateway` into the admin controller and broadcast only after successful service completion.
- [x] Re-run focused tests and confirm they pass.

### Task 4: Admin workstation synchronization and truthful UI state

**Files:**
- Modify: `admin/src/pages/cs/workstation.tsx`
- Modify: `scripts/__tests__/admin-cs-outreach-entry.test.mjs`

**Interfaces:**
- Current-session detail query uses `refetchInterval: socketConnected ? false : 5000`.
- Socket reconnects without a finite attempt cap and is recreated when the Zustand admin token changes.
- `selectSession()` updates `activeSessionIdRef` synchronously.
- Admin send replaces `temp-*` with the ACK's persisted message; failed/timeout sends remove or mark the temporary item.

- [x] Add failing source-contract tests for disconnected detail polling, no five-attempt cap, token-state auth, synchronous ref update, `cs:joined` detail refresh, assigned-agent gating, and send ACK replacement.
- [x] Run `node --test scripts/__tests__/admin-cs-outreach-entry.test.mjs` and confirm the new assertions fail.
- [x] Add disconnected-only detail polling and invalidate the selected detail after `cs:joined`.
- [x] Use `useAuthStore(state => state.token)` for Socket auth and let Socket.IO retry indefinitely.
- [x] Gate send/release/close/input by current assigned agent and connected Socket.
- [x] Wait for authoritative events before clearing accept/release/close UI state; replace optimistic sends from the persistence ACK.
- [x] Re-run the source-contract test and `cd admin && npm run build`.

### Task 5: Buyer App message merge, close result, closed deep links, and resend

**Files:**
- Create: `src/utils/customerServiceMessages.ts`
- Create: `src/utils/__tests__/customerServiceMessages.test.ts`
- Modify: `app/cs/index.tsx`
- Modify: `src/components/cs/CsMessageBubble.tsx`
- Modify: `src/repos/CsRepo.ts`
- Modify: `backend/src/modules/customer-service/cs.controller.ts`
- Test: `backend/src/modules/customer-service/cs.controller.spec.ts`
- Modify: `scripts/__tests__/buyer-cs-conversations.test.mjs`

**Interfaces:**
- `mergeCustomerServiceMessages(previous, server)` preserves newer Socket messages, failed local messages, and unmatched sending messages while deduplicating by ID.
- `GET /cs/sessions/:id` returns buyer-owned session status for deep-link initialization.
- Failed message bubbles accept an `onRetry` callback.

- [x] Add failing utility tests proving a stale poll cannot remove a newer Socket message and sending counterparts are deduplicated.
- [x] Add failing controller/source-contract tests for buyer session status lookup, close failure handling, and retry wiring.
- [x] Run focused tests and confirm failures.
- [x] Use the merge utility in polling and existing Socket/HTTP merge paths.
- [x] Load authoritative session status for `sessionId` deep links and keep closed sessions read-only.
- [x] Only set `sessionClosed=true` after a successful close result; show an error and keep polling on failure.
- [x] Wire failed message bubbles to `handleResend`.
- [x] Run App TypeScript and focused tests.

### Task 6: Security record, documentation, and integrated verification

**Files:**
- Modify: `docs/issues/tofix-safe.md`
- Modify: `docs/features/智能客服.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `plan.md`

- [x] Record the Socket authorization, close/transfer CAS, and single-process scaling boundary in the security tracker.
- [x] Update the customer-service authority document with disconnect polling, ACK semantics, corrected test counts, and remaining future multi-instance presence work.
- [x] Update App/admin frontend documents and mark the new audit item complete in `plan.md`.
- [x] Run `cd backend && npx jest --testPathPatterns=customer-service --runInBand`.
- [x] Run `cd backend && npm run build`, `cd admin && npm run build`, and root App TypeScript validation.
- [x] Run customer-service source-contract tests and `git diff --check`.
- [x] Review the final diff for unrelated files; commit and publish only when explicitly requested.

### Task 7: Second audit for transfer latency, buyer fallback load, and announcement priority

**Files:**
- Modify: `backend/src/modules/customer-service/cs-ticket.service.ts`
- Modify: `backend/src/modules/customer-service/cs-routing.service.ts`
- Modify: `backend/src/modules/customer-service/cs.controller.ts`
- Modify: `backend/src/modules/customer-service/cs.gateway.ts`
- Modify: `backend/src/modules/customer-service/cs-socket-auth.service.ts`
- Modify: `app/cs/index.tsx`
- Modify: `backend/src/modules/admin/announcements/admin-announcements.service.ts`
- Modify: `backend/src/modules/notification/notification-message.service.ts`
- Modify: `app/inbox/index.tsx`
- Test: focused Jest and source-contract suites for each behavior

**Interfaces:**
- Transferring to an agent creates the queue ticket immediately; AI summary generation is best-effort and never delays the buyer response.
- Every transfer route returns one persisted reply; controllers notify the lobby without emitting a second ephemeral transfer message.
- Buyer chat polling runs only until the concrete session room is joined and resumes after Socket disconnect/error.
- Socket account/session lookups run concurrently while preserving the same authentication decisions.
- Important announcements map to warning severity and retain priority metadata through the buyer inbox API and UI.

- [x] Add failing regression tests for the delayed transfer transaction, duplicate ephemeral transfer prompt, healthy-Socket polling, sequential auth lookup, and lost announcement importance.
- [x] Run focused tests and confirm each new assertion fails for the expected current behavior.
- [x] Move transfer summary generation behind the successful queue transaction and persist it asynchronously.
- [x] Persist exactly one transfer reply and remove controller/gateway-only duplicate prompts.
- [x] Stop buyer HTTP message polling only after `cs:joined`; restart it on disconnect or connection error.
- [x] Parallelize independent Socket account/session queries.
- [x] Preserve important-announcement severity/metadata and display an `重要` marker in the App inbox.
- [x] Re-run focused tests, full customer-service tests, builds, App typecheck, Prisma validation, source contracts, and `git diff --check`.
- [x] Commit the reviewed scope, publish from clean `origin/staging`, then cherry-pick only the same commit into clean `origin/main`.
