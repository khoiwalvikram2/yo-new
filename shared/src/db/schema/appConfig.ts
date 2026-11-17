import type { PlayerTheme } from '../../theme/playerTheme.js'
import { pgTable, varchar, timestamp, jsonb, boolean, numeric, integer, text } from 'drizzle-orm/pg-core'

export type SocialLinks = {
	twitter?: string
	facebook?: string
	instagram?: string
	youtube?: string
	tiktok?: string
	linkedin?: string
	telegram?: string
}

export type AnalyticsConfig = {
	gtmId?: string
	ga4Id?: string
	metaPixelId?: string
	mixpanelId?: string
	amplitudeApiKey?: string
}

export type DomainsConfig = {
	cdnBaseUrl?: string
	assetBasePath?: string
	canonicalBaseUrl?: string
	sitemapBaseUrl?: string
	robotsTxt?: string
	robotsEnabled?: boolean
}

export type SmtpConfig = {
	host?: string
	port?: number
	username?: string
	passwordEnc?: string
	fromEmail?: string
	alertRecipients?: string[]
}

export type SmsConfig = {
	provider?: string
	apiKeyEnc?: string
	senderId?: string
}

export type WebhooksConfig = {
	endpointUrl?: string
	secretEnc?: string
	events?: string[]
}

export type ObservabilityConfig = {
	sentryDsn?: string
	logLevel?: string
	metricsEnabled?: boolean
}

export type PwaConfig = {
	shortName?: string
	themeColor?: string
	backgroundColor?: string
}

export type AdminUiNotificationsConfig = {
	enabled?: boolean
	placement?: string
	durationMs?: number
	showSuccess?: boolean
	showError?: boolean
	showInfo?: boolean
	showWarning?: boolean
	muteCategories?: string[]
	soundEnabled?: boolean
}

export type WhitelabelTheme = {
	// Action colors (shared for both themes)
	primary: string
	success: string
	warning: string
	danger: string
	// Dark theme colors
	dark?: {
		bgPage: string
		textPrimary: string
		textSecondary: string
		border: string
	}
	// Light theme colors
	light?: {
		bgPage: string
		textPrimary: string
		textSecondary: string
		border: string
	}
	// Legacy support - if dark/light not provided, use these
	bgPage?: string
	textPrimary?: string
	textSecondary?: string
	border?: string
}

export type DefaultCommission = {
	exchange?: number
	bookmaker?: number
	fancy?: number
}

export type DefaultStakeLimits = {
	exchangeMin?: number
	exchangeMax?: number
	bookmakerMin?: number
	bookmakerMax?: number
	fancyMin?: number
	fancyMax?: number
}

export type DefaultBetDelays = {
	exchange?: number
	bookmaker?: number
	fancy?: number
}

export type DefaultBetCooldowns = {
	exchange?: number
	bookmaker?: number
	fancy?: number
}

export type SportsGlobalConfig = {
	oddsFormat?: 'decimal' | 'fractional' | 'american'
	showFancy?: boolean
	showBookmaker?: boolean
	showExchange?: boolean
	defaultCommission?: DefaultCommission
	defaultStakeLimits?: DefaultStakeLimits
	defaultBetDelays?: DefaultBetDelays
	defaultBetCooldowns?: DefaultBetCooldowns
}

