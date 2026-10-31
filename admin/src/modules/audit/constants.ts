// Domain constants
export const AUDIT_DOMAINS = [
  'sports',
  'casino',
  'matka',
  'players',
  'agents',
  'payments',
  'bonuses',
  'users',
  'rbac',
  'app-config',
  'jackpots',

] as const

export type AuditDomain = typeof AUDIT_DOMAINS[number]

// Common actions
export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'status',
  'settings',
  'reorder',
  'clone',
  'import',
  'export',
  'approve',
  'reject',
  'submit',
  'pause',
  'resume',
  'payout',
  'seed',
  'persist',
  'upsert',
  'rollback',
] as const

export type AuditAction = typeof AUDIT_ACTIONS[number]

// Domain color mapping for badges
export const DOMAIN_COLORS: Record<string, string> = {
  sports: 'blue',
  casino: 'purple',
  matka: 'orange',
  players: 'green',
  agents: 'cyan',
  payments: 'gold',
  bonuses: 'magenta',
  users: 'geekblue',
  rbac: 'red',
  'app-config': 'lime',
  jackpots: 'volcano',
}

// Action color mapping
export const ACTION_COLORS: Record<string, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  status: 'orange',
  settings: 'purple',
  approve: 'success',
  reject: 'error',
  submit: 'processing',
  pause: 'warning',
  resume: 'success',
  payout: 'gold',
}

// Resource type mapping
export const RESOURCE_TYPES = [
  'user',
  'player',
  'agent',
  'sport',
  'league',
  'event',
  'market',
  'game',
  'matka',
  'matkaResult',
  'sports_result',
  'deposit_request',
  'withdrawal_request',
  'bonus',
  'role',
  'permission',
  'AppConfig',
  'CMSPage',
  'Advertisement',
  'payment_gateway',
  'jackpot',
  'autoConfig',
  'autoRun',
  'sportSettings',
  'leagueSettings',
  'eventSettings',
  'approval',
] as const

export type ResourceType = typeof RESOURCE_TYPES[number]

// Select-option arrays for filter dropdowns (string[] for Option value)
export const DOMAIN_OPTIONS: string[] = [...AUDIT_DOMAINS]
export const ACTION_OPTIONS: string[] = [...AUDIT_ACTIONS]
export const RESOURCE_TYPE_OPTIONS: string[] = [...RESOURCE_TYPES]

// Time range presets for date filter
export const TIME_RANGE_PRESETS: { value: string; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last7days', label: 'Last 7 days' },
  { value: 'last30days', label: 'Last 30 days' },
  { value: 'last90days', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
]

// Table column definitions for column settings / visibility
export const TABLE_COLUMNS: { key: string; label: string }[] = [
  { key: 'expand', label: 'Expand' },
  { key: 'id', label: 'ID' },
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'actor', label: 'Actor' },
  { key: 'domain', label: 'Domain' },
  { key: 'action', label: 'Action' },
  { key: 'resource', label: 'Resource' },
  { key: 'details', label: 'Details' },
]

