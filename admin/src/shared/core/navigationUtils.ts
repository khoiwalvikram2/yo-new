import type { NavigationSection, NavItem, NavChild, PermissionRequirement } from '../../components/sidebar/navigationData'
import { useUIStore } from './uiStore'
import { hasPermissionWithNested } from './nestedPermissionMapping'

export interface AgentAccount {
	id: string
	schemeType: 'COMMISSION' | 'SHARING' | 'CREDIT'
	allowedDomains: string[]
	levelIndex: number | null
}

export interface UserPermission {
	domain: string
	actions: string[]
}

export type UserRole = 'super_admin' | 'admin' | 'manager' | 'operator' | 'viewer'

/**
 * Filters navigation data for agents based on their allowedDomains and scheme type
 * Different navigation for Commission vs Sharing agents
 */
export function getAgentNavigation(
	agent: AgentAccount,
	allowedDomains: string[]
): Record<string, NavigationSection> {
	const filtered: Record<string, NavigationSection> = {}
	
	// Safety check: ensure allowedDomains is an array
	if (!Array.isArray(allowedDomains)) {
		allowedDomains = []
	}

	const isCommissionAgent = agent.schemeType === 'COMMISSION'
	const isSharingAgent = agent.schemeType === 'SHARING' || agent.schemeType === 'CREDIT'

	// 1. Dashboard - always show for agents (matches whitelabel admin)
	filtered.overview = {
		to: '/agent',
		icon: 'fa-solid fa-chart-line',
		label: 'Dashboard',
		isSpecial: true,
	}

	// 2. Trading Operations - only show domains in allowedDomains (matches whitelabel admin structure)
	const tradingItems: NavItem[] = []

	if (allowedDomains.includes('sports')) {
		tradingItems.push({
			key: 'sports',
			label: 'Sports Exchange',
			subtitle: 'Markets & Risk',
			icon: 'fa-solid fa-football',
			to: '/sports/events',
			children: [
				{ to: '/sports/events', icon: 'fa-solid fa-calendar-days', label: 'Sports Running Events' },
			],
		})
	}

	if (allowedDomains.includes('casino')) {
		tradingItems.push({
			key: 'casino',
			to: '/casino/live',
			icon: 'fa-solid fa-dice',
			label: 'Casino',
			subtitle: 'Casino Live Analysis',
			children: [
				{ to: '/casino/live', icon: 'fa-solid fa-wave-square', label: 'Casino Live Analysis' },
			],
		})
	}

	if (allowedDomains.includes('matka')) {
		// Matka results are declared by admins (/matka/results is admin-only and sends an agent back to
		// /agent), so an agent gets the live analysis only.
		tradingItems.push({
			key: 'matka',
			to: '/matka/live',
			icon: 'fa-solid fa-ticket',
			label: 'Matka',
			subtitle: 'Matka Live Analysis',
			children: [
				{ to: '/matka/live', icon: 'fa-solid fa-wave-square', label: 'Matka Live Analysis' },
			],
		})
	}

	// Bet List - show for all agents (data is scoped to their players by backend)
	tradingItems.push({
		key: 'bets',
		to: '/bets',
		icon: 'fa-solid fa-list-check',
		label: 'Bet List',
		subtitle: 'My players\' bets',
	})

	if (tradingItems.length > 0) {
		filtered.trading = {
			label: 'Trading Operations',
			icon: 'fa-solid fa-chart-simple',
			items: tradingItems,
		}
	}

	// 3. User Management - Combined Players and Agents (matches whitelabel admin structure)
	const userManagementItems: NavItem[] = []
	
	// Players - always available for agents
	userManagementItems.push({
		key: 'players',
		to: '/players',
		icon: 'fa-solid fa-users',
		label: 'Players',
		subtitle: 'Manage Players',
		children: [
			{ to: '/players', icon: 'fa-solid fa-list', label: 'All Players' },
			{ to: '/players/create', icon: 'fa-solid fa-user-plus', label: 'Create Player' },
		],
	})
	
	// Agents / Sub-Agents - sharing/credit get full Agents; commission gets Sub-Agents (hierarchy + create)
	// SHARING/CREDIT: max hierarchy depth is 4 levels, so Level 4 agents have no sub-agents — hide entire section
	const canCreateSubAgent = agent.levelIndex == null || agent.levelIndex < 4

	if (isSharingAgent && canCreateSubAgent) {
		userManagementItems.push({
			key: 'agents',
			to: '/agents',
			icon: 'fa-solid fa-sitemap',
			label: 'Agents',
			subtitle: 'Management & Credit',
			children: [
				{ to: '/agents', icon: 'fa-solid fa-list', label: 'All Agents' },
				{ to: '/agent/create', icon: 'fa-solid fa-user-plus', label: 'Create Agent' },
			],
		})
	} else if (isCommissionAgent) {
		userManagementItems.push({
			key: 'subagents',
			to: '/agents',
			icon: 'fa-solid fa-users',
			label: 'Sub-Agents',
			subtitle: 'List & Create',
			children: [
				{ to: '/agents', icon: 'fa-solid fa-list', label: 'All Sub-Agents' },
				{ to: '/agent/create', icon: 'fa-solid fa-user-plus', label: 'Create Sub-Agent' },
			],
		})
	}
	
	filtered.userManagement = {
		label: 'User Management',
		icon: 'fa-solid fa-users-gear',
		items: userManagementItems,
	}

	// 4. Marketing & Engagement - Referrals + Bonuses (Bonus reports under Bonus section)
	const marketingItems: NavItem[] = []
	if (agent.schemeType === 'SHARING' || agent.schemeType === 'COMMISSION') {
		marketingItems.push({
			key: 'referrals',
			to: '/agent/referral',
			icon: 'fa-solid fa-user-group',
			label: 'Referrals',
			subtitle: 'Invite Players',
			children: [
				{ to: '/agent/referral', icon: 'fa-solid fa-link', label: 'My Referral Link' },
			],
		})
	}
	filtered.marketing = {
		label: 'Marketing & Engagement',
		icon: 'fa-solid fa-bullhorn',
		items: marketingItems,
	}

	// 5. Finance - Commission or Settlement (matches whitelabel admin structure)
	if (isCommissionAgent) {
		filtered.finance = {
			label: 'Finance',
			icon: 'fa-solid fa-landmark',
			items: [
				{
					key: 'commission',
					to: '/commission/overview',
					icon: 'fa-solid fa-sack-dollar',
					label: 'My Commission',
					subtitle: 'Earnings & Payments',
					children: [
						{ to: '/commission/overview', icon: 'fa-solid fa-chart-pie', label: 'Dashboard' },
						{ to: '/commission/history', icon: 'fa-solid fa-clock-rotate-left', label: 'Commission History' },
					],
				},
			],
		}
	} else if (isSharingAgent) {
		filtered.finance = {
			label: 'Finance',
			icon: 'fa-solid fa-landmark',
			// A CREDIT agent's finance is its Chips page (/agent/credit): its balance, its downline with Deposit /
			// Withdraw, and its chip statement (spec 2026-11-02 §8). It has no Settlement Center: CREDIT settles
			// nothing since then, its Ref P/L is settled by a Deposit / Withdraw (spec §6).
			items: agent.schemeType === 'CREDIT' ? [
				{
					key: 'credit',
					to: '/agent/credit',
					icon: 'fa-solid fa-coins',
					label: 'Chips',
					subtitle: 'Deposit & Withdraw',
				},
			] : [
				{
					key: 'settlements',
					to: '/settlement',
					icon: 'fa-solid fa-handshake',
					label: 'Settlement Center',
					subtitle: 'Ledger & Payments',
					// Single clickable button (no children) - agent goes to unified settlement page
				},
			],
		}
	}

	// 6. Reporting & Analytics (matches whitelabel admin structure with grouped reports)
	const businessReportChildren: NavChild[] = [
		{ to: '/reporting/pnl', icon: 'fa-solid fa-chart-line', label: 'P&L Report' },
		{ to: '/reporting/exposure', icon: 'fa-solid fa-shield-halved', label: 'Exposure Report' },
	]
	
	const domainReportChildren: NavChild[] = []
	if (allowedDomains.includes('sports')) {
		domainReportChildren.push({ to: '/reporting/sports', icon: 'fa-solid fa-futbol', label: 'Sports Report' })
	}
	if (allowedDomains.includes('casino')) {
		domainReportChildren.push({ to: '/reporting/casino', icon: 'fa-solid fa-dice', label: 'Casino Report' })
	}
	if (allowedDomains.includes('matka')) {
		domainReportChildren.push({ to: '/reporting/matka', icon: 'fa-solid fa-chart-bar', label: 'Matka Report' })
	}
	
	const agentReportChildren: NavChild[] = [
		{ to: '/reporting/agents/performance', icon: 'fa-solid fa-chart-line', label: 'Agent Performance' },
	]
	
	// Commission agents: hide Player Profitability report
	const playerReportChildren: NavChild[] = [
		{ to: '/reporting/players/activity', icon: 'fa-solid fa-chart-area', label: 'Player Activity' },
		...(isCommissionAgent ? [] : [{ to: '/reporting/players/profitability', icon: 'fa-solid fa-dollar-sign', label: 'Player Profitability' }]),
		{ to: '/reporting/players/nth-dw', icon: 'fa-solid fa-wallet', label: 'Nth D/W' },
	]

	const reportingItems: NavItem[] = [
		{
			key: 'reports',
			to: '/reporting/pnl',
			icon: 'fa-solid fa-chart-line',
			label: 'Business Reports',
			subtitle: 'P&L & Exposure',
			children: businessReportChildren,
		},
	]
	
	if (domainReportChildren.length > 0) {
		reportingItems.push({
			key: 'domain-reports',
			to: domainReportChildren[0].to,
			icon: 'fa-solid fa-chart-pie',
			label: 'Domain Reports',
			subtitle: 'Sports, Casino, Matka',
			children: domainReportChildren,
		})
	}
	
	reportingItems.push({
		key: 'agent-reports',
		to: '/reporting/agents/performance',
		icon: 'fa-solid fa-chart-bar',
		label: 'Agent Reports',
		subtitle: 'Performance & Commission',
		children: agentReportChildren,
	})
	
	reportingItems.push({
		key: 'player-reports',
		to: '/reporting/players/activity',
		icon: 'fa-solid fa-chart-area',
		label: 'Player Reports',
		subtitle: 'Activity & Profitability',
		children: playerReportChildren,
	})
	
	// Export Center for every agent scheme (agent features spec §4, owner decision 4, 2026-10-22).
	// The backend scopes each agent export to the agent's own subtree, in SQL before the row cap, and
	// refuses the whitelabel-level types (audit logs, bonus campaigns, GGR); the page lists only the
	// types the agent's scheme and domains may export (exportsPageModel.availableExportTypes).
	reportingItems.push({
		key: 'exports',
		to: '/reporting/exports',
		icon: 'fa-solid fa-download',
		label: 'Export Center',
		subtitle: 'Download Reports',
		keywords: ['export', 'download', 'reports', 'csv', 'excel'],
	})

	filtered.reporting = {
		label: 'Reporting & Analytics',
		icon: 'fa-solid fa-chart-pie',
		items: reportingItems,
	}

	return filtered
}

