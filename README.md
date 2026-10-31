# GW Platform

A multi-tenant betting and casino platform: sports, casino, and matka wagering with
agent hierarchies, commission settlement, bonuses, and reporting.

## Layout

This is a single **npm workspace**. Install and run everything from the repository root.

| Package | Name | What it is |
|---|---|---|
| `shared/` | `@gd/shared` | Drizzle schema (single source of truth), DB clients, cross-cutting services |
| `admin-backend/` | `backend` | Admin GraphQL API (Fastify + Mercurius), schedulers, job queue |
| `user-backend/` | `user-backend` | Player-facing GraphQL API and provider callbacks |
| `admin/` | `admin` | Admin panel (React + Vite + antd) |
| `user/` | `stakex-ui` | Player web app (React + Vite + Tailwind) |
| `crm/` | `crm` | CRM desk (React + Vite + antd) |

Both backends consume `shared` **as TypeScript source** through the tsconfig path
`@shared/* -> ../shared/src/*`, not through a built `dist`.

> **Install only from the root.** Running `npm install` inside a single package
> creates a second physical copy of `drizzle-orm`. TypeScript then treats the two
> copies' classes as different types (they have private fields) and reports
> thousands of spurious errors across both backends. The root `package.json` pins
> `drizzle-orm` in both `dependencies` and `overrides` to keep exactly one copy —
> do not remove that pin.

## Getting started

```bash
npm install          # one install for all six packages
npm run seed         # shared seeds, including 4 default VIP tiers per whitelabel
npm run typecheck    # all six packages
npm run build        # all buildable packages
npm test             # unit tests
npm run test:all     # unit + integration tests
```

Each package also runs on its own, e.g. `npm run dev -w backend`.
For VIP defaults only, run `npm run seed:vip`. See [seed commands](shared/scripts/README.md)
for configuration, qualification thresholds, and preservation of existing tiers.

### Environment

Every backend package reads a local `.env` (git-ignored); see `.env.example`.
`DATABASE_URL` is required. Test and script commands load `.env` automatically.

Database pool tuning is environment-driven — see `shared/src/db/createPool.ts`:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_POOL_MAX` | `20` | Max concurrent server connections per process |
| `DATABASE_POOL_MIN` | `0` | Warm connection floor. Leave at 0 for scripts and CI; a value > 0 keeps idle sockets open |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `10000` | Fail fast instead of queueing forever when saturated |
| `DATABASE_IDLE_TIMEOUT_MS` | `30000` | Idle connection reaping |
| `DATABASE_STATEMENT_TIMEOUT_MS` | `120000` | Kills runaway queries; `0` disables |
| `DATABASE_TIMEZONE` | `Asia/Kolkata` | Pins the session timezone so date bucketing is identical everywhere |

## Database

`shared/src/db/schema.ts` is the only schema source. `shared/drizzle/` is the only
migration lineage.

```bash
npm run migrate:generate -w @gd/shared   # diff schema -> new migration
npm run migrate:run -w @gd/shared        # apply pending migrations
```

`drizzle-kit generate` reporting "No schema changes" means the schema, the
migrations, and the database all agree.

Shared services never open their own connection. Each application registers its
handle once at startup via `setSharedDb(db)` (`shared/src/db/registry.ts`), and
shared code resolves it with `resolveDb(tx)`.

## Tests

Test files are **discovered**, not listed — any `*.test.ts` under a package's `src/`
runs automatically (`scripts/run-tests.mjs`). Files matching
`*.integration.test.ts` are excluded from `npm test` and run via
`npm run test:integration`.

## Archive

`.archive/` holds material removed from the build but kept for reference:
superseded migration lineages, dead components and assets, and a database dump.
Nothing there is imported by the applications.
