import { format } from 'date-fns'
import { isDayString, istDayEnd, istDayOf, istDayStart } from '@/ui/components/istDate'

/* /reporting/exports — the Export Center's logic without React (page migration C, W3 Task 128).
 *
 * The catalogue, its role, agent-scheme and domain rules, the job statistics, the filters the export
 * job is created with and the file name a download gets all moved here from ExportsPage.tsx with the
 * same results. Two things changed shape, not meaning: an export type names its glyph instead of
 * holding a React node, and the per-type hex colours and gradients, which the legacy page never drew,
 * are gone. The dayjs maths moved to the kit's IST helpers and plain Date arithmetic (D6); the tests
 * pin the legacy outputs. */

export type ExportFormat = 'csv' | 'xlsx'
export type ExportCategory = 'core' | 'betting' | 'financial' | 'analytics' | 'payments' | 'system'
export type ExportGlyph = 'file' | 'sheet' | 'chart' | 'search'
export type ExportAgentScheme = 'credit' | 'commission' | 'sharing'
export type ExportsTab = 'create' | 'history'
export type ExportsViewMode = 'grid' | 'list'

export interface ExportTypeFilterOption {
  label: string
  value: string
}

export interface ExportTypeFilter {
  key: string
  label: string
  type: 'select' | 'input' | 'number'
  options?: ExportTypeFilterOption[]
}

export interface ExportType {
  id: string
  name: string
  description: string
  glyph: ExportGlyph
  category: ExportCategory
  availableFormats: ExportFormat[]
  requiresDateRange: boolean
  availableForRoles?: string[]
  availableForAgentTypes?: ExportAgentScheme[]
  filters?: ExportTypeFilter[]
}

export interface ExportJob {
  id: string
  reportType: string
  exportFormat: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  fileUrl?: string | null
  errorMessage?: string | null
  scheduledAt?: string | null
  completedAt?: string | null
  createdAt: string
}

export interface SavedExportTemplate {
  id: string
  name: string
  description?: string | null
  reportType: string
  filtersJson: Record<string, unknown>
  isPinned: boolean
}

/** The per-type filter choices; a value of `undefined` means "All" (the legacy page stored it so). */
export type ExportFilterValues = Record<string, unknown>

export interface ExportDateRange {
  from: string
  to: string
}

export interface ExportEstimate {
  rows: number
  size: string
}

const DOMAIN_FILTER_OPTIONS: ExportTypeFilterOption[] = [
  { label: 'All Domains', value: 'all' },
  { label: 'Sports', value: 'sports' },
  { label: 'Casino', value: 'casino' },
  { label: 'Matka', value: 'matka' },
]

/** Every agent scheme (owner decision 4, 2026-10-22: every scheme has the Export Center). */
const ALL_AGENT_SCHEMES: ExportAgentScheme[] = ['commission', 'sharing', 'credit']

/** The legacy EXPORT_TYPES, in their order and wording. `availableForAgentTypes` is the agent allow-list:
 *  it mirrors the backend's agentExportPolicy, and a type without it is never offered to an agent. */