/**
 * Check if user has required permissions.
 * Uses nested RBAC: supports exact (nested or flat) match and flat→nested backward compat.
 */
export function hasRequiredPermissions(
	requirement: PermissionRequirement | undefined,
	userPermissions: UserPermission[]
): boolean {
	if (!requirement) return true

	const mode = requirement.mode || 'OR'
	if (mode === 'AND') {
		return requirement.actions.every(action =>
			hasPermissionWithNested(userPermissions, requirement.domain, action)
		)
	}
	return requirement.actions.some(action =>
		hasPermissionWithNested(userPermissions, requirement.domain, action)
	)
}

/**
 * Filter navigation items based on user permissions
 */
export function filterNavItemsByPermissions(
	items: NavItem[],
	userPermissions: UserPermission[],
	userRoles: string[] = []
): NavItem[] {
	const childVisible = (child: NavChild) => {
		// Check permissions
		if (!hasRequiredPermissions(child.permissions, userPermissions)) {
			return false
		}
		// Check if hidden for user's roles
		if (child.hideForRoles && userRoles.some(role => child.hideForRoles?.includes(role))) {
			return false
		}
		// Check if shown only for specific roles (e.g. Super Admin only)
		if (child.showOnlyForRoles && child.showOnlyForRoles.length > 0) {
			if (!userRoles.some(role => child.showOnlyForRoles?.includes(role))) {
				return false
			}
		}
		// The linked page's own role-or-permission rule (T068: the Chips page)
		if (child.access && !child.access(userRoles, userPermissions)) {
			return false
		}
		// Hide Hierarchy for all admins (it's agent-only, agents use getAgentNavigation)
		if (child.to && child.to.includes('/agents/hierarchy')) {
			return false
		}
		return true
	}

	return items
		.map(item => {
			// Check if hidden for user's roles
			if (item.hideForRoles && userRoles.some(role => item.hideForRoles?.includes(role))) {
				return null
			}
			// Check if shown only for specific roles (e.g. Super Admin only)
			if (item.showOnlyForRoles && item.showOnlyForRoles.length > 0) {
				if (!userRoles.some(role => item.showOnlyForRoles?.includes(role))) {
					return null
				}
			}
			// Check permissions. A group the user's permissions leave out still shows the children whose own access
			// rule admits the user, and only those (T068: a Finance Manager without agent access reaches the Chips page
			// under Agents, and no agent page).
			if (!hasRequiredPermissions(item.permissions, userPermissions)) {
				const admitted = (item.children ?? []).filter(child => child.access !== undefined && childVisible(child))
				return admitted.length > 0 ? { ...item, children: admitted } : null
			}
			// Filter children if they exist
			if (item.children) {
				const filteredChildren = item.children.filter(childVisible)
				// Only include item if it has visible children
				if (filteredChildren.length === 0) return null
				return { ...item, children: filteredChildren }
			}
			return item
		})
		.filter((item): item is NavItem => item !== null)
}

