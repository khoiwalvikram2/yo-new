// Type definitions
export interface NavChild {
  to: string
  icon: string
  label: string
  permissions?: PermissionRequirement
  keywords?: string[] // For search
  hideForRoles?: string[] // Hide this item for specific roles
  showOnlyForRoles?: string[] // Show only when user has one of these roles (e.g. Super Admin only)
  showInCoreMode?: boolean // Show in Director Admin Core Data Management mode
  showInWhitelabelMode?: boolean // Show in Director Admin Whitelabel View mode
}

export interface NavItem {
  key?: string
  to: string
  icon: string
  label: string
  subtitle?: string
  badge?: string
  badgeColor?: string
  badgeKey?: string // For dynamic badges (e.g., 'deposits', 'withdrawals')
  children?: NavChild[]
  permissions?: PermissionRequirement
  keywords?: string[] // For search
  description?: string // For tooltips
  hideForRoles?: string[] // Hide this item for specific roles
  showOnlyForRoles?: string[] // Show only when user has one of these roles (e.g. Super Admin only)
  showInCoreMode?: boolean // Show in Director Admin Core Data Management mode
  showInWhitelabelMode?: boolean // Show in Director Admin Whitelabel View mode
}

export interface NavSection {
  label: string
  icon?: string // Section icon for enterprise headers
  items: NavItem[]
  permissions?: PermissionRequirement
  priority?: RolePriority
  collapsible?: boolean
}

export interface PermissionRequirement {
  domain: string
  actions: string[]
  mode?: 'AND' | 'OR' // Default OR
}

export interface RolePriority {
  super_admin?: number
  admin?: number
  manager?: number
  operator?: number
  viewer?: number
}

interface SpecialNavItem {
  to: string
  icon: string
  label: string
  isSpecial: true
  permissions?: PermissionRequirement
  showInCoreMode?: boolean
  showInWhitelabelMode?: boolean
}

export type NavigationSection = NavSection | SpecialNavItem

// Type guard helpers
export interface NavSectionWithItems extends NavSection {
  items: NavItem[]
}

export interface SpecialNavItemWithMode extends SpecialNavItem {
  showInCoreMode?: boolean
  showInWhitelabelMode?: boolean
}

