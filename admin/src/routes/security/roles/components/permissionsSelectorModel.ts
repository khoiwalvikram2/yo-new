/**
 * Pure logic of the role editor's permission picker, moved out of the legacy PermissionsSelector.tsx: the
 * category taxonomy and resource copy, how the server's permission list is grouped into categories, the
 * search, which category is shown, the selection figures, and every grant/revoke rule. Each toggle returns
 * the next permission list exactly as the legacy handlers built it (same order, same untouched entries), so
 * the payload the form sends is unchanged.
 */
import type { Permission } from '@/state/rbacStore'

/** The decorative ramp step a category's tile takes (the legacy per-category colour, mapped to the ramp). */
export type CategoryHue = 'ind' | 'red' | 'grn' | 'vio' | 'blu' | 'amb' | 'neutral'

export interface CategoryMeta {
  label: string
  desc: string
  hue: CategoryHue
}

// ─── Category Taxonomy ─────────────────────────────────────────
// Order matters: categories are listed in this order, then any other category alphabetically.
export const CATEGORY_META: Readonly<Record<string, CategoryMeta>> = {
  overview: { label: 'Overview', desc: 'Dashboard & Analytics', hue: 'ind' },
  sports: { label: 'Sports', desc: 'Sports Betting Management', hue: 'amb' },
  casino: { label: 'Casino', desc: 'Casino Games & Providers', hue: 'red' },
  matka: { label: 'Matka', desc: 'Matka Games Management', hue: 'grn' },
  players: { label: 'Players', desc: 'Player Management', hue: 'blu' },
  agents: { label: 'Agents', desc: 'Agent Network', hue: 'vio' },
  bonuses: { label: 'Bonuses', desc: 'Bonus System', hue: 'amb' },
  referrals: { label: 'Referrals', desc: 'Referral Programs', hue: 'blu' },
  vip: { label: 'VIP', desc: 'VIP Tier Management', hue: 'amb' },
  payments: { label: 'Payments', desc: 'Payment Processing', hue: 'grn' },
  settlements: { label: 'Settlements', desc: 'Financial Settlements', hue: 'blu' },
  reporting: { label: 'Reporting', desc: 'Reports & Analytics', hue: 'vio' },
  config: { label: 'Configuration', desc: 'System Configuration', hue: 'neutral' },
  currency: { label: 'Currency', desc: 'Currency Management', hue: 'amb' },
  security: { label: 'Security', desc: 'Security & Access Control', hue: 'red' },
  support: { label: 'Support', desc: 'Live Chat & Player Support', hue: 'red' },
  audit: { label: 'Audit', desc: 'Audit Trail & Logs', hue: 'neutral' },
  notifications: { label: 'Notifications', desc: 'Notification System', hue: 'red' },
  credit: { label: 'Credit', desc: 'Chips: pool, Deposit & Withdraw', hue: 'grn' },
}
export const DEFAULT_META: CategoryMeta = { label: 'Other', desc: 'Other Permissions', hue: 'neutral' }

// ─── Resource Labels & Descriptions ────────────────────────────
export const RESOURCE_LABELS: Readonly<Record<string, string>> = {
  chat: 'Live Chat',
  dashboard: 'Dashboard', events: 'Events', 'live-analysis': 'Live Analysis',
  results: 'Results', builder: 'Builder', configuration: 'Configuration',
  risk: 'Risk Management', bets: 'Bets', automation: 'Automation',
  patterns: 'Patterns', management: 'Management', vendors: 'Vendors',
  providers: 'Providers', categories: 'Categories', 'provider-settings': 'Provider Settings',
  'vendor-overrides': 'Vendor Overrides', 'game-overrides': 'Game Overrides',
  'vip-games': 'VIP Games', 'bet-settings': 'Bet Settings', worli: 'Worli',
  rates: 'Rates', list: 'List', create: 'Create', profile: 'Profile',
  wallet: 'Wallet', limits: 'Limits', bonuses: 'Bonuses', vip: 'VIP',
  sessions: 'Sessions', notes: 'Notes', activity: 'Activity',
  transactions: 'Transactions', 'responsible-gaming': 'Responsible Gaming',
  devices: 'Devices', credit: 'Credit', ledger: 'Ledger',
  'referral-bonus': 'Referral Bonus', 'security-audit': 'Security Audit',
  hierarchy: 'Hierarchy', performance: 'Performance', commission: 'Commission',
  sharing: 'Sharing', detail: 'Detail', bundles: 'Bundles',
  overview: 'Overview', program: 'Program', rules: 'Rules',
  earnings: 'Earnings', 'top-referrers': 'Top Referrers', settlements: 'Settlements',
  tiers: 'Tiers', members: 'Members', deposits: 'Deposits',
  withdrawals: 'Withdrawals', methods: 'Methods', gateways: 'Gateways',
  center: 'Center', agent: 'Agent', pnl: 'P&L', exposure: 'Exposure',
  'agents-performance': 'Agents Performance', 'agents-commission': 'Agents Commission',
  'players-activity': 'Players Activity', 'players-profitability': 'Players Profitability',
  exports: 'Exports', 'agent-overview': 'Agent Overview',
  app: 'Application', whitelabels: 'Whitelabels', 'otp-providers': 'OTP Providers',
  advertisements: 'Advertisements', cms: 'CMS', 'sports-advanced': 'Sports Advanced',
  roles: 'Roles', 'support-admins': 'Support Admins', 'ip-allowlist': 'IP Allowlist',
  annotations: 'Annotations',
  history: 'History', general: 'General',
}