/**
 * Filter complete navigation data based on user permissions
 */
export function filterNavigationByPermissions(
	navigation: Record<string, NavigationSection>,
	userPermissions: UserPermission[],
	userRoles: string[] = []
): Record<string, NavigationSection> {
	const filtered: Record<string, NavigationSection> = {}

	for (const [key, section] of Object.entries(navigation)) {
		// Check if it's a special item
		if ('isSpecial' in section && section.isSpecial) {
			if (hasRequiredPermissions(section.permissions, userPermissions)) {
				filtered[key] = section
			}
			continue
		}

		// It's a regular section
		// Check section-level permissions
		if (!hasRequiredPermissions(section.permissions, userPermissions)) {
			continue
		}

		// Filter items in the section (only if section has items property)
		if (!('items' in section) || !section.items) {
			continue
		}
		const filteredItems = filterNavItemsByPermissions(section.items, userPermissions, userRoles)

		// Only include section if it has visible items
		if (filteredItems.length > 0) {
			filtered[key] = {
				...section,
				items: filteredItems,
			}
		}
	}

	return filtered
}

/**
 * Sort navigation sections by role priority
 */
export function sortNavigationByRole(
	navigation: Record<string, NavigationSection>,
	role: UserRole
): Record<string, NavigationSection> {
	const entries = Object.entries(navigation)

	// Sort entries by priority for the given role
	const sorted = entries.sort(([_keyA, sectionA], [_keyB, sectionB]) => {
		// Special items always come first
		if ('isSpecial' in sectionA && sectionA.isSpecial) return -1
		if ('isSpecial' in sectionB && sectionB.isSpecial) return 1

		// Get priorities for the role
		const priorityA = ('priority' in sectionA && sectionA.priority?.[role]) || 999
		const priorityB = ('priority' in sectionB && sectionB.priority?.[role]) || 999

		return priorityA - priorityB
	})

	// Convert back to object
	return Object.fromEntries(sorted)
}