export const EXPORT_TYPES: readonly ExportType[] = [
  // Core Data Exports
  {
    id: 'players',
    name: 'Players Data',
    availableForAgentTypes: ALL_AGENT_SCHEMES,
    description: 'Comprehensive player list with balances, stats, activity, and profile information',
    glyph: 'file',
    category: 'core',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: false,
    filters: [
      {
        key: 'status',
        label: 'Player Status',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Active', value: 'active' },
          { label: 'Inactive', value: 'inactive' },
          { label: 'Suspended', value: 'suspended' },
        ],
      },
    ],
  },
  {
    id: 'transactions',
    name: 'Transactions',
    description: 'Complete transaction history including deposits, withdrawals, bets, wins, and adjustments',
    glyph: 'file',
    category: 'core',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [
      {
        key: 'type',
        label: 'Transaction Type',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Deposits', value: 'deposit' },
          { label: 'Withdrawals', value: 'withdrawal' },
          { label: 'Bets', value: 'bet' },
          { label: 'Wins', value: 'win' },
        ],
      },
    ],
  },
  {
    id: 'commission',
    name: 'Commission Reports',
    description: 'Detailed commission earnings, calculations, and agent performance metrics',
    glyph: 'sheet',
    category: 'financial',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    availableForRoles: ['agent', 'Agent'],
    availableForAgentTypes: ['commission'],
  },
  {
    id: 'settlement',
    name: 'Settlement Reports',
    description: 'Settlement history, ledger entries, and financial reconciliation data',
    glyph: 'sheet',
    category: 'financial',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    availableForRoles: ['agent', 'Agent'],
    availableForAgentTypes: ['sharing', 'credit'],
  },
  {
    id: 'ggr',
    name: 'GGR Reports',
    description: 'Gross gaming revenue breakdown by domain, period, and performance metrics',
    glyph: 'sheet',
    category: 'financial',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [{ key: 'domain', label: 'Domain', type: 'select', options: DOMAIN_FILTER_OPTIONS }],
  },
  {
    id: 'subagents',
    name: 'Sub-Agents Data',
    description: 'Sub-agent hierarchy, performance data, and commission distribution',
    glyph: 'file',
    category: 'core',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: false,
    availableForRoles: ['agent', 'Agent'],
    availableForAgentTypes: ALL_AGENT_SCHEMES,
  },
  {
    id: 'agents',
    name: 'Agents Data',
    description: 'Complete agent list with hierarchy, credit balances, performance metrics, and commission details',
    glyph: 'file',
    category: 'core',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: false,
    filters: [
      {
        key: 'status',
        label: 'Agent Status',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Active', value: 'active' },
          { label: 'Inactive', value: 'inactive' },
          { label: 'Suspended', value: 'suspended' },
        ],
      },
      {
        key: 'level',
        label: 'Agent Level',
        type: 'select',
        options: [
          { label: 'All Levels', value: 'all' },
          { label: 'Level 1', value: '1' },
          { label: 'Level 2', value: '2' },
          { label: 'Level 3', value: '3' },
          { label: 'Level 4+', value: '4+' },
        ],
      },
    ],
  },
  {
    id: 'sports-bets',
    name: 'Sports Bets',
    availableForAgentTypes: ALL_AGENT_SCHEMES,
    description: 'Complete sports betting history with odds, stakes, results, and settlement data',
    glyph: 'file',
    category: 'betting',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [
      {
        key: 'status',
        label: 'Bet Status',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Unmatched', value: 'unmatched' },
          { label: 'Matched', value: 'matched' },
          { label: 'Won', value: 'won' },
          { label: 'Lost', value: 'lost' },
          { label: 'Void', value: 'void' },
        ],
      },
      {
        key: 'sport',
        label: 'Sport',
        type: 'select',
        options: [
          { label: 'All Sports', value: 'all' },
          { label: 'Cricket', value: 'cricket' },
          { label: 'Football', value: 'football' },
          { label: 'Tennis', value: 'tennis' },
          { label: 'Basketball', value: 'basketball' },
        ],
      },
    ],
  },
  {
    id: 'casino-bets',
    name: 'Casino Bets',
    availableForAgentTypes: ALL_AGENT_SCHEMES,
    description: 'Casino game betting history with game details, stakes, wins, and RTP data',
    glyph: 'file',
    category: 'betting',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [
      {
        key: 'status',
        label: 'Bet Status',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Pending', value: 'pending' },
          { label: 'Settled', value: 'settled' },
          { label: 'Cancelled', value: 'cancelled' },
        ],
      },
      {
        key: 'provider',
        label: 'Provider',
        type: 'select',
        options: [{ label: 'All Providers', value: 'all' }],
      },
    ],
  },
  {
    id: 'matka-bets',
    name: 'Matka Bets',
    availableForAgentTypes: ALL_AGENT_SCHEMES,
    description: 'Matka betting history with bid types, numbers, multipliers, and results',
    glyph: 'file',
    category: 'betting',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [
      {
        key: 'status',
        label: 'Bet Status',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Pending', value: 'pending' },
          { label: 'Won', value: 'won' },
          { label: 'Lost', value: 'lost' },
          { label: 'Cancelled', value: 'cancelled' },
        ],
      },
      {
        key: 'matkaType',
        label: 'Matka Type',
        type: 'select',
        options: [
          { label: 'All Types', value: 'all' },
          { label: 'Worli', value: 'worli' },
          { label: 'Starline', value: 'starline' },
          { label: 'Jackpot', value: 'jackpot' },
          { label: 'Satta Matka', value: 'sattaMatka' },
        ],
      },
    ],
  },
  {
    id: 'sports-kpis',
    name: 'Sports KPIs Report',
    description: 'Sports betting KPIs including GGR, turnover, bet counts, and player metrics',
    glyph: 'chart',
    category: 'analytics',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [
      {
        key: 'sport',
        label: 'Sport',
        type: 'select',
        options: [
          { label: 'All Sports', value: 'all' },
          { label: 'Cricket', value: 'cricket' },
          { label: 'Football', value: 'football' },
          { label: 'Tennis', value: 'tennis' },
        ],
      },
    ],
  },
  {
    id: 'casino-kpis',
    name: 'Casino KPIs Report',
    description: 'Casino gaming KPIs with GGR, RTP, game performance, and vendor analytics',
    glyph: 'chart',
    category: 'analytics',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [
      {
        key: 'provider',
        label: 'Provider',
        type: 'select',
        options: [{ label: 'All Providers', value: 'all' }],
      },
    ],
  },
  {
    id: 'matka-kpis',
    name: 'Matka KPIs Report',
    description: 'Matka betting KPIs including GGR, turnover, bid type performance, and session analytics',
    glyph: 'chart',
    category: 'analytics',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [
      {
        key: 'matkaType',
        label: 'Matka Type',
        type: 'select',
        options: [
          { label: 'All Types', value: 'all' },
          { label: 'Worli', value: 'worli' },
          { label: 'Starline', value: 'starline' },
          { label: 'Jackpot', value: 'jackpot' },
          { label: 'Satta Matka', value: 'sattaMatka' },
        ],
      },
    ],
  },
  {
    id: 'agent-performance',
    name: 'Agent Performance Report',
    description: 'Detailed agent performance metrics with commission, player acquisition, and revenue breakdown',
    glyph: 'chart',
    category: 'analytics',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [{ key: 'domain', label: 'Domain', type: 'select', options: DOMAIN_FILTER_OPTIONS }],
  },
  {
    id: 'bonus-campaigns',
    name: 'Bonus Campaigns Report',
    description: 'Bonus campaign performance with awards, redemptions, wagering, and effectiveness metrics',
    glyph: 'chart',
    category: 'analytics',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [
      {
        key: 'status',
        label: 'Campaign Status',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Active', value: 'active' },
          { label: 'Paused', value: 'paused' },
          { label: 'Ended', value: 'ended' },
        ],
      },
      {
        key: 'domain',
        label: 'Domain',
        type: 'select',
        options: [...DOMAIN_FILTER_OPTIONS, { label: 'Global', value: 'global' }],
      },
    ],
  },
  {
    id: 'exposure',
    name: 'Exposure Reports',
    description: 'Risk exposure analysis by domain, sport, event, and market with liability calculations',
    glyph: 'search',
    category: 'financial',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [{ key: 'domain', label: 'Domain', type: 'select', options: DOMAIN_FILTER_OPTIONS }],
  },
  {
    id: 'pnl',
    name: 'Profit & Loss Report',
    description: 'Comprehensive P&L analysis by domain, period, and currency with detailed breakdowns',
    glyph: 'chart',
    category: 'financial',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [{ key: 'domain', label: 'Domain', type: 'select', options: DOMAIN_FILTER_OPTIONS }],
  },
  {
    id: 'audit-logs',
    name: 'Audit Logs',
    description: 'Complete audit trail of all system actions, user activities, and administrative changes',
    glyph: 'search',
    category: 'system',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [
      {
        key: 'domain',
        label: 'Domain',
        type: 'select',
        options: [
          { label: 'All Domains', value: 'all' },
          { label: 'Players', value: 'players' },
          { label: 'Agents', value: 'agents' },
          { label: 'Sports', value: 'sports' },
          { label: 'Casino', value: 'casino' },
          { label: 'Matka', value: 'matka' },
        ],
      },
      {
        key: 'action',
        label: 'Action Type',
        type: 'select',
        options: [
          { label: 'All Actions', value: 'all' },
          { label: 'Create', value: 'create' },
          { label: 'Update', value: 'update' },
          { label: 'Delete', value: 'delete' },
          { label: 'Login', value: 'login' },
        ],
      },
    ],
  },
  {
    id: 'deposits',
    name: 'Deposit Requests',
    availableForAgentTypes: ALL_AGENT_SCHEMES,
    description: 'All deposit requests with status, amounts, payment methods, and approval history',
    glyph: 'file',
    category: 'payments',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [
      {
        key: 'status',
        label: 'Request Status',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Pending', value: 'pending' },
          { label: 'Approved', value: 'approved' },
          { label: 'Rejected', value: 'rejected' },
        ],
      },
      {
        key: 'paymentMethod',
        label: 'Payment Method',
        type: 'select',
        options: [
          { label: 'All Methods', value: 'all' },
          { label: 'Bank Transfer', value: 'bank' },
          { label: 'UPI', value: 'upi' },
          { label: 'Wallet', value: 'wallet' },
        ],
      },
    ],
  },
  {
    id: 'withdrawals',
    name: 'Withdrawal Requests',
    availableForAgentTypes: ALL_AGENT_SCHEMES,
    description: 'Withdrawal requests with processing status, amounts, methods, and transaction details',
    glyph: 'file',
    category: 'payments',
    availableFormats: ['csv', 'xlsx'],
    requiresDateRange: true,
    filters: [
      {
        key: 'status',
        label: 'Request Status',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Pending', value: 'pending' },
          { label: 'Processing', value: 'processing' },
          { label: 'Completed', value: 'completed' },
          { label: 'Rejected', value: 'rejected' },
        ],
      },
    ],
  },
]

