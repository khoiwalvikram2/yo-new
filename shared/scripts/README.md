# Shared scripts (seeds & reset)

All database seeds and reset run from **shared**. Run them from the `shared` directory.
From the repository root, `npm run seed` forwards to the complete shared seed,
and `npm run seed:vip` seeds only the default VIP tiers.

## Environment

- **Add to `shared/.env`** (see `shared/.env.example`):
  - **DATABASE_URL** (required) – used by seeds, reset:db, and migrations
  - Optional: SUPER_ADMIN_*, LIMIT (casino), SPORTS_API_URL / RESET (sports), DATABASE_CA_CERT, DATABASE_SSL_REJECT_UNAUTHORIZED
- Env is loaded from **`shared/.env` only**. No dependency on admin-backend. Put DATABASE_URL (and any optional vars) in `shared/.env`.

## Commands (from `shared/`)

| Command | Description |
|--------|-------------|
| `npm run reset:db` | Drop and recreate `public` schema. Then run `npm run migrate:push` to re-apply migrations. |
| `npm run seed:whitelabel` | Create default whitelabel (idempotent). |
| `npm run seed` | Alias for `seed:all`. |
| `npm run seed:vip` | Add missing default VIP tiers to every existing whitelabel. |
| `npm run seed:roles` | Seed RBAC roles and permissions (idempotent). |
| `npm run seed:super-admin` | Create Super Admin user (idempotent). |
| `npm run seed:sports` | Seed sports from SPORTS_API_URL. |
| `npm run seed:sports:reset` | Clear sports then seed (RESET=1). |
| `npm run seed:gap-casino` | Import games from `gap-casino-games.json` at repo root. Optional: `LIMIT`. |
| `npm run seed:all` | Run all seeds in order (whitelabel → VIP tiers → roles → super-admin → sports). Gap/GMAG casino: run seed:gap-casino or seed:gmag-casino separately. |

## Default VIP tiers

| Tier | Level | Minimum monthly deposit (whitelabel base currency) |
|------|-------|--------------------------------------------------|
| Bronze | 1 | 0 |
| Silver | 2 | 10,000 |
| Gold | 3 | 50,000 |
| Platinum | 4 | 100,000 |

The seed creates active tiers with distinct colours. Benefits and perks start
empty so the configuration does not promise unimplemented cashback or bonuses.
These thresholds do not restrict payment methods, receiving accounts, or
individual deposit amounts; those require separate deposit rules.

Each tenant gets separate tier IDs. Repeated or concurrent VIP seed runs do not
duplicate tiers. Existing names (case-insensitive) and occupied levels are
preserved, including admin changes, inactive statuses, benefits, and memberships.
The seed does not rename, renumber, or reset existing tiers. A renamed tier that
occupies a default level is kept instead of adding another tier at that level.
After adding a whitelabel, run `seed:vip` again to initialize its tiers.

**Sports seed env** (all in `shared/.env`): `SPORTS_API_URL` (default: `http://174.138.121.69/get-sports`), `RESET=1` for clear-then-seed (see `seed:sports:reset`). Others like `SPORTS_API_BASE_URL` are only used by admin-backend at runtime, not by the shared sports seed.

**Casino seed env**: `LIMIT` (optional, max games to import). Data file: `gap-casino-games.json` at repo root.

**GMAG**: Seed with `npm run seed:gmag-casino` from `shared/` (needs `GMAG_GAME_DATA_URL`, `GMAG_SECRET_KEY`, `GMAG_BRAND_ID` in `shared/.env`). To view GMAG game data as JSON in the browser, run admin-backend with the same env vars in `admin-backend/.env` and open **GET** `http://localhost:<PORT>/dev/gmag-game-data` (optional: `?page=2`).

## Order

For a fresh DB: `reset:db` → `migrate:push` → `seed:all` (or run individual seeds).

## Notes

- **Shared has no dependency on admin-backend** for seeding. All seeds (including sports) run from shared.
- `gap-casino-games.json` must be at the **repo root** when running `seed:gap-casino`.
