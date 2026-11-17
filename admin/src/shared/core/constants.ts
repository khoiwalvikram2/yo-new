// Application Constants
export const APP_CONFIG = {
  NAME: 'Gaming Dashboard',
  VERSION: '1.0.0',
  DESCRIPTION: 'Enterprise Gaming Platform Admin Panel',
} as const

// API Constants
export const API_CONFIG = {
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
} as const

// Route Constants
export const ROUTES = {
  // Auth
  LOGIN: '/login',
  
  // Dashboard
  OVERVIEW: '/overview',
  
  // Sports
  SPORTS_EVENTS: '/sports/events',
  /** Unified sports (and related) bet list */
  BETS: '/bets',
  SPORTS_BUILDER: '/sports-exchange/builder',
  SPORTS_CONFIGURATION: '/sports-exchange/configuration',
  
  // Casino
  CASINO_PROVIDERS: '/casino/providers',
  CASINO_CATEGORIES: '/casino/categories',
  CASINO_CATEGORY_ADD_GAMES: '/casino/categories/:categoryId/add-games',
  CASINO_MANAGEMENT: '/casino/management',
  CASINO_LIVE: '/casino/live',
  
  // Matka
  MATKA_RESULTS: '/matka/results',
  MATKA_LIVE: '/matka/live',
  
  // Players
  PLAYERS_SEARCH: '/players/search',
  PLAYERS_CREATE: '/players/create',
  PLAYERS_PROFILE: '/players/profile/:playerId',
  
  // Agents
  AGENTS_HIERARCHY: '/agents/hierarchy',
  
  // Bonuses
  BONUSES_CAMPAIGNS: '/bonuses/campaigns',
  BONUSES_LIST: '/bonuses',
  BONUSES_NEW: '/bonuses/new',
  BONUSES_EDIT: '/bonuses/:id/edit',
  BONUSES_VIEW: '/bonuses/:id',
  BONUSES_GROUPS: '/bonuses/groups',
  BONUSES_BUNDLES: '/bonuses/bundles',
  BONUSES_BUNDLES_NEW: '/bonuses/bundles/new',
  BONUSES_BUNDLES_EDIT: '/bonuses/bundles/:id/edit',
  /** Player bonus awards (cards) — same area as Bet List */
  BONUS_AWARDS: '/bonus-awards',

  // Referrals
  REFERRALS_OVERVIEW: '/referrals',
  REFERRALS_PROGRAM: '/referrals/program',
  REFERRALS_RULES: '/referrals/rules',
  REFERRALS_EARNINGS: '/referrals/earnings',
  REFERRALS_TOP_REFERRERS: '/referrals/top-referrers',
  REFERRALS_REFERRER_STATS: '/referrals/referrers/:referrerId',

  // Payments
  PAYMENTS_WITHDRAWALS: '/payments/withdrawal-requests',
  PAYMENTS_DEPOSITS: '/payments/deposits',
  PAYMENTS_PAYOUT_APPROVALS: '/payments/payout-approvals',
  
  // Reporting
  REPORTING_EXPOSURE: '/reporting/exposure',
  REPORTING_PNL: '/reporting/pnl',
  
  // Audit
  AUDIT_EVENTS: '/audit/events',
  AUDIT_EVENT_DETAIL: '/audit/events/:id',
  
  // Config
  CONFIG_OTP_PROVIDERS: '/config/otp-providers',
  
  // Security / RBAC
  SECURITY_ROLES: '/security/roles',
  SECURITY_ROLES_CREATE: '/security/roles/new',
  SECURITY_ROLES_EDIT: '/security/roles/:id/edit',
  SECURITY_ADMIN_ROLES: '/security/admin-roles',
  
  // Currency
  CURRENCY_MANAGEMENT: '/currency',
} as const

// Permission Constants
export const PERMISSIONS = {
  // Sports
  SPORTS_VIEW: 'sports:view',
  SPORTS_MANAGE: 'sports:manage',
  SPORTS_SETTLE: 'sports:settle',
  
  // Casino
  CASINO_VIEW: 'casino:view',
  CASINO_MANAGE: 'casino:manage',
  CASINO_PROVIDERS: 'casino:providers',
  
  // Matka
  MATKA_VIEW: 'matka:view',
  MATKA_MANAGE: 'matka:manage',
  MATKA_SETTLE: 'matka:settle',
  
  // Players
  PLAYERS_VIEW: 'players:view',
  PLAYERS_MANAGE: 'players:manage',
  PLAYERS_CREATE: 'players:create',
  
  // Agents
  AGENTS_VIEW: 'agents:view',
  AGENTS_MANAGE: 'agents:manage',
  
  // Reporting
  REPORTING_VIEW: 'reporting:view',
  REPORTING_EXPORT: 'reporting:export',
  
  // Admin
  ADMIN_VIEW: 'admin:view',
  ADMIN_MANAGE: 'admin:manage',
  ADMIN_CONFIG: 'admin:config',
  
  // Currency
  CURRENCY_VIEW: 'currency:view',
  CURRENCY_MANAGE: 'currency:manage',
} as const

// Role Constants
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MANAGER: 'manager',
  OPERATOR: 'operator',
  VIEWER: 'viewer',
} as const

// UI Constants
export const UI_CONFIG = {
  SIDEBAR_WIDTH: 288,
  SIDEBAR_COLLAPSED_WIDTH: 64,
  TOPBAR_HEIGHT: 64,
  ANIMATION_DURATION: 300,
  DEBOUNCE_DELAY: 500,
} as const

// Pagination Constants
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100],
  MAX_PAGE_SIZE: 100,
} as const

// Currency Constants
export const CURRENCY_CONFIG = {
  DEFAULT_CURRENCY: 'USD',
  SUPPORTED_CURRENCIES: ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD'],
  DECIMAL_PLACES: 2,
} as const

// Date/Time Constants
export const DATE_FORMATS = {
  DISPLAY: 'MMM DD, YYYY',
  DISPLAY_WITH_TIME: 'MMM DD, YYYY HH:mm',
  API: 'YYYY-MM-DD',
  API_WITH_TIME: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
} as const

// Status Constants
export const STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PENDING: 'pending',
  SUSPENDED: 'suspended',
  DELETED: 'deleted',
} as const

// Theme Constants
export const THEME = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
} as const
