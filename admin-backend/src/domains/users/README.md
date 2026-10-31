# Users Domain

Purpose: manage admin users, auth, status, and player-facing user metadata.

Boundaries:
- Resolvers in `resolvers/` delegate to services/repos; no direct DB access.
- Repositories own Drizzle queries for users, roles mapping, limits, and wallets.
- Keep auth/role logic aligned with RBAC domain; avoid cross-domain DB imports.

