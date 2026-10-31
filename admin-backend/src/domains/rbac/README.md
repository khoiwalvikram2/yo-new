# RBAC Domain

Purpose: manage roles, permissions, and admin access control.

Boundaries:
- Resolvers in `resolvers/` call services/repos; no direct DB access.
- Repositories own Drizzle queries for roles, permissions, and user-role links.
- Keep auth/permission logic inside this domain; avoid cross-domain DB imports.

