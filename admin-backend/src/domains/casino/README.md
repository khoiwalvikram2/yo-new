# Casino Domain

Purpose: manage casino games, settings, bets, and live analytics.

Boundaries:
- Resolvers in `resolvers/` call domain services; services delegate to repos for DB.
- Adapters handle provider integrations; keep them pure and side-effect scoped.
- Repositories own Drizzle queries; no direct DB calls from resolvers/services.
- Realtime/event publishing stays in domain services (e.g., bet events, dashboards).

