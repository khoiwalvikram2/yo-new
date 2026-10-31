# Payments Domain

Purpose: manage payment gateway metadata and admin-side payment operations.

Boundaries:
- Resolvers in `resolvers/` call services/repos; no direct DB access.
- Repositories own Drizzle queries for gateways and payment configs.
- Payment processing logic stays in services or provider adapters; keep isolation from other domains.

