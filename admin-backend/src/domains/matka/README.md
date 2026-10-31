# Matka Domain

Purpose: manage matka markets, results, limits, analytics, and exposure.

Boundaries:
- Resolvers in `resolvers/` stay thin; services hold business rules.
- Repositories own Drizzle reads/writes for matka entities, approvals, draws, results.
- Live analytics and bet events run through domain services; no direct DB from resolvers.