/**
 * Get user's primary role from roles array
 * Returns highest priority role
 */
export function getPrimaryRole(roles: string[]): UserRole {
	const rolePriority: Record<string, number> = {
		'Super Admin': 1,
		'super_admin': 1,
		'Admin': 2,
		'admin': 2,
		'Manager': 3,
		'manager': 3,
		'Operator': 4,
		'operator': 4,
		'Viewer': 5,
		'viewer': 5,
		// Whitelabel Admin should be treated as admin-level for navigation purposes
		'Whitelabel Admin': 2,
		'whitelabel_admin': 2,
	}

	// Find highest priority role
	let highestPriority = 999
	let primaryRole: UserRole = 'viewer'

	for (const role of roles) {
		const priority = rolePriority[role] || 999
		if (priority < highestPriority) {
			highestPriority = priority
			// Normalize to lowercase role name
			const normalized = role.toLowerCase().replace(' ', '_')
			if (['super_admin', 'admin', 'manager', 'operator', 'viewer'].includes(normalized)) {
				primaryRole = normalized as UserRole
			} else if (normalized.includes('whitelabel')) {
				// Whitelabel Admin should be treated as admin for navigation sorting
				primaryRole = 'admin'
			}
		}
	}

	return primaryRole
}

/**
 * Get filtered and sorted navigation for current user
 * Combines permission filtering and role-based sorting
 * CRITICAL: Only applies Super Admin mode filtering for Super Admin role
 * Whitelabel Admin and Agents use existing navigation logic (UNCHANGED)
 */
