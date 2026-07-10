# Task 4 Report: VIP And Normal Rewards Consume Payment Snapshot

## Scope

- Added a V3 integer-cent pool calculator whose only monetary base is `OrderProfitSnapshot.distributableProfitAmount`.
- Selected tree and industry rates from the snapshotted buyer path while selecting the direct rate and reward account type from the snapshotted inviter tier.
- Changed paid-order direct commission to prefer the current payment snapshot and avoid current SKU cost, config, inviter and binding reads. Orders without a snapshot retain the legacy path.
- Changed receipt allocation to use the snapshotted buyer path, rates and ancestor list. Current SKU cost, current config and current tree parentage are not queried for snapshot orders.
- Kept direct reward creation exclusively at payment. Receipt allocations carry the direct amount for audit but platform split services do not create it again.
- Routed invalid or unclaimed direct shares to platform at payment, and treated platform, charity, technology, reserve and unclaimed direct amounts as platform retained in the conserved pool result.
- Kept `READY` snapshots with `D=0` and `RECONCILIATION_REQUIRED` snapshots closed: no member or seller reward ledger is created.
- Preserved account-deletion protection at receipt and added snapshot ancestor support to VIP and normal upstream services without changing legacy tree lookup behavior.

## TDD Evidence

### Initial RED

Command:

```bash
cd backend
npx jest src/modules/bonus/engine/reward-calculator.service.spec.ts src/modules/bonus/engine/vip-direct-referral-commission.service.spec.ts src/modules/bonus/engine/bonus-allocation.service.spec.ts --runInBand
```

Result: exit code 1. The calculator spec failed because `calculateFromProfit` did not exist, direct commission recomputed current item profit and read current config, and receipt allocation read current config before considering the payment snapshot.

### Query Boundary RED

After the first snapshot behavior was green, a stricter direct-commission test asserted that the first snapshot query must not request user relations or SKU cost. It failed against the combined legacy query and passed after introducing snapshot-first loading with a separate legacy fallback query.

### Ancestor Audit RED

Focused real-service tests passed a payment-time ancestor while making current tree lookup observable. They initially failed because the snapshot field `nodeId` was not normalized to the upstream service's legacy `id` field, leaving `ancestorNodeId` empty. The adapter now preserves the snapshotted recipient and node audit metadata without querying current parentage.

## Allocation Rules

- Convert `D` to integer cents once.
- Round reward, direct, industry, charity, technology and reserve pools to the nearest cent.
- Set the explicit platform pool to the exact remaining cents, so all seven pools conserve exactly to `D`.
- `externalNet = tree reward + industry fund + claimed direct reward`.
- `platformRetained = D - externalNet`, which includes explicit platform, charity, technology, reserve and any unclaimed direct share.
- Company industry-fund shares use payment snapshot item profit shares joined to immutable order-item company ownership; SKU cost is not read again.

## Safety And Compatibility

- Receipt monetary writes remain inside a Prisma `Serializable` transaction.
- Paid-order direct writes continue to use the caller's existing Serializable payment transaction.
- Existing direct allocation idempotency keys and opposite-scheme duplicate guard remain active.
- Receipt direct amounts are audit-only; the direct ledger is created once at payment.
- Orders with no profit snapshot execute the previous current-cost/current-config/current-tree path unchanged.
- No captain, checkout, schema, profit snapshot service or config safety file was changed by Task 4.

## Verification

Focused Task 4 tests:

```bash
cd backend
npx jest src/modules/bonus/engine/reward-calculator.service.spec.ts src/modules/bonus/engine/vip-direct-referral-commission.service.spec.ts src/modules/bonus/engine/bonus-allocation.service.spec.ts --runInBand
```

Result: 3 suites passed, 41 tests passed.

Full bonus engine:

```bash
cd backend
npx jest src/modules/bonus/engine --runInBand
```

Result: 10 suites passed, 76 tests passed.

Backend build:

```bash
cd backend
npm run build
```

Result: exit code 0. The first build attempt encountered a transient `ENOTEMPTY` while another process wrote `dist`; process and file-handle inspection found no persistent builder, and two clean reruns completed successfully without source changes.