export const EXPORT_CATEGORY_LABELS: Record<ExportCategory, string> = {
  core: 'Core Data',
  betting: 'Betting Data',
  financial: 'Financial Reports',
  analytics: 'Analytics & KPIs',
  payments: 'Payment Requests',
  system: 'System Data',
}

/** The Category filter's options, in the legacy order. */
export const EXPORT_CATEGORY_OPTIONS = (Object.keys(EXPORT_CATEGORY_LABELS) as ExportCategory[]).map(
  (category) => ({ value: category, label: EXPORT_CATEGORY_LABELS[category] }),
)

/** Backend-supported report types (ExportJobProcessor.fetchExportData). Unsupported types are hidden
 *  to avoid failed jobs. (Moved from ExportsPage.tsx unchanged; routes/overview/components/ReportsBanner
 *  cites it there.) */
export const BACKEND_SUPPORTED_EXPORT_TYPE_IDS: ReadonlySet<string> = new Set([
  'players', 'transactions', 'agents', 'subagents', 'sports-bets', 'casino-bets', 'matka-bets',
  'deposits', 'withdrawals', 'commission', 'settlement', 'ggr', 'bonus-campaigns', 'audit-logs',
])

/** The domain an agent must be allowed for each domain-specific export type. */
export const EXPORT_TYPE_AGENT_DOMAINS: Readonly<Record<string, string>> = {
  'sports-bets': 'sports',
  'sports-kpis': 'sports',
  'casino-bets': 'casino',
  'casino-kpis': 'casino',
  'matka-bets': 'matka',
  'matka-kpis': 'matka',
}