export const RESOURCE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'support.chat': 'View conversations, reply, assign support staff and configure live chat',
  'overview.dashboard': 'Access the main analytics dashboard',
  'sports.events': 'Manage sporting events and markets',
  'sports.live-analysis': 'View real-time sports analytics',
  'sports.results': 'Declare and manage match results',
  'sports.builder': 'Create custom bet builder markets',
  'sports.configuration': 'Configure sports settings',
  'sports.risk': 'Manage risk parameters and limits',
  'sports.bets': 'View and manage placed bets',
  'sports.automation': 'Configure automated rules',
  'sports.patterns': 'View betting pattern analytics',
  'casino.management': 'Manage casino games and settings',
  'casino.vendors': 'Manage game vendor integrations',
  'casino.providers': 'Configure game providers',
  'casino.categories': 'Organize game categories',
  'casino.live-analysis': 'Real-time casino analytics',
  'casino.bets': 'View casino bet history',
  'casino.provider-settings': 'Advanced provider configuration',
  'casino.vendor-overrides': 'Override vendor-level settings',
  'casino.game-overrides': 'Override individual game settings',
  'casino.vip-games': 'Manage VIP-exclusive games',
  'casino.bet-settings': 'Configure betting limits',
  'matka.results': 'Declare matka results',
  'matka.live-analysis': 'Real-time matka analytics',
  'matka.management': 'Manage matka games and markets',
  'matka.worli': 'Manage worli matka settings',
  'matka.rates': 'Configure payout rates',
  'matka.bets': 'View matka bet history',
  'players.list': 'View and search player directory',
  'players.create': 'Register new player accounts',
  'players.profile': 'Manage player profile details',
  'players.wallet': 'View and adjust player balances',
  'players.limits': 'Set player betting limits',
  'players.bonuses': 'Manage player bonus allocations',
  'players.vip': 'Manage player VIP status',
  'players.sessions': 'View and manage active sessions',
  'players.notes': 'Add and view player notes',
  'players.activity': 'View player activity logs',
  'players.transactions': 'View transaction history',
  'players.bets': 'View player bet history',
  'players.responsible-gaming': 'Manage self-exclusion and limits',
  'players.devices': 'View and manage player devices',
  'players.credit': "View credit players' chips and credit references",
  'players.ledger': 'View financial ledger entries',
  'players.referral-bonus': 'View referral bonus activity',
  'players.security-audit': 'View security audit trail',
  'agents.list': 'View agent directory',
  'agents.create': 'Register new agents',
  'agents.profile': 'Manage agent profiles',
  'agents.hierarchy': 'View agent tree structure',
  'agents.performance': 'View performance metrics',
  'agents.credit': 'Deposit / withdraw chips and set credit references',
  'agents.commission': 'Configure commission structure',
  'agents.sharing': 'Configure profit sharing rules',
  'bonuses.list': 'View all bonus templates',
  'bonuses.create': 'Create new bonus templates',
  'bonuses.detail': 'Manage bonus configuration',
  'bonuses.bundles': 'Manage bonus bundle packages',
  'referrals.overview': 'View referral program stats',
  'referrals.program': 'Configure referral program',
  'referrals.rules': 'Manage referral reward rules',
  'referrals.earnings': 'View referral earnings',
  'referrals.top-referrers': 'View top referrer leaderboard',
  'referrals.settlements': 'Process referral settlements',
  'vip.tiers': 'Manage VIP tier structure',
  'vip.members': 'Manage VIP member assignments',
  'payments.deposits': 'Process deposit requests',
  'payments.withdrawals': 'Process withdrawal requests',
  'payments.methods': 'Manage payment methods',
  'payments.pgsettings': 'Configure payment gateway (PG) settings',
  'settlements.center': 'View settlement overview',
  'settlements.agent': 'Process agent settlements',
  'settlements.commission': 'Process commission payouts',
  'settlements.credit': 'Process credit settlements',
  'reporting.pnl': 'View profit & loss reports',
  'reporting.exposure': 'View risk exposure reports',
  'reporting.sports': 'View sports-specific reports',
  'reporting.casino': 'View casino-specific reports',
  'reporting.matka': 'View matka-specific reports',
  'reporting.agents-performance': 'View agent performance reports',
  'reporting.agents-commission': 'View agent commission reports',
  'reporting.players-activity': 'View player activity reports',
  'reporting.players-profitability': 'View player profitability analysis',
  'reporting.exports': 'Manage report exports',
  'reporting.agent-overview': 'View agent network summary',
  'config.app': 'Manage application settings',
  'config.whitelabels': 'Manage whitelabel tenants',
  'config.otp-providers': 'Configure OTP services',
  'config.advertisements': 'Manage ad placements',
  'config.cms': 'Manage content pages',
  'config.sports-advanced': 'Advanced sports configuration',
  'currency.list': 'Manage supported currencies',
  'currency.rates': 'Manage exchange rates',
  'security.roles': 'Manage role definitions',
  'security.support-admins': 'Manage support admin accounts',
  'security.ip-allowlist': 'Manage IP access restrictions',
  'audit.events': 'View system audit events',
  'audit.annotations': 'Manage audit annotations',
  'credit.management': 'View credit overview',
  'credit.history': 'View credit transaction history',
  'credit.settlements': 'Process credit settlements',
}

