# Referrals Domain

Purpose: manage referral programs, coupons, earnings, and raffles.

Boundaries:
- Resolvers in `resolvers/` delegate to services/repos; no direct DB access.
- Repositories own Drizzle queries for referral entities and budgets.
- Keep referral reward logic in services; do not mix with payments/casino directly.