/** An agent without its own list sees every domain, as before. */
export const DEFAULT_AGENT_DOMAINS: readonly string[] = ['sports', 'casino', 'matka']

export function exportTypeById(id: string | null | undefined): ExportType | undefined {
  return EXPORT_TYPES.find((type) => type.id === id)
}

/** The type's name, or the raw report type when the catalogue does not know it. */
export function exportTypeName(reportType: string): string {
  return exportTypeById(reportType)?.name || reportType
}

export interface ExportTypeAccess {
  roles: readonly string[]
  isAgent: boolean
  agentSchemeType?: string
  allowedDomains: readonly string[]
  category?: string
  search: string
}

/**
 * Which export types the Create tab offers.
 *
 * Admins: the legacy rules, rule for rule. Backend support, roles (case-insensitive), the category,
 * then the search over name and description.
 *
 * Agents (agent features spec §4, 2026-10-22): exactly the types their scheme may export (the
 * backend's agentExportPolicy, mirrored by `availableForAgentTypes`), narrowed by their domains:
 *   - every scheme: players, sub-agents, deposits, withdrawals, and the bets of their domains;
 *   - COMMISSION agents: Commission Reports;
 *   - SHARING and CREDIT agents: Settlement Reports;
 *   - never the whitelabel-level types.
 * The role rule does not apply to an agent. An agent session carries no roles, which is why the
 * agent-only types used to stay hidden from the agents they were for.
 */
