# Player app production runbook

This runbook covers `user/` and `user-backend/`. Run commands from the repository
root and use Node 20 or newer. Never copy the local development `.env` unchanged to
a server.

## Required configuration

Create `user-backend/.env` from `user-backend/.env.example` and replace every
placeholder. At minimum, production needs:

- `DATABASE_URL` and a strong, unique `JWT_SECRET`;
- exact HTTPS entries in `CORS_ORIGIN` (no wildcard);
- `TRUST_PROXY=loopback` when nginx proxies from the same host, otherwise an
  explicit trusted proxy address/CIDR or `false`;
- `USER_APP_BASE_URL`, `ADMIN_BASE_URL` and a separate `INTERNAL_API_KEY`;
- an explicitly confirmed `UPSTREAM_API_BASE_URL` and sports paths;
- only the payment/casino credentials actually used by this deployment.

Keep `GAP_DEBUG=0`. `npm start -w user-backend` forces `NODE_ENV=production`, so
GraphiQL and provider test harness routes are not registered. Remove
`WELIVEPAY_ALLOWED_USER_IDS` in production unless a temporary, documented rollout
restriction is intentional.

The committed `user/.env.production` keeps GraphQL same-origin at `/graphql`, leaves
tenant identity domain-derived, and configures realtime odds. Override it through
the deployment environment only when the target infrastructure is different.

## Install, verify and build

```bash
cd /path/to/repository
npm ci
npm test -w stakex-ui
npm run typecheck -w stakex-ui
npm run lint -w stakex-ui -- --quiet
npm run build -w stakex-ui
npm test -w user-backend
npm run typecheck -w user-backend
npm run build -w user-backend
npm audit --audit-level=high
```

Do not run root `npm test` or `npm run test:all` against a production database;
some wider integration suites intentionally create and clean rows.

## Start and proxy

Start the API from the repository root (or use the same command under the process
manager):

```bash
npm start -w user-backend
```

Serve `user/dist` as the SPA root. The reverse proxy must forward exact `/graphql`
requests and `/api/` uploads to the user API on port 4003, while all other player
routes fall back to `index.html`. Preserve `Host`, `X-Real-IP`,
`X-Forwarded-For`, and `X-Forwarded-Proto`. Expose `/gap/`, `/gmag/` and `/wlp/`
callbacks only on the hostname configured with the corresponding provider.

The minimum nginx routing shape is:

```nginx
root /path/to/repository/user/dist;

location = /graphql {
    proxy_pass http://127.0.0.1:4003/graphql;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/ {
    proxy_pass http://127.0.0.1:4003;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

Add the project's TLS and security-header policy, then validate and reload nginx.

## Smoke checks

Confirm the homepage and static assets return 200, then send the read-only
`appSettings` GraphQL query and verify `meta.code` is 200. Test light/dark mode,
responsive navigation, login/logout, one real event's live odds and the configured
casino catalogue in a browser. Funding, bet placement and provider launch are
consequential operations and should be performed only by the operator in an
explicitly authorized test account/environment.
