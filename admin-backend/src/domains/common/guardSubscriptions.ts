import { hasPermission } from '@src/domains/common/auth.js'

/**
 * Gates the GraphQL Subscription map, which nothing did.
 *
 * Subscriptions are `{subscribe, resolve}` objects rather than functions, so
 * `guardAdminSurface` — which wraps `Query` and `Mutation` — is structurally
 * unable to touch them, and neither `auditAdminSurface` nor `probeAdminAuthz`
 * walks the map. The gap survived the whole admin-panel authorization pass.
 *
 * Measured with `npm run probe:subscriptions`: a signed-in admin holding **one
 * unrelated permission** reached **30 of the 32** subscriptions, among them
 * `walletUpdated`, `whitelabelCreditUpdated`, `depositRequestUpdated`,
 * `agentCreditUpdated`, every live dashboard and the matka exposure book. Only
 * `auditEvents` refused. That is the same hole the queries and mutations had —
 * and worse in effect, because a subscription streams for as long as the socket
 * stays open rather than answering once.
 *
 * The transport handshake is not the missing check: `subscription.onConnect`
 * already refuses a connection that names nobody. What was missing is the
 * question of *what this particular caller may watch*.
 *
 * Each field names the permission its own screen uses, so an operator who can
 * open a page keeps its live updates. An agent principal carries flat
 * permissions that `hasPermission` resolves against these nested names, so an
 * agent watching its own players still passes; the resolvers then scope the rows
 * as they already did.
 *
 * A field absent from the table is **refused**. A subscription added later
 * should fail loudly and be given a permission, not inherit an open socket.
 */

/** The permission each subscription demands, by the catalogue's own names. */
/**
 * A field may list alternatives, in which case any one suffices.
 * `whitelabelCreditUpdated` needs two: a Whitelabel Admin holds
 * `agents.credit:view` but not `credit.management:view`, and watching their own
 * brand's credit line is operationally essential — deposits start failing when
 * it runs out. Adjusting that line is a different question, and stays refused.
 */
export const SUBSCRIPTION_PERMISSIONS: Record<string, [string, string][]> = {
  // Sports book and market state — the sports event screens.
  orderbook: [['sports.events', 'view']],
  book: [['sports.events', 'view']],
  fancyBook: [['sports.events', 'view']],
  eventLive: [['sports.events', 'view']],
  marketState: [['sports.events', 'view']],
  sportsLiveDashboard: [['sports.live-analysis', 'view']],
  sportsPlayerEvents: [['sports.live-analysis', 'view']],
  sportsRiskAlerts: [['sports.risk', 'view']],
  betPlaced: [['sports.bets', 'view']],
  patternDetected: [['sports.patterns', 'view']],
  automationTriggered: [['sports.automation', 'view']],

  // Casino.
  casinoLiveDashboard: [['casino.live-analysis', 'view']],
  casinoPlayerEvents: [['casino.live-analysis', 'view']],
  jackpotPot: [['casino.management', 'view']],

  // Matka and Worli.
  matkaLiveDashboard: [['matka.live-analysis', 'view']],
  matkaPlayerEvents: [['matka.live-analysis', 'view']],
  matkaExposureBook: [['matka.live-analysis', 'view']],
  matkaRiskAlerts: [['matka.live-analysis', 'view']],
  matkaResultEvents: [['matka.results', 'view']],
  drawStatus: [['matka.results', 'view']],
  worliInstanceUpdated: [['matka.worli', 'view']],
  worliBetCreated: [['matka.worli', 'view']],

  // Money and accounts.
  walletUpdated: [['players.wallet', 'view']],
  depositRequestUpdated: [['payments.deposits', 'view']],
  agentCommissionUpdated: [['agents.commission', 'view']],
  agentSharingUpdated: [['agents.sharing', 'view']],
  whitelabelSharingUpdated: [['agents.sharing', 'view']],
  whitelabelCreditUpdated: [
    ['credit.management', 'view'],
    ['agents.credit', 'view'],
  ],

  // The audit trail. Already refused a permission-less caller in its own body;
  // named here too so the table is the single answer to "who may watch this".
  auditEvents: [['audit.events', 'view']],
}

