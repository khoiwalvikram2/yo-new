# VIP Domain

Purpose: manage VIP tiers, members, and history/transactions.

Boundaries:
- Resolvers in `resolvers/` stay thin; services hold VIP progression logic.
- Repositories own Drizzle queries for tiers, members, transactions, and history.
- Do not access DB directly from resolvers/services outside repositories.

