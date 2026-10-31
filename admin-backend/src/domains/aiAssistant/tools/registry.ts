import { objectSchema, toOpenAiTool, type AiTool, type ReadTool, type WriteTool } from './types.js'
import { callQuery, callMutation, truncateForModel } from './resolverBridge.js'
import type { ToolDefinition } from '../openaiClient.js'

/**
 * The tool surface offered to the model.
 *
 * The portal has 234 queries and 207 mutations. Exposing each as its own tool
 * would degrade the model's selection accuracy and inflate every request, so
 * reads are grouped into parameterised tools and writes are limited to the
 * configuration surface this feature is for. Money movement — credit
 * adjustment, manual payout, settlement posting — is not represented here at
 * all; it belongs to a different risk class than changing a limit.
 */

const period = {
  type: 'object',
  description: 'Date range. Omit for the last 30 days.',
  properties: {
    from: { type: 'string', description: 'ISO date, inclusive' },
    to: { type: 'string', description: 'ISO date, inclusive' },
  },
  additionalProperties: false,
}

const readTool = (
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  resolver: string
): ReadTool => ({
  kind: 'read',
  name,
  description,
  parameters,
  handler: async (args, ctx) => truncateForModel(await callQuery(resolver, args ?? {}, ctx)),
})

const READ_TOOLS: ReadTool[] = [
  readTool(
    'list_players',
    'List players with their stats. Use for how many players there are, who is active, top depositors, and player search.',
    objectSchema({
      search: { type: 'string', description: 'Username, phone or email fragment' },
      status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'BLOCKED'] },
      agentId: { type: 'string', description: 'Restrict to one agent subtree' },
      limit: { type: 'number', description: 'Default 25, max 100' },
      offset: { type: 'number' },
    }),
    'playersListStats'
  ),
  readTool(
    'get_player',
    'Full profile for one player: balances, limits, status, agent.',
    objectSchema({ userId: { type: 'number' } }, ['userId']),
    'playerProfile'
  ),
  readTool(
    'get_player_overview',
    'Activity summary for one player: staked, won, lost, deposits, withdrawals.',
    objectSchema({ userId: { type: 'number' } }, ['userId']),
    'playerOverview'
  ),
  readTool(
    'list_bets',
    'Bets across sports, casino or matka. Use for volumes, stakes, and win or loss questions.',
    objectSchema({
      domain: { type: 'string', enum: ['SPORTS', 'CASINO', 'MATKA', 'ALL'] },
      status: { type: 'string' },
      userId: { type: 'number' },
      agentId: { type: 'string' },
      period,
      limit: { type: 'number' },
    }),
    'betsPage'
  ),
  readTool(
    'get_bet_totals',
    'Aggregate stake, payout and GGR for a bet selection. Prefer this over listing bets when the question is about totals.',
    objectSchema({
      domain: { type: 'string', enum: ['SPORTS', 'CASINO', 'MATKA', 'ALL'] },
      agentId: { type: 'string' },
      period,
    }),
    'betsPageTotals'
  ),
  readTool(
    'get_profit_and_loss',
    'Profit and loss for the whitelabel over a period, optionally split by product.',
    objectSchema({ period, groupBy: { type: 'string', enum: ['day', 'week', 'month', 'product'] } }),
    'pnl'
  ),
  readTool(
    'get_dashboard_trends',
    'Headline trends: revenue, active players, bet counts over time.',
    objectSchema({ period }),
    'dashboardTrends'
  ),
  readTool(
    'list_agents',
    'The agent hierarchy with performance figures.',
    objectSchema({
      parentAgentId: { type: 'string', description: 'List the sub-agents of this agent' },
      schemeType: { type: 'string', enum: ['COMMISSION', 'SHARING', 'CREDIT'] },
      limit: { type: 'number' },
    }),
    'agentsHierarchy'
  ),
  readTool(
    'get_agent_performance',
    'Turnover, GGR and commission for one agent and its downline.',
    objectSchema({ agentId: { type: 'string' }, period }, ['agentId']),
    'agentPerformance'
  ),
  readTool(
    'list_deposits',
    'Deposit requests and their approval status.',
    objectSchema({
      status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
      userId: { type: 'number' },
      period,
      limit: { type: 'number' },
    }),
    'adminDepositRequests'
  ),
  readTool(
    'list_withdrawals',
    'Withdrawal requests and their status.',
    objectSchema({
      status: { type: 'string', enum: ['PENDING', 'COMPLETED', 'CANCELLED', 'FAILED'] },
      userId: { type: 'number' },
      period,
      limit: { type: 'number' },
    }),
    'adminWithdrawalRequests'
  ),
  readTool(
    'get_exposure',
    'Current open risk across unsettled bets.',
    objectSchema({ agentId: { type: 'string' }, userId: { type: 'number' } }),
    'exposures'
  ),
  readTool(
    'get_whitelabel',
    'The whitelabel record: branding, currency, status and feature flags.',
    objectSchema({ id: { type: 'string', description: 'Omit for the current whitelabel' } }),
    'whitelabel'
  ),
  readTool('list_whitelabels', 'All whitelabels visible to the caller.', objectSchema({}), 'whitelabels'),
  readTool(
    'get_limits',
    'Configured limits — deposit, withdrawal, stake, exposure.',
    objectSchema({ whitelabelId: { type: 'string' }, scope: { type: 'string' } }),
    'limits'
  ),
  readTool(
    'get_risk_limits',
    'Risk limits and thresholds currently in force.',
    objectSchema({ whitelabelId: { type: 'string' } }),
    'riskLimits'
  ),
  readTool('get_app_config', 'Application configuration for the whitelabel.', objectSchema({}), 'appConfig'),
  readTool(
    'get_payment_methods',
    'Payment methods enabled for the whitelabel.',
    objectSchema({ whitelabelId: { type: 'string' } }),
    'whitelabelPaymentMethods'
  ),
]
/**
 * A write tool describes a change and hands it back for approval. `propose`
 * must not mutate; `execute` runs only from a confirmed proposal.
 *
 * The model is given a flat parameter schema — nesting degrades tool-call
 * generation — while most of these mutations take a single `input` object.
 * `buildArgs` reconciles the two shapes in one place, and a test checks each
 * mapping against the live GraphQL schema so a renamed field cannot silently
 * break a tool. Parameter names below are taken from the schema, not invented.
 */
