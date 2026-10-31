# Deposits Domain

Purpose: handle deposit requests and related admin actions.

Boundaries:
- Resolvers in `resolvers/` call services/repos only; no direct DB access.
- Repositories own Drizzle queries for deposit requests and status updates.
- Keep payment provider logic in payments domain; use this domain for admin flows.