// Navigation data structure - reorganized with business-first grouping
export const navigationData: Record<string, NavigationSection> = {
  // Dashboard - Always first, always visible (both modes)
  overview: {
    to: "/overview",
    icon: "fa-solid fa-chart-line",
    label: "Dashboard",
    isSpecial: true,
    permissions: { domain: "overview.dashboard", actions: ["view"] },
    // Dashboard shows in both modes (with different data)
    showInCoreMode: true,
    showInWhitelabelMode: true,
  },

  // Trading Operations - Core business operations
  trading: {
    label: "Trading Operations",
    icon: "fa-solid fa-chart-simple",
    priority: {
      super_admin: 1,
      admin: 1,
      manager: 2,
      operator: 1,
      viewer: 1
    },
    // CRITICAL: Trading Operations section visible in both modes
    // But operational features (live analysis, running markets) are whitelabel-specific
    // Core mode: Only show configuration/management items (not operational features)
    // Whitelabel mode: Show all features including operational ones
    showInCoreMode: true,
    showInWhitelabelMode: true,
    items: [
      {
        key: "sports",
        label: "Sports Exchange",
        subtitle: "Markets & Risk",
        icon: "fa-solid fa-football",
        to: "/sports/events",
        permissions: { domain: "sports.events", actions: ["view"] },
        keywords: ["sports", "betting", "markets", "events", "odds", "risk"],
        description: "Manage sports betting events, markets, and risk",
        children: [
          { to: "/sports/events", icon: "fa-solid fa-calendar-days", label: "Running Events", permissions: { domain: "sports.events", actions: ["view"] }, keywords: ["events", "live", "running"], showInCoreMode: false, showInWhitelabelMode: true },
          { to: "/sports/manual-results", icon: "fa-solid fa-check-circle", label: "Results", permissions: { domain: "sports.results", actions: ["view", "create"] }, keywords: ["results", "settlement"], hideForRoles: ["Whitelabel Admin", "whitelabel_admin"], showInCoreMode: true, showInWhitelabelMode: false },
          { to: "/sports-exchange/builder", icon: "fa-solid fa-tools", label: "Sports Builder", permissions: { domain: "sports.builder", actions: ["view"] }, keywords: ["builder", "create", "setup"], hideForRoles: ["Whitelabel Admin", "whitelabel_admin"], showInCoreMode: true, showInWhitelabelMode: false },
          { to: "/sports-exchange/configuration", icon: "fa-solid fa-gear", label: "Configuration", permissions: { domain: "sports.configuration", actions: ["view"] }, keywords: ["config", "settings"], showInCoreMode: true, showInWhitelabelMode: false }
        ]
      },
      {
        key: "casino",
        to: "/casino/management",
        icon: "fa-solid fa-dice",
        label: "Casino",
        subtitle: "Games & Providers",
        permissions: { domain: "casino.management", actions: ["view"] },
        keywords: ["casino", "games", "slots", "providers"],
        description: "Manage casino games and providers",
        children: [
          { to: "/casino/management", icon: "fa-solid fa-sliders", label: "Management", permissions: { domain: "casino.management", actions: ["view", "update"] }, keywords: ["manage", "configure"], showInCoreMode: true, showInWhitelabelMode: false },
          { to: "/casino/vendors", icon: "fa-solid fa-building", label: "Vendor Management", permissions: { domain: "casino.vendors", actions: ["view"] }, keywords: ["vendors", "providers", "games"], showInCoreMode: true, showInWhitelabelMode: false },
          { to: "/casino/providers", icon: "fa-solid fa-server", label: "Providers", permissions: { domain: "casino.providers", actions: ["view"] }, keywords: ["providers", "integration"], hideForRoles: ["Whitelabel Admin", "whitelabel_admin"], showInCoreMode: true, showInWhitelabelMode: false },
          { to: "/casino/live", icon: "fa-solid fa-wave-square", label: "Live Analysis", permissions: { domain: "casino.live-analysis", actions: ["view"] }, keywords: ["live", "realtime", "analysis"], showInCoreMode: false, showInWhitelabelMode: true },
          { to: "/casino/categories", icon: "fa-solid fa-folder-tree", label: "Categories", permissions: { domain: "casino.categories", actions: ["view"] }, keywords: ["categories", "organize"], showInCoreMode: true, showInWhitelabelMode: false },
        ]
      },
      {
        key: "matka",
        to: "/matka/results",
        icon: "fa-solid fa-ticket",
        label: "Matka",
        subtitle: "Draws & Results",
        keywords: ["matka", "draws", "lottery", "results"],
        description: "Manage matka draws and results",
        // The group is visible when at least one individually permissioned child is accessible.
        children: [
          { to: "/matka/running", icon: "fa-solid fa-clock", label: "Running Markets", permissions: { domain: "matka.results", actions: ["view"] }, keywords: ["running", "open bets", "pending results", "settlement"], showInCoreMode: false, showInWhitelabelMode: true },
          { to: "/matka/results", icon: "fa-solid fa-check-circle", label: "Results", permissions: { domain: "matka.results", actions: ["view", "create"] }, keywords: ["results", "declare"], showInCoreMode: false, showInWhitelabelMode: true },
          { to: "/matka/live", icon: "fa-solid fa-wave-square", label: "Live Analysis", permissions: { domain: "matka.live-analysis", actions: ["view"] }, keywords: ["live", "analysis"], showInCoreMode: false, showInWhitelabelMode: true },
          { to: "/matka/management", icon: "fa-solid fa-sliders", label: "Management", permissions: { domain: "matka.management", actions: ["view"] }, keywords: ["manage", "configure"], showInCoreMode: true, showInWhitelabelMode: true },
          { to: "/matka/worli", icon: "fa-solid fa-chart-line", label: "Worli Markets", permissions: { domain: "matka.worli", actions: ["view"] }, keywords: ["worli", "running", "markets"], showInCoreMode: false, showInWhitelabelMode: true },
        ]
      },
      {
        key: "bets",
        to: "/bets",
        icon: "fa-solid fa-list-check",
        label: "Bet List",
        permissions: { domain: "sports.bets", actions: ["view"] },
        keywords: ["bets", "bet list", "sports", "casino", "matka", "matched", "won", "lost", "void"],
        description: "View all bets across sports, casino, and matka",
        showInCoreMode: false,
        showInWhitelabelMode: true,
      },
      {
        key: 'bonus-awards',
        to: '/bonus-awards',
        icon: 'fa-solid fa-gift',
        label: 'Bonus cards',
        permissions: { domain: 'bonuses.list', actions: ['view'] },
        keywords: ['bonus', 'bonus card', 'awards', 'player bonus', 'wagering'],
        description: 'All player bonus awards and cards',
        showInCoreMode: false,
        showInWhitelabelMode: true,
      },
    ]
  },

  // User Management
  userManagement: {
    label: "User Management",
    icon: "fa-solid fa-users-gear",
    priority: {
      super_admin: 2,
      admin: 2,
      manager: 1,
      operator: 2,
      viewer: 3
    },
    // CRITICAL: Whitelabel mode navigation (Director Admin only)
    showInWhitelabelMode: true,
    showInCoreMode: false,
    items: [
      {
        key: "players",
        to: "/players",
        icon: "fa-solid fa-users",
        label: "Players",
        subtitle: "Manage Players",
        permissions: { domain: "players.list", actions: ["view"] },
        keywords: ["players", "users", "customers", "accounts"],
        description: "Manage player accounts and activity",
        children: [
          { to: "/players", icon: "fa-solid fa-list", label: "All Players", permissions: { domain: "players.list", actions: ["view"] }, keywords: ["list", "search", "find"] },
          { to: "/players/create", icon: "fa-solid fa-user-plus", label: "Create Player", permissions: { domain: "players.create", actions: ["view", "create"] }, keywords: ["create", "add", "new"] },
          { to: "/players/activity", icon: "fa-solid fa-chart-line", label: "Player Activity", permissions: { domain: "players.activity", actions: ["view"] }, keywords: ["activity", "sessions", "tracking"], hideForRoles: ["Whitelabel Admin", "whitelabel_admin"] },
        ]
      },
      {
        key: "agents",
        to: "/agents",
        icon: "fa-solid fa-sitemap",
        label: "Agents",
        subtitle: "Management & Credit",
        permissions: { domain: "agents.list", actions: ["view"] },
        keywords: ["agents", "downline", "credit"],
        description: "Manage agents and credit",
        children: [
          { to: "/agents", icon: "fa-solid fa-list", label: "All Agents", permissions: { domain: "agents.list", actions: ["view"] }, keywords: ["agents", "list", "all", "search"] },
          { to: "/agents/create", icon: "fa-solid fa-user-plus", label: "Create Agent", permissions: { domain: "agents.create", actions: ["view", "create"] }, keywords: ["create", "add", "new"] },
        ]
      },
    ]
  },

  // Marketing & Engagement
  marketing: {
    label: "Marketing & Engagement",
    icon: "fa-solid fa-bullhorn",
    priority: {
      super_admin: 3,
      admin: 3,
      manager: 3,
      operator: 5
    },
    // CRITICAL: Marketing is whitelabel-specific, not core data
    // Whitelabel Admins can manage marketing for their whitelabel
    showInCoreMode: false,
    showInWhitelabelMode: true,
    items: [
      {
        key: "bonuses",
        to: "/bonuses",
        icon: "fa-solid fa-gift",
        label: "Bonuses",
        subtitle: "Rewards & Bundles",
        permissions: { domain: "bonuses.list", actions: ["view"] },
        keywords: ["bonuses", "rewards", "incentives", "bundles"],
        description: "Manage bonus campaigns and game bundles",
        children: [
          { to: "/bonuses", icon: "fa-solid fa-list", label: "All Bonuses", permissions: { domain: "bonuses.list", actions: ["view"] }, keywords: ["list", "active"] },
          { to: "/bonuses/new", icon: "fa-solid fa-plus", label: "Create Bonus", permissions: { domain: "bonuses.create", actions: ["view", "create"] }, keywords: ["create", "new"] },
          { to: "/bonuses/bundles", icon: "fa-solid fa-box", label: "Bundles", permissions: { domain: "bonuses.bundles", actions: ["view"] }, keywords: ["bundles", "games"] },
        ]
      },
      {
        key: "referrals",
        to: "/referrals",
        icon: "fa-solid fa-user-group",
        label: "Referrals",
        subtitle: "Program & Earnings",
        permissions: { domain: "referrals.overview", actions: ["view"] },
        keywords: ["referrals", "affiliates", "commission", "earnings"],
        description: "Manage referral program and payouts",
        children: [
          { to: "/referrals", icon: "fa-solid fa-chart-pie", label: "Overview", permissions: { domain: "referrals.overview", actions: ["view"] }, keywords: ["overview", "dashboard"] },
          { to: "/referrals/program", icon: "fa-solid fa-gear", label: "Program Settings", permissions: { domain: "referrals.program", actions: ["view"] }, keywords: ["program", "settings", "configure"] },
          { to: "/referrals/rules", icon: "fa-solid fa-list-check", label: "Rules", permissions: { domain: "referrals.rules", actions: ["view"] }, keywords: ["rules", "conditions"] },
          { to: "/referrals/earnings", icon: "fa-solid fa-sack-dollar", label: "Earnings", permissions: { domain: "referrals.earnings", actions: ["view"] }, keywords: ["earnings", "commission"] },
          { to: "/referrals/top-referrers", icon: "fa-solid fa-trophy", label: "Top Referrers", permissions: { domain: "referrals.top-referrers", actions: ["view"] }, keywords: ["top", "leaderboard"] },
        ]
      },
      {
        key: "vip",
        to: "/vip/tiers",
        icon: "fa-solid fa-crown",
        label: "VIP System",
        subtitle: "Tiers & Benefits",
        permissions: { domain: "vip.tiers", actions: ["view"] },
        keywords: ["vip", "loyalty", "tiers", "benefits", "rewards"],
        description: "Manage VIP tiers and member benefits",
        children: [
          { to: "/vip/tiers", icon: "fa-solid fa-layer-group", label: "Tiers", permissions: { domain: "vip.tiers", actions: ["view"] }, keywords: ["tiers", "levels"] },
          { to: "/vip/tiers/create", icon: "fa-solid fa-plus", label: "Create Tier", permissions: { domain: "vip.tiers", actions: ["create"] }, keywords: ["create", "new"] },
        ]
      },
    ]
  },


  // Finance
  finance: {
    label: "Finance",
    icon: "fa-solid fa-landmark",
    priority: {
      super_admin: 4,
      admin: 4,
      manager: 2,
      operator: 3
    },
    // CRITICAL: Whitelabel mode navigation (Director Admin only)
    showInWhitelabelMode: true,
    showInCoreMode: false,
    items: [
      {
        key: "payments",
        to: "/payments/deposits",
        icon: "fa-solid fa-money-bill-transfer",
        label: "Payments",
        subtitle: "Deposits & Withdrawals",
        badgeKey: "payments",
        permissions: { domain: "payments.deposits", actions: ["view"] },
        keywords: ["payments", "deposits", "withdrawals", "transactions"],
        description: "Manage payment requests and methods",
        children: [
          { to: "/payments/deposits", icon: "fa-solid fa-arrow-down", label: "Deposit Requests", permissions: { domain: "payments.deposits", actions: ["view"] }, keywords: ["deposits", "pending", "approve"] },
          { to: "/payments/withdrawal-requests", icon: "fa-solid fa-arrow-up", label: "Withdrawal Requests", permissions: { domain: "payments.withdrawals", actions: ["view"] }, keywords: ["withdrawals", "pending", "approve"] },
          { to: "/payments/payout-approvals", icon: "fa-solid fa-user-check", label: "Payout Account Approvals", permissions: { domain: "payments.withdrawals", actions: ["view"] }, keywords: ["payout", "account", "approve", "withdrawal"] },
          { to: "/payments/methods", icon: "fa-solid fa-wallet", label: "Payment Methods", permissions: { domain: "payments.methods", actions: ["view"] }, keywords: ["methods", "gateways", "setup"] },
        ]
      },
      {
        key: "settlements",
        to: "/settlement",
        icon: "fa-solid fa-handshake",
        label: "Settlements",
        subtitle: "Agent & Commission",
        permissions: { domain: "settlements.center", actions: ["view"] },
        keywords: ["settlements", "agent", "commission", "payout", "credit"],
        description: "Manage agent settlements, commission payouts, and credit adjustments",
        children: [
          { to: "/settlement", icon: "fa-solid fa-chart-pie", label: "Settlement Center", permissions: { domain: "settlements.center", actions: ["view"] }, keywords: ["center", "dashboard", "overview"] },
        ],
      },
    ]
  },

  // Reporting & Analytics
  reporting: {
    // Section shows in both modes; items filter by showInCoreMode/showInWhitelabelMode
    showInWhitelabelMode: true,
    showInCoreMode: true,
    label: "Reporting & Analytics",
    icon: "fa-solid fa-chart-pie",
    priority: {
      super_admin: 5,
      admin: 5,
      manager: 4,
      operator: 2,
      viewer: 2
    },
    items: [
      {
        key: "reports",
        to: "/reporting/pnl",
        icon: "fa-solid fa-chart-line",
        label: "Business Reports",
        subtitle: "P&L & Exposure",
        permissions: { domain: "reporting.pnl", actions: ["view"] },
        keywords: ["reports", "analytics", "pnl", "exposure"],
        description: "View business performance reports",
        showInCoreMode: false,
        children: [
          { to: "/reporting/pnl", icon: "fa-solid fa-chart-line", label: "P&L Report", permissions: { domain: "reporting.pnl", actions: ["view"] }, keywords: ["pnl", "profit", "loss"] },
          { to: "/reporting/exposure", icon: "fa-solid fa-shield-halved", label: "Exposure Report", permissions: { domain: "reporting.exposure", actions: ["view"] }, keywords: ["exposure", "risk", "liability"] },
        ]
      },
      {
        key: "domain-reports",
        to: "/reporting/domain",
        icon: "fa-solid fa-chart-pie",
        label: "Domain Reports",
        subtitle: "Sports, Casino, Matka",
        permissions: { domain: "reporting.sports", actions: ["view"] },
        keywords: ["domain", "sports", "casino", "matka", "breakdown"],
        description: "View performance by domain",
        showInCoreMode: false,
        children: [
          { to: "/reporting/sports", icon: "fa-solid fa-futbol", label: "Sports Report", permissions: { domain: "reporting.sports", actions: ["view"] }, keywords: ["sports", "betting", "events"] },
          { to: "/reporting/casino", icon: "fa-solid fa-dice", label: "Casino Report", permissions: { domain: "reporting.casino", actions: ["view"] }, keywords: ["casino", "games", "providers"] },
          { to: "/reporting/matka", icon: "fa-solid fa-chart-bar", label: "Matka Report", permissions: { domain: "reporting.matka", actions: ["view"] }, keywords: ["matka", "numbers", "sessions"] },
        ]
      },
      {
        key: "agent-reports",
        to: "/reporting/agents",
        icon: "fa-solid fa-chart-bar",
        label: "Agent Reports",
        subtitle: "Performance & Commission",
        permissions: { domain: "reporting.agents-performance", actions: ["view"] },
        keywords: ["agents", "commission", "performance", "downline"],
        description: "View agent performance and commission reports",
        showInCoreMode: false,
        children: [
          { to: "/reporting/agents/performance", icon: "fa-solid fa-chart-line", label: "Agent Performance", permissions: { domain: "reporting.agents-performance", actions: ["view"] }, keywords: ["agents", "performance", "commission", "revenue", "earnings", "settlement"] },
        ]
      },
      {
        key: "player-reports",
        to: "/reporting/players",
        icon: "fa-solid fa-chart-area",
        label: "Player Reports",
        subtitle: "Activity & Profitability",
        permissions: { domain: "reporting.players-activity", actions: ["view"] },
        keywords: ["players", "activity", "profitability", "behavior"],
        description: "View player activity and profitability reports",
        showInCoreMode: false,
        children: [
          { to: "/reporting/players/activity", icon: "fa-solid fa-chart-area", label: "Player Activity", permissions: { domain: "reporting.players-activity", actions: ["view"] }, keywords: ["activity", "bets", "sessions"] },
          { to: "/reporting/players/profitability", icon: "fa-solid fa-dollar-sign", label: "Player Profitability", permissions: { domain: "reporting.players-profitability", actions: ["view"] }, keywords: ["profitability", "revenue", "ltv"] },
          { to: "/reporting/players/nth-dw", icon: "fa-solid fa-wallet", label: "Nth D/W", permissions: { domain: "reporting.players-activity", actions: ["view"] }, keywords: ["deposit", "withdrawal", "nth", "dw"] },
        ]
      },
      {
        key: "exports",
        to: "/reporting/exports",
        icon: "fa-solid fa-download",
        label: "Export Center",
        subtitle: "Download Reports",
        permissions: { domain: "reporting.exports", actions: ["view"] },
        keywords: ["export", "download", "reports", "csv", "excel"],
        description: "Create and download report exports",
        showInCoreMode: false,
        showInWhitelabelMode: true,
      },
      {
        key: "snapshot-health",
        to: "/reporting/snapshot-health",
        icon: "fa-solid fa-heart-pulse",
        label: "Snapshot health",
        subtitle: "Jobs, logs, missing days",
        permissions: { domain: "reporting.snapshot-health", actions: ["view"] },
        keywords: ["snapshot", "reporting", "cron", "pg-boss", "audit", "daily"],
        description: "Reporting daily snapshot pipeline status and recovery",
        showOnlyForRoles: ["Super Admin", "super_admin"],
        showInCoreMode: true,
        showInWhitelabelMode: false,
      },
    ]
  },

  // System & Security
  system: {
    label: "System & Security",
    icon: "fa-solid fa-shield-halved",
    priority: {
      super_admin: 6,
      admin: 6,
      manager: 6,
      operator: 6,
      viewer: 6
    },
    // No section-level permission - let individual items control access
    // This allows Whitelabel Admin to see Security (roles:read) and Configuration (config:read)
    permissions: undefined,
    // CRITICAL: Show section in both modes, but filter children based on mode
    showInCoreMode: true,
    showInWhitelabelMode: true,
    items: [
      { key: 'support-chat', to: '/support/live-chat', icon: 'fa-solid fa-headset', label: 'Live Chat Inbox', subtitle: 'Player Support', permissions: { domain: 'support.chat', actions: ['view'] }, keywords: ['support','chat','inbox','messages'], showInCoreMode: false, showInWhitelabelMode: true },
      {
        key: "security",
        to: "/security/roles",
        icon: "fa-solid fa-user-lock",
        label: "Security",
        subtitle: "Roles & Permissions",
        permissions: { domain: "security.roles", actions: ["view"] },
        keywords: ["security", "roles", "permissions", "rbac", "access"],
        description: "Manage roles and permissions",
        children: [
          { to: "/security/roles", icon: "fa-solid fa-users-gear", label: "Roles Management", permissions: { domain: "security.roles", actions: ["view"] }, keywords: ["roles", "create", "edit"] },
          { to: "/security/support-admins", icon: "fa-solid fa-headset", label: "Support Admins", permissions: { domain: "security.support-admins", actions: ["view"] }, keywords: ["admins", "support", "assign"] }
        ]
      },
      {
        key: "configuration",
        to: "/config/app-configuration",
        icon: "fa-solid fa-gear",
        label: "Configuration",
        subtitle: "System & Tenant",
        permissions: { domain: "config.app", actions: ["view"] },
        keywords: ["config", "settings", "system", "whitelabel", "tenant"],
        description: "System and tenant configuration",
        children: [
          { to: "/config/app-configuration", icon: "fa-solid fa-sliders", label: "App Configuration", permissions: { domain: "config.app", actions: ["view", "update"] }, keywords: ["app", "settings"], hideForRoles: ["Super Admin", "super_admin", "Admin", "admin", "Manager", "manager"], showInCoreMode: true, showInWhitelabelMode: true },
          { to: "/config/whitelabels", icon: "fa-solid fa-sitemap", label: "Whitelabels", permissions: { domain: "config.whitelabels", actions: ["view"] }, keywords: ["whitelabel", "brands", "tenants"], hideForRoles: ["Whitelabel Admin", "whitelabel_admin"], showInCoreMode: true, showInWhitelabelMode: false },
          { to: "/payments/pg-settings", icon: "fa-solid fa-credit-card", label: "PG Settings", permissions: { domain: "payments.pgsettings", actions: ["view"] }, keywords: ["pg", "gateway", "payment", "welivepay", "upi"], showInCoreMode: true, showInWhitelabelMode: true },
          { to: "/config/otp-providers", icon: "fa-solid fa-message", label: "OTP Providers", permissions: { domain: "config.otp-providers", actions: ["view"] }, keywords: ["otp", "sms", "providers"], hideForRoles: ["Whitelabel Admin", "whitelabel_admin"], showInCoreMode: true, showInWhitelabelMode: false },
          { to: "/config/advertisements", icon: "fa-solid fa-image", label: "Advertisements", permissions: { domain: "config.advertisements", actions: ["view"] }, keywords: ["ads", "banners"], showInCoreMode: false, showInWhitelabelMode: true },
          { to: "/currency", icon: "fa-solid fa-coins", label: "Currency Management", permissions: { domain: "currency.list", actions: ["view"] }, keywords: ["currency", "exchange", "rates"], showInCoreMode: true, showInWhitelabelMode: false },
          // Super Admin only: the resolver refuses anyone else, and this decides
          // which whitelabels may spend at the AI provider and how much.
          { to: "/config/ai-assistant", icon: "fa-solid fa-wand-magic-sparkles", label: "AI Assistant Access", permissions: { domain: "config.app", actions: ["view"] }, keywords: ["ai", "assistant", "openai", "chat", "limit", "allowance", "quota"], hideForRoles: ["Whitelabel Admin", "whitelabel_admin"], showInCoreMode: true, showInWhitelabelMode: true },
          { to: "/config/crm-access", icon: "fa-solid fa-headset", label: "CRM Access", permissions: { domain: "config.app", actions: ["view"] }, keywords: ["crm", "desk", "seats", "access", "whitelabel"], hideForRoles: ["Whitelabel Admin", "whitelabel_admin"], showInCoreMode: true, showInWhitelabelMode: true },
          // Deliberately NOT hidden for Whitelabel Admin: this is the one CRM
          // page they own. Granting the seats stays above (Super Admin); filling
          // them is theirs. The resolvers refuse anyone who is neither.
          { to: "/config/crm-users", icon: "fa-solid fa-user-gear", label: "CRM Users", permissions: { domain: "config.app", actions: ["view"] }, keywords: ["crm", "users", "login", "password", "desk", "agent", "seats"], showInCoreMode: true, showInWhitelabelMode: true },
        ]
      },
      {
        to: "/audit/events",
        icon: "fa-solid fa-clipboard-list",
        label: "Audit Trail",
        subtitle: "Events & Logs",
        permissions: { domain: "audit.events", actions: ["view"] },
        keywords: ["audit", "logs", "history", "tracking"],
        description: "View system audit logs"
      },
    ]
  }
}
