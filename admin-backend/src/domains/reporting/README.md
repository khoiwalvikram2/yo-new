# Reporting Domain

Purpose: expose reporting and analytics queries for admin.

Boundaries:
- Resolvers in `resolvers/` stay thin; heavy lifting belongs to services/repos.
- Repositories own Drizzle queries and aggregations; no direct DB from resolvers.
- Keep cross-domain joins minimal; pull via repository APIs where needed.