export function getNavigationForUser(
	navigation: Record<string, NavigationSection>,
	userPermissions: UserPermission[],
	userRoles: string[]
): Record<string, NavigationSection> {
	// CRITICAL: Check if user is Super Admin
	const isSuperAdmin = userRoles.some(role =>
		role === 'Super Admin' || role.toLowerCase() === 'super_admin' || 
		(role.toLowerCase().includes('super') && role.toLowerCase().includes('admin'))
	)
	
	// Get Super Admin mode from UI store (only if Super Admin)
	// CRITICAL: Use UI store instead of direct localStorage access for consistency
	let directorMode: 'core' | 'whitelabel' | null = null
	if (isSuperAdmin && typeof window !== 'undefined') {
		try {
			// Use UI store directly (synchronous access)
			const mode = useUIStore.getState().directorMode
			if (mode === 'core' || mode === 'whitelabel') {
				directorMode = mode
			}
		} catch {}
	}
	// Special handling for Whitelabel Admin role - give them basic permissions if they don't have any
	// Use consistent role check pattern (matches backend and other frontend checks)
	const isWhitelabelAdmin = userRoles.some(role => 
		role === 'Whitelabel Admin' || role.toLowerCase() === 'whitelabel_admin' || role.toLowerCase().includes('whitelabel')
	)
	
	// CRITICAL: When Super Admin is in Whitelabel View mode, treat them as Whitelabel Admin for navigation filtering
	// This ensures they see the same navigation items that a Whitelabel Admin would see
	const shouldApplyWhitelabelAdminFiltering = isWhitelabelAdmin || (isSuperAdmin && directorMode === 'whitelabel')
	
	// If whitelabel admin has no permissions, give them basic read permissions for common domains
	if (isWhitelabelAdmin && (!userPermissions || userPermissions.length === 0)) {
		userPermissions = [
			{ domain: 'users', actions: ['read', 'write'] },
			{ domain: 'sports', actions: ['read'] },
			{ domain: 'casino', actions: ['read'] },
			{ domain: 'matka', actions: ['read'] },
			{ domain: 'promotions', actions: ['read'] },
			{ domain: 'bonuses', actions: ['read', 'write'] },
			{ domain: 'referrals', actions: ['read', 'write', 'manage'] },
			{ domain: 'jackpots', actions: ['read'] },
			{ domain: 'vip', actions: ['read'] },
			{ domain: 'finance', actions: ['read'] },
			{ domain: 'reporting', actions: ['read'] },
			{ domain: 'config', actions: ['read', 'write'] },
			{ domain: 'roles', actions: ['read', 'write', 'assign'] },
			{ domain: 'currency', actions: ['read'] },
			{ domain: 'deposits', actions: ['view', 'manage'] },
			{ domain: 'payments', actions: ['view', 'manage', 'write'] },
			{ domain: 'agents', actions: ['view', 'read', 'write', 'manage'] },
			{ domain: 'credit', actions: ['read', 'write'] },
		]
	}
	
	// First filter by permissions
	let filtered = filterNavigationByPermissions(navigation, userPermissions, userRoles)

	// CRITICAL: Apply Super Admin mode filtering (only for Super Admin)
	if (isSuperAdmin && directorMode) {
		// Filter sections by mode
		const modeFiltered: Record<string, NavigationSection> = {}
		for (const [key, section] of Object.entries(filtered)) {
			// Special handling for overview (isSpecial item)
			if ('isSpecial' in section && section.isSpecial) {
				// Dashboard shows in both modes
				const showInCore = ('showInCoreMode' in section && section.showInCoreMode !== false) || !('showInCoreMode' in section)
				const showInWhitelabel = ('showInWhitelabelMode' in section && section.showInWhitelabelMode !== false) || !('showInWhitelabelMode' in section)
				if ((directorMode === 'core' && showInCore) || (directorMode === 'whitelabel' && showInWhitelabel)) {
					modeFiltered[key] = section
				}
				continue
			}
			
			// Check if section should be shown in current mode
			if ('showInCoreMode' in section || 'showInWhitelabelMode' in section) {
				const showInCore = ('showInCoreMode' in section && (section as any).showInCoreMode !== false) || !('showInCoreMode' in section) // Default true if not specified
				const showInWhitelabel = ('showInWhitelabelMode' in section && (section as any).showInWhitelabelMode !== false) || !('showInWhitelabelMode' in section) // Default true if not specified
				
				if (directorMode === 'core' && showInCore) {
					// Filter items within section
					if ('items' in section) {
						const filteredItems = (section.items as any[]).filter((item: any) => {
							const itemShowInCore = ('showInCoreMode' in item && (item as any).showInCoreMode !== false) || !('showInCoreMode' in item)
							return itemShowInCore
						})
						// Also filter children in core mode
						const itemsWithFilteredChildren = filteredItems.map((item: any) => {
							if (item.children) {
								const filteredChildren = (item.children as any[]).filter((child: any) => {
									const childShowInCore = ('showInCoreMode' in child && (child as any).showInCoreMode !== false) || !('showInCoreMode' in child)
									return childShowInCore
								})
								return { ...item, children: filteredChildren }
							}
							return item
						})
						if (itemsWithFilteredChildren.length > 0) {
							modeFiltered[key] = { ...section, items: itemsWithFilteredChildren }
						}
					} else {
						modeFiltered[key] = section
					}
				} else if (directorMode === 'whitelabel' && showInWhitelabel) {
					// Filter items within section
					if ('items' in section) {
						// For Super Admin in whitelabel mode, get original items from navigation (before permission filtering)
						// This ensures items with hideForRoles that include Super Admin are still visible in whitelabel mode
						const originalSection = navigation[key]
						const itemsToFilter = ('items' in originalSection) ? (originalSection.items as any[]) : (section.items as any[])
						
						const filteredItems = itemsToFilter.filter((item: any) => {
							const itemShowInWhitelabel = ('showInWhitelabelMode' in item && (item as any).showInWhitelabelMode !== false) || !('showInWhitelabelMode' in item)
							return itemShowInWhitelabel
						})
						// Also filter children
						const itemsWithFilteredChildren = filteredItems.map((item: any) => {
							if (item.children) {
								const filteredChildren = (item.children as any[]).filter((child: any) => {
									const childShowInWhitelabel = ('showInWhitelabelMode' in child && (child as any).showInWhitelabelMode !== false) || !('showInWhitelabelMode' in child)
									return childShowInWhitelabel
								})
								return { ...item, children: filteredChildren }
							}
							return item
						})
						if (itemsWithFilteredChildren.length > 0) {
							modeFiltered[key] = { ...section, items: itemsWithFilteredChildren }
						}
					} else {
						modeFiltered[key] = section
					}
				}
			} else {
				// Section doesn't have mode properties - show in both modes (e.g., Dashboard)
				modeFiltered[key] = section
			}
		}
		filtered = modeFiltered
	}

	// CRITICAL: Only apply fallback logic if mode filtering didn't run
	// If mode filtering ran, it already handled the section visibility
	const modeFilteringRan = isSuperAdmin && directorMode !== null

	// Export Center: only show in whitelabel context (Whitelabel Admin or Super Admin in Whitelabel View)
	if (!shouldApplyWhitelabelAdminFiltering && filtered.reporting && 'items' in filtered.reporting) {
		const reportingItems = (filtered.reporting.items as any[]).filter((item: any) => item.key !== 'exports')
		if (reportingItems.length > 0) {
			filtered.reporting = { ...filtered.reporting, items: reportingItems }
		} else {
			delete filtered.reporting
		}
	}
	
	// Ensure System & Security section is visible if Security or Configuration items are visible
	// This handles cases where section might be filtered out but items should be visible
	// BUT: Skip if mode filtering already ran (it handles visibility based on mode)
	if (!modeFilteringRan && !filtered.system && navigation.system && 'items' in navigation.system) {
		const systemItems = filterNavItemsByPermissions(navigation.system.items, userPermissions, userRoles)
		if (systemItems.length > 0) {
			filtered.system = {
				...navigation.system,
				items: systemItems,
			}
		}
	}

	if (shouldApplyWhitelabelAdminFiltering && !modeFilteringRan) {
		// Ensure System & Security section exists
		// BUT: Skip if mode filtering already ran (it handles visibility based on mode)
		if (!filtered.system && navigation.system && 'items' in navigation.system) {
			const systemItems = filterNavItemsByPermissions(navigation.system.items, userPermissions, userRoles)
			if (systemItems.length > 0) {
				filtered.system = {
					...navigation.system,
					items: systemItems,
				}
			}
		}
		
		// Ensure Security item is visible for Whitelabel Admin (they have roles:read permission)
		if (filtered.system && 'items' in filtered.system) {
			const securityItemIndex = filtered.system.items.findIndex(item => item.key === 'security')
			const hasSecurityItem = securityItemIndex !== -1
			
			// Get original Security item from navigation
			const originalSecurityItem = navigation.system && 'items' in navigation.system 
				? navigation.system.items.find(item => item.key === 'security')
				: null
			
			if (originalSecurityItem) {
				// For Whitelabel Admin, always include both children (Roles Management and Support Admins)
				// Both require roles:read which Whitelabel Admin has
				// Explicitly include both children without filtering
				const allSecurityChildren = [
					{ to: "/security/roles", icon: "fa-solid fa-users-gear", label: "Roles Management", keywords: ["roles", "create", "edit"] },
					{ to: "/security/support-admins", icon: "fa-solid fa-headset", label: "Support Admins", permissions: { domain: "roles", actions: ["read"] }, keywords: ["admins", "support", "assign"] }
				]
				
				if (hasSecurityItem) {
					// Update existing Security item to include all children
					filtered.system.items[securityItemIndex] = {
						...filtered.system.items[securityItemIndex],
						children: allSecurityChildren, // Include all children for Whitelabel Admin
					}
				} else {
					// Add Security item with all children
					filtered.system.items.push({
						...originalSecurityItem,
						children: allSecurityChildren,
					})
				}
			}
		} else if (!filtered.system && navigation.system && 'items' in navigation.system) {
			// If system section doesn't exist, create it with Security item
			const originalSecurityItem = navigation.system.items.find(item => item.key === 'security')
			if (originalSecurityItem) {
				// Explicitly include both children for Whitelabel Admin
				const allSecurityChildren = [
					{ to: "/security/roles", icon: "fa-solid fa-users-gear", label: "Roles Management", keywords: ["roles", "create", "edit"] },
					{ to: "/security/support-admins", icon: "fa-solid fa-headset", label: "Support Admins", permissions: { domain: "roles", actions: ["read"] }, keywords: ["admins", "support", "assign"] }
				]
				filtered.system = {
					...navigation.system,
					items: [{
						...originalSecurityItem,
						children: allSecurityChildren,
					}],
				}
			}
		}
		
		// Ensure Finance section exists for all admins (including Whitelabel Admin)
		// This ensures both Payments and Settlements are visible
		if (navigation.finance && 'items' in navigation.finance) {
			// Get current finance items (if Finance section already exists) or filter from original
			let financeItems = filtered.finance && 'items' in filtered.finance 
				? [...filtered.finance.items] 
				: filterNavItemsByPermissions(navigation.finance.items, userPermissions, userRoles)
			
			// Find settlements item from original navigation
			const settlementsItem = navigation.finance.items.find(item => item.key === 'settlements')
			// Always include settlements item if it exists (for all admins including Whitelabel)
			if (settlementsItem && !financeItems.some(item => item.key === 'settlements')) {
				financeItems.push(settlementsItem)
			}
			
			// Always ensure Finance section exists if it has any items
			if (financeItems.length > 0 || settlementsItem) {
				filtered.finance = {
					...navigation.finance,
					items: financeItems.length > 0 ? financeItems : settlementsItem ? [settlementsItem] : [],
				}
			}
		}

		// Filter out Whitelabels menu and App Configuration from system configuration
		// For Whitelabel Admin, only show "Whitelabel Configuration" and "Advertisements"
		if (filtered.system && 'items' in filtered.system) {
			filtered = {
				...filtered,
				system: {
					...filtered.system,
					items: filtered.system.items
						.map(item => {
							if (item.key === 'configuration') {
								// Filter children: remove Whitelabels, OTP Providers, Currency Management
								// Keep App Configuration and Advertisements for Whitelabel Admin
								const filteredChildren = item.children?.filter(child => {
									// Remove Whitelabels menu
									if (child.to.includes('whitelabels')) return false
									// Remove OTP Providers, Currency Management
									if (child.to.includes('otp-providers') || child.to === '/currency') return false
									return true
								})
								// Don't include item if no children left
								if (!filteredChildren || filteredChildren.length === 0) return null
								return {
									...item,
									children: filteredChildren
								}
							}
							return item
						})
						.filter((item): item is NavItem => item !== null)
				}
			}
		}

		// Ensure Agents menu is visible for Whitelabel Admin (they should be able to manage agents)
		// Get the original Agents item from navigationData if it was filtered out
		if (filtered.trading && 'items' in filtered.trading) {
			const hasAgentsItem = filtered.trading.items.some(item => item.key === 'agents')
			if (!hasAgentsItem && navigation.trading && 'items' in navigation.trading) {
				// Find the original Agents item from navigationData
				const originalAgentsItem = navigation.trading.items.find(item => item.key === 'agents')
				if (originalAgentsItem) {
					// Add Agents item back for whitelabel admin, but remove Hierarchy (agent-only)
					const agentsItemWithoutHierarchy = {
						...originalAgentsItem,
						children: originalAgentsItem.children?.filter(child => !child.to.includes('/hierarchy'))
					}
					filtered.trading.items.push(agentsItemWithoutHierarchy)
				}
			} else if (hasAgentsItem) {
				// If Agents item already exists, remove Hierarchy from children for whitelabel admin
				filtered.trading.items = filtered.trading.items.map(item => {
					if (item.key === 'agents' && item.children) {
						return {
							...item,
							children: item.children.filter(child => !child.to.includes('/hierarchy'))
						}
					}
					return item
				})
			}
		}
	}

	// Then sort by role priority
	const primaryRole = getPrimaryRole(userRoles)
	const sorted = sortNavigationByRole(filtered, primaryRole)

	return sorted
}