/**
 * Subscriptions every authenticated caller may open, each with the reason.
 *
 * They still require a session — `onConnect` sees to that — they simply carry
 * nothing a permission could sensibly govern.
 */
export const OPEN_SUBSCRIPTIONS: Record<string, string> = {
  heartbeat: 'a liveness ping carrying no tenant data',
  notificationReceived: "delivers only the calling user's own notifications",
}

/**
 * Streams of the brand's own pool, which no agent may watch whatever it holds.
 *
 * An agent's flat `agents:view` grants `agents.credit:view` and `agents.sharing:view`, so the table above let
 * every agent, sub-agents included, watch the whitelabel's credit line and sharing totals move. Only the
 * whitelabel topbar wallet subscribes to these, and the queries behind that same wallet (myWhitelabelCredit,
 * myWhitelabelSharing) refuse agents by principal; this keeps the live path in step with them.
 */
export const NOT_FOR_AGENTS: ReadonlySet<string> = new Set(['whitelabelCreditUpdated', 'whitelabelSharingUpdated'])

type SubscribeFn = (
  parent: unknown,
  args: unknown,
  ctx: any,
  info: unknown
) => unknown

export function guardSubscriptions<T extends Record<string, unknown>>(map: T): T {
  const out: Record<string, unknown> = {}

  for (const [name, value] of Object.entries(map)) {

    // A subscription is normally `{subscribe, resolve}`; tolerate a bare
    // function so the guard does not silently skip an unusual entry.
    const entry = value as { subscribe?: SubscribeFn; resolve?: unknown } | SubscribeFn
    const subscribe =
      typeof entry === 'function' ? (entry as SubscribeFn) : (entry as any)?.subscribe
    if (typeof subscribe !== 'function') {
      out[name] = value
      continue
    }

    const required = SUBSCRIPTION_PERMISSIONS[name]
    // An open subscription still needs a caller. Skipping the wrapper entirely
    // would skip the session check too, and `notificationReceived` picks its
    // topic from `ctx` — with no user it falls through to the default-tenant
    // topic rather than refusing.
    const isOpen = Boolean(OPEN_SUBSCRIPTIONS[name])

    function guardedSubscribe(this: unknown, parent: unknown, args: unknown, ctx: any, info: unknown) {
      if (!ctx?.user) throw new Error('Unauthorized: authentication required')
      if (ctx.user.type === 'agent' && NOT_FOR_AGENTS.has(name)) {
        throw new Error(`Forbidden: ${name} is not available to agents`)
      }
      if (isOpen) return (subscribe as SubscribeFn).call(this, parent, args, ctx, info)
      if (!required) {
        throw new Error(
          `Forbidden: ${name} declares no permission. Add it to SUBSCRIPTION_PERMISSIONS.`
        )
      }
      const perms = ctx?.permissions ?? []
      if (!required.some(([domain, action]) => hasPermission(perms, domain, action))) {
        const names = required.map(([d, a]) => `${d}:${a}`).join(' or ')
        throw new Error(`Forbidden: insufficient permissions for ${names}`)
      }
      return (subscribe as SubscribeFn).call(this, parent, args, ctx, info)
    }

    out[name] =
      typeof entry === 'function'
        ? guardedSubscribe
        : { ...(entry as object), subscribe: guardedSubscribe }
  }

  return out as T
}

/**
 * The header bag a WebSocket's `connection_init` payload carries, lower-cased.
 *
 * The admin client sends `{ headers: { authorization, 'X-Whitelabel-ID', … } }`
 * (admin/src/shared/core/api.ts) — the shape mercurius itself reads for
 * `this.headers`. `onConnect` used to take only the payload's top-level strings,
 * so the nested token was never seen, every socket was refused as unauthenticated
 * and the browser surfaced mercurius's refusal as `Invalid message 'type'
 * property "connection_error"`. Flat keys are still accepted; a nested value wins.
 */
export function connectionInitHeaders(payload: unknown): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!payload || typeof payload !== 'object') return headers
  const flat = payload as Record<string, unknown>
  const nested = flat.headers && typeof flat.headers === 'object' ? (flat.headers as Record<string, unknown>) : {}
  for (const source of [flat, nested]) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string') headers[key.toLowerCase()] = value
    }
  }
  return headers
}