export function availableExportTypes({
  roles,
  isAgent,
  agentSchemeType,
  allowedDomains,
  category,
  search,
}: ExportTypeAccess): ExportType[] {
  const scheme = agentSchemeType?.toLowerCase() as ExportAgentScheme | undefined
  let filtered = EXPORT_TYPES.filter((type) => {
    // Only show types supported by backend (avoid "Unsupported report type" failed jobs)
    if (!BACKEND_SUPPORTED_EXPORT_TYPE_IDS.has(type.id)) return false

    if (isAgent) {
      // The agent allow-list: the type must name the agent's scheme...
      if (!scheme || !type.availableForAgentTypes?.includes(scheme)) return false
      // ...and a domain's bets need that domain.
      const requiredDomain = EXPORT_TYPE_AGENT_DOMAINS[type.id]
      if (requiredDomain && !allowedDomains.includes(requiredDomain)) return false
    } else if (type.availableForRoles && type.availableForRoles.length > 0) {
      // Role-based filtering (admins)
      const hasRole = type.availableForRoles.some((role) =>
        roles.some((r) => r === role || r.toLowerCase() === role.toLowerCase()),
      )
      if (!hasRole) return false
    }

    // Category filtering
    if (category && type.category !== category) return false

    return true
  })

  // Search filtering
  if (search) {
    const needle = search.toLowerCase()
    filtered = filtered.filter((type) =>
      type.name.toLowerCase().includes(needle) || type.description.toLowerCase().includes(needle),
    )
  }

  return filtered
}

export interface ExportTypeGroup {
  category: ExportCategory
  label: string
  types: ExportType[]
}

/** Grouped by category in the order each category first appears, as the legacy object kept them. */
export function groupExportTypes(types: readonly ExportType[]): ExportTypeGroup[] {
  const groups: ExportTypeGroup[] = []
  for (const type of types) {
    let group = groups.find((candidate) => candidate.category === type.category)
    if (!group) {
      group = { category: type.category, label: EXPORT_CATEGORY_LABELS[type.category], types: [] }
      groups.push(group)
    }
    group.types.push(type)
  }
  return groups
}

/** The Create tab's applied-filter count: search, category, and a period other than All time. */
export function createFilterCount(search: string, category: string | undefined, preset: string): number {
  return [search, category, preset !== 'allTime'].filter(Boolean).length
}

/** A per-type filter choice: "All" is stored as no choice. */
export function exportFilterValue(value: string): string | undefined {
  return value === 'all' || value === '' ? undefined : value
}

/**
 * The applied period as the instants an export is created with: the first and last instant of the IST
 * days, or nothing without both days. (Legacy: dayjs.tz(day, IST).startOf/endOf('day'), which was an
 * hour off on the days around a daylight-saving change of the browser's own zone; see the record.)
 */
export function exportDateRange(dateFrom: string, dateTo: string): ExportDateRange | undefined {
  if (!dateFrom || !dateTo) return undefined
  if (!isDayString(dateFrom) || !isDayString(dateTo)) return undefined
  return { from: istDayStart(dateFrom), to: istDayEnd(dateTo) }
}

export interface ExportFiltersInput {
  activeFilters: ExportFilterValues
  dateRange?: ExportDateRange
  isAgent: boolean
  agentId?: string
  tenantId?: string
}

/**
 * The filtersJson an export job is created with, keys in the legacy order: the type filters, the
 * period, the agent (the backend scopes an agent's export to its own players) and the agent's tenant.
 */
