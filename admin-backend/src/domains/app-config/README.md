# App Config Domain

Purpose: manage admin app configuration (feature flags, UI settings, rate limits).

Boundaries:
- GraphQL resolvers live in `resolvers/` and call repository/service helpers only.
- Repositories own all Drizzle access; no direct DB calls from resolvers/services.
- Keep config validation and defaults inside domain services or repos.

