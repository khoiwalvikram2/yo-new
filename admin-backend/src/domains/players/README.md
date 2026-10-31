# Players Domain

Purpose: provide player profile, KPIs, bets, transactions, and VIP views.

Boundaries:
- Resolvers in `resolvers/` delegate to services/repos; no direct DB access.
- Repositories own wallet, limits, bets, and VIP data queries.
- Keep player analytics logic in services; cross-domain access should go through repos only.