const writeTool = (config: {
  name: string
  description: string
  parameters: Record<string, unknown>
  mutation: string
  requiredPermission: { domain: string; action: string }
  buildArgs: (args: any) => Record<string, unknown>
  summarise: (args: any) => string
}): WriteTool => ({
  kind: 'write',
  name: config.name,
  description: config.description,
  parameters: config.parameters,
  mutation: config.mutation,
  requiredPermission: config.requiredPermission,
  buildArgs: config.buildArgs,
  propose: async (args) => ({ summary: config.summarise(args ?? {}), args: args ?? {} }),
  execute: async (args, ctx) => callMutation(config.mutation, config.buildArgs(args ?? {}), ctx),
})

/** Drops keys left undefined so optional input fields stay absent. */
const defined = (obj: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null))

const listChanges = (obj: Record<string, unknown>, skip: string[] = []): string =>
  Object.entries(obj)
    .filter(([k, v]) => !skip.includes(k) && v !== undefined && v !== null)
    .map(([k, v]) => `${k} to ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(', ')

const WRITE_TOOLS: WriteTool[] = [
  writeTool({
    name: 'set_limit',
    description:
      'Set the stake and payout ceiling for a scope. scope and scopeId identify what the limit applies to, and the platform requires every field.',
    parameters: objectSchema(
      {
        scope: { type: 'string', description: 'What the limit applies to, for example whitelabel, sport or player' },
        scopeId: { type: 'string', description: 'Identifier of the thing named by scope' },
        maxStake: { type: 'number' },
        maxPayout: { type: 'number' },
        currency: { type: 'string', description: 'Currency code, for example INR' },
      },
      ['scope', 'scopeId', 'maxStake', 'maxPayout', 'currency']
    ),
    mutation: 'upsertLimit',
    requiredPermission: { domain: 'config', action: 'write' },
    buildArgs: (a) => ({
      input: {
        scope: a.scope,
        scopeId: a.scopeId,
        maxStake: a.maxStake,
        maxPayout: a.maxPayout,
        currency: a.currency,
      },
    }),
    summarise: (a) =>
      `Set the ${a.scope} limit for ${a.scopeId} to a maximum stake of ${a.maxStake} and a maximum payout of ${a.maxPayout} ${a.currency}.`,
  }),

  writeTool({
    name: 'set_risk_limit',
    description: 'Set the maximum stake and liability cap for a risk segment, or for one player.',
    parameters: objectSchema(
      {
        segment: { type: 'string', description: 'Risk segment name. Omit when targeting a single player.' },
        userId: { type: 'string', description: 'Player id. Omit when targeting a segment.' },
        maxStake: { type: 'number' },
        liabilityCap: { type: 'number' },
        reason: { type: 'string', description: 'Why the limit is changing; recorded in the audit trail.' },
      },
      ['maxStake', 'liabilityCap']
    ),
    mutation: 'upsertRiskLimit',
    requiredPermission: { domain: 'config', action: 'write' },
    buildArgs: (a) => ({
      input: defined({ segment: a.segment, userId: a.userId, maxStake: a.maxStake, liabilityCap: a.liabilityCap }),
      ...(a.reason ? { reason: a.reason } : {}),
    }),
    summarise: (a) =>
      `Set the risk limit for ${a.userId ? `player ${a.userId}` : `segment "${a.segment ?? 'default'}"`} to a maximum stake of ${a.maxStake} and a liability cap of ${a.liabilityCap}.`,
  }),

  writeTool({
    name: 'set_player_limits',
    description: 'Set the betting limits that apply to one player.',
    parameters: objectSchema(
      {
        playerId: { type: 'string' },
        dailyStakeLimit: { type: 'number' },
        weeklyStakeLimit: { type: 'number' },
        exposureCapOverride: { type: 'number' },
        cooldownSeconds: { type: 'number' },
        maxBetSports: { type: 'number' },
        maxBetCasino: { type: 'number' },
        maxBetMatka: { type: 'number' },
      },
      ['playerId']
    ),
    mutation: 'setPlayerLimits',
    requiredPermission: { domain: 'players', action: 'manage' },
    buildArgs: (a) => ({ input: defined(a) }),
    summarise: (a) => `Update limits for player ${a.playerId}: set ${listChanges(a, ['playerId']) || 'no fields'}.`,
  }),

  writeTool({
    name: 'update_whitelabel',
    description: 'Change a whitelabel record: its name, domain, logo or favicon.',
    parameters: objectSchema(
      {
        id: { type: 'string' },
        name: { type: 'string' },
        domain: { type: 'string' },
        logoUrl: { type: 'string' },
        faviconUrl: { type: 'string' },
      },
      ['id']
    ),
    mutation: 'updateWhitelabel',
    requiredPermission: { domain: 'config', action: 'write' },
    buildArgs: (a) => ({ input: defined(a) }),
    summarise: (a) => `Update whitelabel ${a.id}: set ${listChanges(a, ['id']) || 'no fields'}.`,
  }),

  writeTool({
    name: 'update_app_config',
    description:
      'Change application configuration: support contacts, locale, timezone, currency, maintenance mode and feature toggles.',
    parameters: objectSchema({
      supportEmail: { type: 'string' },
      supportPhone: { type: 'string' },
      whatsappSupportPhone: { type: 'string' },
      defaultLocale: { type: 'string' },
      timeZone: { type: 'string' },
      baseCurrency: { type: 'string' },
      maintenance: { type: 'boolean', description: 'Put the platform into maintenance mode' },
      maintenanceMessage: { type: 'string' },
      newsTicker: { type: 'string' },
      seoTitle: { type: 'string' },
      seoDescription: { type: 'string' },
      features: {
        type: 'object',
        description:
          'Feature toggles: sportsEnabled, casinoEnabled, matkaEnabled, agentsEnabled, referralsEnabled, bonusesEnabled, registerEnabled',
      },
    }),
    mutation: 'updateAppConfig',
    requiredPermission: { domain: 'config', action: 'write' },
    buildArgs: (a) => ({ input: defined(a) }),
    summarise: (a) => `Update application configuration: set ${listChanges(a) || 'no fields'}.`,
  }),

  writeTool({
    name: 'toggle_casino_vendor',
    description: 'Enable or disable a casino vendor for the whitelabel.',
    parameters: objectSchema({ vendorId: { type: 'string' }, enabled: { type: 'boolean' } }, ['vendorId', 'enabled']),
    mutation: 'toggleCasinoVendorEnabled',
    requiredPermission: { domain: 'casino', action: 'manage' },
    buildArgs: (a) => ({ vendorId: String(a.vendorId), enabled: Boolean(a.enabled) }),
    summarise: (a) => `${a.enabled ? 'Enable' : 'Disable'} casino vendor ${a.vendorId} for this whitelabel.`,
  }),

  writeTool({
    name: 'toggle_casino_game',
    description: 'Enable or disable a single casino game.',
    parameters: objectSchema({ gameId: { type: 'string' }, enabled: { type: 'boolean' } }, ['gameId', 'enabled']),
    mutation: 'toggleCasinoGameEnabled',
    requiredPermission: { domain: 'casino', action: 'manage' },
    buildArgs: (a) => ({ gameId: String(a.gameId), enabled: Boolean(a.enabled) }),
    summarise: (a) => `${a.enabled ? 'Enable' : 'Disable'} casino game ${a.gameId} for this whitelabel.`,
  }),

  writeTool({
    name: 'set_payment_methods',
    description: 'Change which payment methods the whitelabel offers, and their deposit limits.',
    parameters: objectSchema({
      enabledMethods: { type: 'array', items: { type: 'string' }, description: 'Method codes to enable' },
      banks: { type: 'array', items: { type: 'object' } },
      upis: { type: 'array', items: { type: 'object' } },
      limits: { type: 'object' },
    }),
    mutation: 'upsertWhitelabelPaymentMethods',
    requiredPermission: { domain: 'config', action: 'write' },
    buildArgs: (a) => ({ input: defined(a) }),
    summarise: (a) => {
      const methods = Array.isArray(a.enabledMethods) ? a.enabledMethods : []
      return `Update the payment methods for this whitelabel${methods.length ? `: enable ${methods.join(', ')}` : ''}.`
    },
  }),

  writeTool({
    name: 'set_sport_settings',
    description:
      'Change stake, commission or exposure settings for one or more sports. Both the sports and the market mode are required.',
    parameters: objectSchema(
      {
        sportIds: { type: 'array', items: { type: 'string' }, description: 'Sports the settings apply to' },
        mode: { type: 'string', description: 'Market mode, for example exchange, bookmaker or fancy' },
        tierId: { type: 'string' },
        exchangeMinStake: { type: 'number' },
        exchangeMaxStake: { type: 'number' },
        bookmakerMinStake: { type: 'number' },
        bookmakerMaxStake: { type: 'number' },
        fancyMinStake: { type: 'number' },
        fancyMaxStake: { type: 'number' },
        exchangeCommission: { type: 'number' },
        bookmakerCommission: { type: 'number' },
        fancyCommission: { type: 'number' },
      },
      ['sportIds', 'mode']
    ),
    mutation: 'upsertSportSettings',
    requiredPermission: { domain: 'sports', action: 'manage' },
    buildArgs: (a) => ({ input: defined(a) }),
    summarise: (a) => {
      const count = Array.isArray(a.sportIds) ? a.sportIds.length : 0
      return `Update ${a.mode} settings for ${count} sport(s): set ${listChanges(a, ['sportIds', 'mode']) || 'no fields'}.`
    },
  }),

  writeTool({
    name: 'set_matka_settings',
    description: 'Change the configuration of one matka market.',
    parameters: objectSchema(
      {
        id: { type: 'string', description: 'The matka to change' },
        settings: { type: 'object', description: 'Settings to apply' },
        tierId: { type: 'string' },
        reason: { type: 'string', description: 'Why it is changing; recorded in the audit trail.' },
      },
      ['id', 'settings']
    ),
    mutation: 'updateMatkaSettings',
    requiredPermission: { domain: 'matka', action: 'manage' },
    buildArgs: (a) => defined({ id: a.id, settings: a.settings, tierId: a.tierId, reason: a.reason }),
    summarise: (a) => `Update matka ${a.id}: set ${listChanges(a.settings ?? {}) || 'no fields'}.`,
  }),
]

const ALL_TOOLS: AiTool[] = [...READ_TOOLS, ...WRITE_TOOLS]
const BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]))

export function getTool(name: string): AiTool | undefined {
  return BY_NAME.get(name)
}

export function listTools(): AiTool[] {
  return ALL_TOOLS
}

export function openAiToolDefinitions(): ToolDefinition[] {
  return ALL_TOOLS.map(toOpenAiTool)
}

export function isWriteTool(tool: AiTool): tool is WriteTool {
  return tool.kind === 'write'
}