export function buildExportFiltersJson({
  activeFilters,
  dateRange,
  isAgent,
  agentId,
  tenantId,
}: ExportFiltersInput): Record<string, unknown> {
  const filtersJson: Record<string, unknown> = { ...activeFilters }
  if (dateRange) {
    filtersJson.dateFrom = dateRange.from
    filtersJson.dateTo = dateRange.to
  }
  if (isAgent && agentId) filtersJson.agentId = agentId
  if (tenantId) filtersJson.tenant = tenantId
  return filtersJson
}

/** The filters the row estimates read: the type filters, the period and the agent (no tenant). */
export function buildEstimateFilters({
  activeFilters,
  dateRange,
  isAgent,
  agentId,
}: Omit<ExportFiltersInput, 'tenantId'>): Record<string, unknown> {
  const filters: Record<string, unknown> = { ...activeFilters }
  if (dateRange) {
    filters.dateFrom = dateRange.from
    filters.dateTo = dateRange.to
  }
  if (isAgent && agentId) filters.agentId = agentId
  return filters
}

export interface ExportJobInput {
  reportType: string
  filtersJson: Record<string, unknown>
  exportFormat: string
  scheduledAt: string | undefined
}

export function buildExportJobInput(
  reportType: string,
  filtersJson: Record<string, unknown>,
  exportFormat: ExportFormat,
  scheduledAt?: string,
): ExportJobInput {
  return {
    reportType,
    filtersJson,
    exportFormat: exportFormat.toUpperCase(),
    scheduledAt: scheduledAt || undefined,
  }
}

/** Where a row estimate is cached: the type, the filters and the period it was asked for. */
export function exportEstimateKey(
  typeId: string,
  activeFilters: ExportFilterValues,
  dateRange: ExportDateRange | undefined,
): string {
  return `${typeId}-${JSON.stringify(activeFilters)}-${dateRange ? `${dateRange.from}-${dateRange.to}` : 'all'}`
}