function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

export function categoryMeta(categoryKey: string): CategoryMeta {
  return own(CATEGORY_META, categoryKey) ?? DEFAULT_META
}

export function resourceDescription(domain: string): string | undefined {
  return own(RESOURCE_DESCRIPTIONS, domain)
}

export function getResourceLabel(key: string): string {
  return own(RESOURCE_LABELS, key) || key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** An action as it is shown: dashes become spaces (the page capitalises it in CSS, as before). */
export function actionLabel(action: string): string {
  return action.replace(/-/g, ' ')
}

export interface ResourceItem {
  domain: string
  resource: string
  label: string
  actions: string[]
}

export interface Categories {
  categoryMap: Map<string, ResourceItem[]>
  orderedKeys: string[]
}

/**
 * Groups `category.resource` domains under their category, in the server's order within a category. Flat or
 * legacy domains (no dot, or a leading dot) are not shown: nested permissions cover everything.
 */
export function buildCategories(permissionsByDomain: Readonly<Record<string, string[]>>): Categories {
  const map = new Map<string, ResourceItem[]>()

  Object.keys(permissionsByDomain).forEach((domain) => {
    const dotIdx = domain.indexOf('.')
    if (dotIdx <= 0) return

    const category = domain.substring(0, dotIdx)
    const resource = domain.substring(dotIdx + 1)

    if (!map.has(category)) map.set(category, [])
    map.get(category)!.push({
      domain,
      resource,
      label: getResourceLabel(resource),
      actions: permissionsByDomain[domain],
    })
  })

  const metaOrder = Object.keys(CATEGORY_META)
  const keys = Array.from(map.keys()).sort((a, b) => {
    const ai = metaOrder.indexOf(a)
    const bi = metaOrder.indexOf(b)
    if (ai >= 0 && bi >= 0) return ai - bi
    if (ai >= 0) return -1
    if (bi >= 0) return 1
    return a.localeCompare(b)
  })

  return { categoryMap: map, orderedKeys: keys }
}

function resourceMatches(resource: ResourceItem, q: string): boolean {
  return resource.label.toLowerCase().includes(q) || resource.resource.includes(q) || resource.actions.some((a) => a.includes(q))
}

/** Categories whose label or key, or any resource label, key or action, contains the search (lower-cased). */
export function filterCategoryKeys(searchText: string, { categoryMap, orderedKeys }: Categories): string[] {
  if (!searchText) return orderedKeys
  const q = searchText.toLowerCase()
  return orderedKeys.filter((catKey) => {
    const meta = categoryMeta(catKey)
    const resources = categoryMap.get(catKey) || []
    return meta.label.toLowerCase().includes(q) || catKey.includes(q) || resources.some((r) => resourceMatches(r, q))
  })
}

/** The shown category's resources that match the search. */
export function filterResources(resources: readonly ResourceItem[], searchText: string): ResourceItem[] {
  if (!searchText) return [...resources]
  const q = searchText.toLowerCase()
  return resources.filter((r) => resourceMatches(r, q))
}

/**
 * Which category is shown: the chosen one while it exists, else the first; and when a search hides it, the
 * first match. This is the fixed point the legacy component's two effects reached.
 */
export function resolveActiveCategory(
  chosen: string | null,
  orderedKeys: readonly string[],
  filteredKeys: readonly string[],
): string | null {
  let active = chosen !== null && orderedKeys.includes(chosen) ? chosen : orderedKeys[0] ?? null
  if (active !== null && filteredKeys.length > 0 && !filteredKeys.includes(active)) active = filteredKeys[0]
  return active
}

export interface SelectionStats {
  selected: number
  total: number
}

/** Granted actions over offered actions; a granted entry counts all its actions, as before. */
export function categoryStats(resources: readonly ResourceItem[], value: readonly Permission[]): SelectionStats {
  let selected = 0
  let total = 0
  resources.forEach((r) => {
    total += r.actions.length
    const perm = value.find((p) => p.domain === r.domain)
    if (perm) selected += perm.actions.length
  })
  return { selected, total }
}

export function totalStats({ categoryMap, orderedKeys }: Categories, value: readonly Permission[]): SelectionStats {
  let selected = 0
  let total = 0
  orderedKeys.forEach((k) => {
    const s = categoryStats(categoryMap.get(k) || [], value)
    selected += s.selected
    total += s.total
  })
  return { selected, total }
}

/** Categories with at least one granted action. */
export function activeCategoryCount({ categoryMap, orderedKeys }: Categories, value: readonly Permission[]): number {
  return orderedKeys.filter((k) => categoryStats(categoryMap.get(k) || [], value).selected > 0).length
}

export function progressPercent({ selected, total }: SelectionStats): number {
  return total > 0 ? Math.round((selected / total) * 100) : 0
}

/** A share for a decorative bar (unrounded, as the legacy bars were). */
export function fillPercent({ selected, total }: SelectionStats): number {
  return total > 0 ? (selected / total) * 100 : 0
}

export function isFull({ selected, total }: SelectionStats): boolean {
  return selected === total && total > 0
}

export function categoryToggleTooltip(stats: SelectionStats): string {
  return isFull(stats) ? 'Revoke all permissions in this category' : 'Grant all permissions in this category'
}

export interface ResourceSelection {
  selected: string[]
  allOn: boolean
  partial: boolean
}

export function resourceSelection(resource: ResourceItem, value: readonly Permission[]): ResourceSelection {
  const perm = value.find((p) => p.domain === resource.domain)
  const selected = perm?.actions || []
  const allOn = resource.actions.length > 0 && resource.actions.every((a) => selected.includes(a))
  const partial = selected.length > 0 && !allOn
  return { selected, allOn, partial }
}

/**
 * One action on or off. On: appended to its entry (or a new entry at the end). Off: removed, and an entry left
 * empty is dropped. Turning off an action that is not granted changes nothing (null), as before.
 */
export function toggleAction(
  value: readonly Permission[],
  domain: string,
  action: string,
  checked: boolean,
): Permission[] | null {
  const perm = value.find((p) => p.domain === domain)
  if (checked) {
    return perm
      ? value.map((p) => (p.domain === domain ? { ...p, actions: [...p.actions, action] } : p))
      : [...value, { domain, actions: [action] }]
  }
  if (!perm) return null
  const acts = perm.actions.filter((a) => a !== action)
  return acts.length ? value.map((p) => (p.domain === domain ? { ...p, actions: acts } : p)) : value.filter((p) => p.domain !== domain)
}

/** A resource's Grant All / Revoke: every offered action granted removes the entry; otherwise it is replaced at the end with all of them. */
export function toggleResource(value: readonly Permission[], domain: string, allActions: readonly string[]): Permission[] {
  const perm = value.find((p) => p.domain === domain)
  const allSelected = perm && allActions.every((a) => perm.actions.includes(a))
  return allSelected
    ? value.filter((p) => p.domain !== domain)
    : [...value.filter((p) => p.domain !== domain), { domain, actions: [...allActions] }]
}

/** The category select-all: when its figures say everything is granted, every entry goes; otherwise every resource is granted in full. */
export function toggleCategory(value: readonly Permission[], resources: readonly ResourceItem[]): Permission[] {
  const stats = categoryStats(resources, value)
  const domains = new Set(resources.map((r) => r.domain))
  if (stats.selected === stats.total) return value.filter((p) => !domains.has(p.domain))
  return [
    ...value.filter((p) => !domains.has(p.domain)),
    ...resources.map((r) => ({ domain: r.domain, actions: [...r.actions] })),
  ]
}

/** Grant All: every nested domain in full, and nothing else (flat entries the role held are dropped, as before). */
export function grantAll(permissionsByDomain: Readonly<Record<string, string[]>>): Permission[] {
  return Object.entries(permissionsByDomain)
    .filter(([domain]) => domain.includes('.'))
    .map(([domain, actions]) => ({ domain, actions: [...actions] }))
}

/** Revoke All: an empty list. */
export function revokeAll(): Permission[] {
  return []
}

export function matchedLabel(count: number): string {
  return `${count} ${count === 1 ? 'category' : 'categories'} matched`
}

