/* The filter lists come from the trail itself (auditFilterOptions: what this tenant's rows hold). These are
   only the fallback while that loads or if it fails, and they are names the trail does record (2026-11): the
   old lists offered 'users' (the trail says 'users.security'), 'approve' ('approve_deposit') and the like, so
   most events could not be picked. */

// Domain constants
export const AUDIT_DOMAINS = [
  'agents',
  'agents.chips',
  'agents.security',
  'app-config',
  'bonuses',
  'casino',
  'crm.settings',
  'crm.users',
  'deposits',
  'matka',
  'matka.results',
  'payments',
  'players',
  'players.security',
  'rbac',
  'settlements',
  'sports',
  'users.security',
  'whitelabels',
] as const

export type AuditDomain = typeof AUDIT_DOMAINS[number]

// Common actions
export const AUDIT_ACTIONS = [
  'login',
  'login_failed',
  'createSportsResult',
  'rollbackSportsResult',
  'deposit_approved',
  'approve_deposit',
  'reject_deposit',
  'withdrawal_status_update',
  'setEventStatus',
  'setMarketStatus',
  'create_player',
  'create',
  'update',
  'delete',
  'status',
  'settings',
  'reorder',
  'clone',
  'rollback',
  'commission_payout',
  'void_bet',
  'cancel_bet',
  'void_casino_bet_refund',
  'grant_special_bonus',
  'suspend_user',
  'deactivate_user',
  'reactivate_user',
  'force_logout',
  'require_password_reset',
  'change_password',
  'change_player_password',
  'update_agent',
  'update_agent_status',
  'deposit_chips',
  'withdraw_chips',
  'assign_role',
  'revoke_role',
  'create_role',
  'update_role',
  'set_role_permissions',
  'delete_role',
  'create_support_admin',
  'delete_support_admin',
  'advertisement_create',
  'advertisement_update',
  'advertisement_delete',
  'cross_tenant_access_blocked',
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
  'Advertisement',
  'AppConfig',
  'agent',
  'bet',
  'bonus_award',
  'casino_bet',
  'commission_payout',
  'crm_user',
  'deposit_request',
  'event',
  'league',
  'market',
  'matka',
  'matkaResult',
  'player',
  'role',
  'sportSettings',
  'sports_result',
  'user',
  'user_role',
  'whitelabel',
  'withdrawal_request',
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

