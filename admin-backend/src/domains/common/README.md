# Common Domain

Purpose: shared auth and utility resolvers (e.g., currency, heartbeat).

Boundaries:
- Resolvers in `resolvers/` should stay thin and stateless.
- Shared logic belongs in services/helpers; any data access must go through repos.
- Keep cross-domain concerns minimal; use this only for true shared primitives.