export function formatEstimateSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function formatRowCount(count: number): string {
  if (count < 1000) return `${count}`
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`
  return `${(count / 1000000).toFixed(2)}M`
}

/** `1.2K rows • ~240.0 KB`, the estimate line under a type. */
export function formatEstimate(estimate: ExportEstimate): string {
  return `${formatRowCount(estimate.rows)} rows • ~${estimate.size}`
}

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

/* dayjs truncated a difference toward zero. */
function truncate(value: number): number {
  return value < 0 ? Math.ceil(value) || 0 : Math.floor(value)
}

/**
 * Whole days between two instants, as legacy dayjs(to).diff(dayjs(from), 'day') counted them: the
 * browser zone's offset change between the two is taken out first, so a range across a daylight-saving
 * change counts the way it always did in that browser.
 */
export function wholeDaysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  const zoneDelta = (to.getTimezoneOffset() - from.getTimezoneOffset()) * MINUTE_MS
  return truncate((to.getTime() - from.getTime() - zoneDelta) / DAY_MS)
}

/** Whole minutes between two instants (legacy dayjs diff in 'minute'). */
export function wholeMinutesBetween(fromIso: string, toIso: string): number {
  return truncate((new Date(toIso).getTime() - new Date(fromIso).getTime()) / MINUTE_MS)
}

export function isPendingJob(job: Pick<ExportJob, 'status'>): boolean {
  return job.status === 'pending' || job.status === 'processing'
}

export interface ExportAnalytics {
  total: number
  completed: number
  pending: number
  failed: number
  successRate: string
  avgProcessingTime: string
}

/** The four totals, over the jobs the history query returned (its status filter and 100-job limit). */
export function exportAnalytics(jobs: readonly ExportJob[]): ExportAnalytics {
  const total = jobs.length
  const completed = jobs.filter((job) => job.status === 'completed').length
  const pending = jobs.filter(isPendingJob).length
  const failed = jobs.filter((job) => job.status === 'failed').length
  const successRate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0'
  const minutes = jobs
    .filter((job) => job.status === 'completed' && job.completedAt && job.createdAt)
    .map((job) => wholeMinutesBetween(job.createdAt, job.completedAt as string))
  const avgProcessingTime = minutes.length > 0
    ? (minutes.reduce((a, b) => a + b, 0) / minutes.length).toFixed(1)
    : '0'
  return { total, completed, pending, failed, successRate, avgProcessingTime }
}

/** The legacy `error?.message`: whatever message a thrown value carries, if it is text. */
export function errorMessageOf(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message
  return typeof message === 'string' ? message : ''
}

/** `${n} export(s) currently in progress`, the History notice. */
export function inProgressMessage(count: number): string {
  return `${count} export${count > 1 ? 's' : ''} currently in progress`
}

/** The calendar day a download's file name carries: the job's creation day in the browser's zone,
 *  `Invalid Date` when the server sent an unusable date (both as dayjs formatted them). */
function fileDay(createdAt: string): string {
  const created = new Date(createdAt)
  return Number.isNaN(created.getTime()) ? 'Invalid Date' : format(created, 'yyyy-MM-dd')
}

/** `Players Data-2026-10-07-3f2a9c1e.csv`: the type, the creation day, the id's first 8 characters. */
export function exportJobFilename(job: Pick<ExportJob, 'id' | 'reportType' | 'createdAt' | 'exportFormat'>): string {
  return `${exportTypeName(job.reportType)}-${fileDay(job.createdAt)}-${job.id.slice(0, 8)}.${job.exportFormat.toLowerCase()}`
}

/** The history row's description: the first 50 characters and an ellipsis (only the ellipsis for an
 *  unknown type, as the legacy cell rendered it). */
export function exportTypeExcerpt(reportType: string): string {
  const description = exportTypeById(reportType)?.description
  return `${description ? description.substring(0, 50) : ''}...`
}

export const EXPORT_JOB_STATUS_LABELS: Readonly<Record<string, string>> = {
  completed: 'Completed',
  processing: 'Processing',
  pending: 'Pending',
  failed: 'Failed',
}

/** The status as the legacy badge printed it; an unknown status shows its server value. */
export function exportJobStatusLabel(status: string): string {
  return EXPORT_JOB_STATUS_LABELS[status] ?? status
}

/** History's status filter: All Status (no filter) and the four job states, in the legacy order. */
export const HISTORY_STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
]

export const HISTORY_PAGE_SIZE = 10
export const HISTORY_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100]

/** antd's showTotal text: `1-10 of 42 exports`. */
export function historyRangeText(start: number, end: number, total: number): string {
  return `${start}-${end} of ${total} exports`
}

export function clampPage(page: number, total: number, pageSize: number): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  return Math.min(Math.max(1, Math.trunc(page) || 1), pages)
}

export function pageRows<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const current = clampPage(page, rows.length, pageSize)
  const start = (current - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

/**
 * The period a saved template brings back: the IST days of its stored instants, or nothing when it
 * stores no usable pair (the legacy page would have applied "Invalid Date" and failed on it).
 */
export function templatePeriod(filtersJson: Record<string, unknown> | null | undefined): { dateFrom: string; dateTo: string } | null {
  const from = filtersJson?.dateFrom
  const to = filtersJson?.dateTo
  if (!from || !to || typeof from !== 'string' || typeof to !== 'string') return null
  const dateFrom = istDayOf(from)
  const dateTo = istDayOf(to)
  if (!dateFrom || !dateTo) return null
  return { dateFrom, dateTo }
}

/** What a type filter's select shows: its "All" option ('') for no choice, otherwise the stored value. */
export function filterSelectValue(value: unknown): string {
  if (value === undefined || value === null || value === 'all') return ''
  return String(value)
}

/** A select's options, "All" standing for no choice, with a retained value that is not among them added
 *  at the end, so a filter a template brought back still shows what it holds. */
export function filterSelectOptions(
  filter: ExportTypeFilter,
  value: unknown,
): ExportTypeFilterOption[] {
  const options = (filter.options ?? []).map((option) => ({
    label: option.label,
    value: option.value === 'all' ? '' : option.value,
  }))
  const current = filterSelectValue(value)
  if (current && !options.some((option) => option.value === current)) {
    options.push({ label: current, value: current })
  }
  return options
}
