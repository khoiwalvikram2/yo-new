# Sports Domain

Purpose: manage sports content, markets, bets, and live analytics.

Boundaries:
- Resolvers in `resolvers/` delegate to services; services call repos for DB.
- Adapters handle provider API interactions; keep them side-effect scoped.
- Repositories own Drizzle access for sports entities and bets; no direct DB from resolvers/services.
- Realtime/events handled in domain services (e.g., SportsBetEvents, dashboards).