export const appConfigs = pgTable('app_configs', {
	// strictly per whitelabel (tenant)
	whitelabelId: varchar('whitelabel_id', { length: 64 }).primaryKey(),

	// identity / locale / currency (name & domain come from whitelabels table)
	supportEmail: varchar('support_email', { length: 160 }),
	supportPhone: varchar('support_phone', { length: 64 }),
	whatsappSupportPhone: varchar('whatsapp_support_phone', { length: 64 }),
	defaultLocale: varchar('default_locale', { length: 16 }),
	timeZone: varchar('time_zone', { length: 64 }),
	baseCurrency: varchar('base_currency', { length: 16 }),

	// seo & social
	seoTitle: varchar('seo_title', { length: 180 }),
	seoDescription: varchar('seo_description', { length: 512 }),
	ogImageUrl: varchar('og_image_url', { length: 2048 }),
	socialLinks: jsonb('social_links').$type<SocialLinks>(),

	// analytics
	analytics: jsonb('analytics').$type<AnalyticsConfig>(),

	// maintenance
	maintenance: boolean('maintenance').notNull().default(false),
	maintenanceMessage: varchar('maintenance_message', { length: 512 }),

	// news ticker (scrolling text in user panel header)
	newsTicker: varchar('news_ticker', { length: 1024 }),

	// feature toggles
	sportsEnabled: boolean('sports_enabled').notNull().default(true),
	casinoEnabled: boolean('casino_enabled').notNull().default(true),
	matkaEnabled: boolean('matka_enabled').notNull().default(true),
	agentsEnabled: boolean('agents_enabled').notNull().default(true),
	referralsEnabled: boolean('referrals_enabled').notNull().default(true),
	bonusesEnabled: boolean('bonuses_enabled').notNull().default(true),
	registerEnabled: boolean('register_enabled').notNull().default(true),

	// payments & kyc
	depositMin: numeric('deposit_min', { precision: 18, scale: 6 }),
	depositMax: numeric('deposit_max', { precision: 18, scale: 6 }),
	withdrawalMin: numeric('withdrawal_min', { precision: 18, scale: 6 }),
	withdrawalMax: numeric('withdrawal_max', { precision: 18, scale: 6 }),
	depositFeePercent: numeric('deposit_fee_percent', { precision: 9, scale: 6 }),
	withdrawalFeePercent: numeric('withdrawal_fee_percent', { precision: 9, scale: 6 }),
	kycRequiredToWithdraw: boolean('kyc_required_to_withdraw').default(false),
	roundingStrategy: varchar('rounding_strategy', { length: 32 }),
	// user withdrawal payout method controls (whitelabel)
	upiPayoutsDisabled: boolean('upi_payouts_disabled').notNull().default(false),
	bankPayoutsDisabled: boolean('bank_payouts_disabled').notNull().default(false),
	hideAddUpi: boolean('hide_add_upi').notNull().default(false),
	hideAddBank: boolean('hide_add_bank').notNull().default(false),
	/** Max withdrawal requests per user per calendar day (whitelabel timezone); null = unlimited */
	maxDailyWithdrawalRequests: integer('max_daily_withdrawal_requests'),

	// risk defaults
	overallExposureCap: numeric('overall_exposure_cap', { precision: 18, scale: 6 }),
	dailyStakeLimit: numeric('daily_stake_limit', { precision: 18, scale: 6 }),
	weeklyStakeLimit: numeric('weekly_stake_limit', { precision: 18, scale: 6 }),
	cashoutEnabled: boolean('cashout_enabled').default(true),

	// notifications
	smtp: jsonb('smtp').$type<SmtpConfig>(),
	sms: jsonb('sms').$type<SmsConfig>(),
	adminUiNotifications: jsonb('admin_ui_notifications').$type<AdminUiNotificationsConfig>(),

	// webhooks & observability
	webhooks: jsonb('webhooks').$type<WebhooksConfig>(),
	observability: jsonb('observability').$type<ObservabilityConfig>(),

	// pwa
	pwa: jsonb('pwa').$type<PwaConfig>(),

	// theme colors
	theme: jsonb('theme').$type<WhitelabelTheme>(),

	// player panel theme (presets, key colours, sport icon style); null = the Matchbook default
	playerTheme: jsonb('player_theme').$type<PlayerTheme>(),

	// Currency Management page's currency list (migration 0020); used only on the platform row, through
	// admin-backend/src/services/currencyStore.ts. null until the first change.
	currencies: jsonb('currencies').$type<Record<string, unknown>>(),

	// sports global configuration
	sportsGlobalConfig: jsonb('sports_global_config').$type<SportsGlobalConfig>(),

	// user panel banner images (base64 data URIs)
	preLoginBannerUrl: text('pre_login_banner_url'),
	postLoginBannerUrl: text('post_login_banner_url'),

	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

