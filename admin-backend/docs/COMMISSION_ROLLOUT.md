# Commission Agent Production Rollout

## Database migration

Schema for commission cycle snapshots, adjustments, and payout uniqueness lives in **shared**. Apply from the shared package:

```bash
cd shared && npm run migrate:push
```

This creates/updates:

- `commission_cycle_snapshots` table and enum `commission_cycle_snapshot_status`
- `commission_adjustments` table
- Unique index on `commission_payouts (agent_id, period_from, period_to)` for idempotency

If you have existing payout rows with duplicate `(agent_id, period_from, period_to)` or nulls, resolve (e.g. backfill or dedupe) before running `migrate:push`, or the unique constraint may fail.

## Tests

- **Commission cycle utils (IST Monday→Monday):**  
  `npm run test:commission-cycle`  
  Runs unit tests for `CommissionCycleUtils` (cycle derivation, validation, cycle key, current-cycle check).

- **Scheme isolation (CREDIT/SHARING unaffected):**  
  `npm run test:scheme-isolation`  
  Asserts COMMISSION uses `payCommission` only; SHARING/CREDIT use `settleAgent` only. Resolver tests run when `DATABASE_URL` is set.

## Feature flags (optional)

To roll out behind flags:

- Add a feature flag for “strict commission payout” (full-cycle-only, non-negative, idempotent) and run in shadow mode (log would-be blocks without blocking).
- Add a flag for “readiness gate” and expose blocking reasons in UI only when enabled.

Shadow metrics can be emitted where we currently block (e.g. payout rejected: already_paid, not_ready, non_positive_payable).
