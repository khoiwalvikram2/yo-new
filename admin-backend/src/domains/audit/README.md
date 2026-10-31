# Audit Domain

Purpose: provide audit event querying for admin visibility.

Boundaries:
- Resolvers in `resolvers/` surface audit data; they depend on audit repositories only.
- Repositories own Drizzle access and event filtering logic.
- No cross-domain writes; read-only views of audit trails.

