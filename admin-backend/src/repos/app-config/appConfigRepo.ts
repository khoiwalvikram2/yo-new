import { db } from '@src/db/client.js'
import { appConfigs, type AnalyticsConfig, type DomainsConfig, type SmtpConfig, type SmsConfig, type WebhooksConfig, type ObservabilityConfig, type PwaConfig, type AdminUiNotificationsConfig, type WhitelabelTheme, type SportsGlobalConfig } from '@shared/db/schema.js'
import { eq } from 'drizzle-orm'
import type { PlayerTheme } from '@shared/theme/playerTheme.js'

export type AppConfigDbInput = {
	// appName removed - use whitelabels.name instead
	// The optional text settings take null to clear them (undefined keeps the stored value).
	supportEmail?: string | null
	supportPhone?: string | null
	whatsappSupportPhone?: string | null
	defaultLocale?: string
	timeZone?: string
	baseCurrency?: string
	domains?: DomainsConfig
	seoTitle?: string | null
	seoDescription?: string | null
	ogImageUrl?: string | null
	socialLinks?: Record<string, string | undefined>
	analytics?: AnalyticsConfig
	maintenance?: boolean
	maintenanceMessage?: string
	newsTicker?: string
	// features
	sportsEnabled?: boolean
	casinoEnabled?: boolean
	matkaEnabled?: boolean
	agentsEnabled?: boolean
	referralsEnabled?: boolean
	bonusesEnabled?: boolean
	registerEnabled?: boolean
	// payments & kyc
	depositMin?: string | number | null
	depositMax?: string | number | null
	withdrawalMin?: string | number | null
	withdrawalMax?: string | number | null
	depositFeePercent?: string | number | null
	withdrawalFeePercent?: string | number | null
	kycRequiredToWithdraw?: boolean
	roundingStrategy?: string
	upiPayoutsDisabled?: boolean
	bankPayoutsDisabled?: boolean
	hideAddUpi?: boolean
	hideAddBank?: boolean
	maxDailyWithdrawalRequests?: number | null
	// risk
	overallExposureCap?: string | number | null
	dailyStakeLimit?: string | number | null
	weeklyStakeLimit?: string | number | null
	cashoutEnabled?: boolean
	// notifications
	smtp?: SmtpConfig
	sms?: SmsConfig
	adminUiNotifications?: AdminUiNotificationsConfig
	// webhooks & observability & pwa
	webhooks?: WebhooksConfig
	observability?: ObservabilityConfig
	pwa?: PwaConfig
	// theme colors
	theme?: WhitelabelTheme
	// sports global configuration
	sportsGlobalConfig?: SportsGlobalConfig
	// user panel banners
	preLoginBannerUrl?: string | null
	postLoginBannerUrl?: string | null
	playerTheme?: PlayerTheme | null
}

function mergeJson<T extends Record<string, any> | undefined>(current: T, incoming?: Partial<T> | null): T {
	return { ...(current as any || {}), ...(incoming as any || {}) } as T
}

function deepMergeSportsGlobalConfig(current: any, incoming: any): any {
	if (!current && !incoming) return undefined
	if (!current) return incoming
	if (!incoming) return current
	
	const merged: any = { ...current }
	
	// Merge top-level fields
	if (incoming.oddsFormat !== undefined) merged.oddsFormat = incoming.oddsFormat
	if (incoming.showFancy !== undefined) merged.showFancy = incoming.showFancy
	if (incoming.showBookmaker !== undefined) merged.showBookmaker = incoming.showBookmaker
	if (incoming.showExchange !== undefined) merged.showExchange = incoming.showExchange
	
	// Deep merge nested objects - check if object exists (not undefined) to allow 0 values
	if (incoming.defaultCommission !== undefined) {
		merged.defaultCommission = { ...(current.defaultCommission || {}), ...incoming.defaultCommission }
	}
	if (incoming.defaultStakeLimits !== undefined) {
		merged.defaultStakeLimits = { ...(current.defaultStakeLimits || {}), ...incoming.defaultStakeLimits }
	}
	if (incoming.defaultBetDelays !== undefined) {
		merged.defaultBetDelays = { ...(current.defaultBetDelays || {}), ...incoming.defaultBetDelays }
	}
	if (incoming.defaultBetCooldowns !== undefined) {
		merged.defaultBetCooldowns = { ...(current.defaultBetCooldowns || {}), ...incoming.defaultBetCooldowns }
	}
	
	return merged
}

export async function getAppConfigDb(tenant: string) {
	const row = await db.query.appConfigs.findFirst({
		where: eq(appConfigs.whitelabelId, tenant),
	})
	if (row) return row
	// sensible defaults if not configured yet
	return {
		whitelabelId: tenant,
		maintenance: false,
		sportsEnabled: true,
		casinoEnabled: true,
		matkaEnabled: true,
		agentsEnabled: true,
		referralsEnabled: true,
		bonusesEnabled: true,
		registerEnabled: true,
		cashoutEnabled: true,
		upiPayoutsDisabled: false,
		bankPayoutsDisabled: false,
		hideAddUpi: false,
		hideAddBank: false,
		maxDailyWithdrawalRequests: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	} as any
}

export async function upsertAppConfigDb(tenant: string, input: AppConfigDbInput) {
	const existing = await db.query.appConfigs.findFirst({
		where: eq(appConfigs.whitelabelId, tenant),
	})

	if (!existing) {
		await db.insert(appConfigs).values({
			whitelabelId: tenant,
			// appName removed - use whitelabels.name instead
			supportEmail: input.supportEmail,
			supportPhone: input.supportPhone,
			whatsappSupportPhone: input.whatsappSupportPhone,
			defaultLocale: input.defaultLocale,
			timeZone: input.timeZone,
			baseCurrency: input.baseCurrency,
			// domains field removed - not in schema
			seoTitle: input.seoTitle,
			seoDescription: input.seoDescription,
			ogImageUrl: input.ogImageUrl,
			socialLinks: input.socialLinks as any,
			analytics: input.analytics,
			maintenance: input.maintenance ?? false,
			maintenanceMessage: input.maintenanceMessage,
			newsTicker: input.newsTicker ?? null,
			sportsEnabled: input.sportsEnabled ?? true,
			casinoEnabled: input.casinoEnabled ?? true,
			matkaEnabled: input.matkaEnabled ?? true,
			agentsEnabled: input.agentsEnabled ?? true,
			referralsEnabled: input.referralsEnabled ?? true,
			bonusesEnabled: input.bonusesEnabled ?? true,
			registerEnabled: input.registerEnabled ?? true,
			depositMin: (input.depositMin as any) ?? null,
			depositMax: (input.depositMax as any) ?? null,
			withdrawalMin: (input.withdrawalMin as any) ?? null,
			withdrawalMax: (input.withdrawalMax as any) ?? null,
			depositFeePercent: (input.depositFeePercent as any) ?? null,
			withdrawalFeePercent: (input.withdrawalFeePercent as any) ?? null,
			kycRequiredToWithdraw: input.kycRequiredToWithdraw ?? false,
			roundingStrategy: input.roundingStrategy,
			upiPayoutsDisabled: input.upiPayoutsDisabled ?? false,
			bankPayoutsDisabled: input.bankPayoutsDisabled ?? false,
			hideAddUpi: input.hideAddUpi ?? false,
			hideAddBank: input.hideAddBank ?? false,
			maxDailyWithdrawalRequests: input.maxDailyWithdrawalRequests ?? null,
			overallExposureCap: (input.overallExposureCap as any) ?? null,
			dailyStakeLimit: (input.dailyStakeLimit as any) ?? null,
			weeklyStakeLimit: (input.weeklyStakeLimit as any) ?? null,
			cashoutEnabled: input.cashoutEnabled ?? true,
			smtp: input.smtp,
			sms: input.sms,
			adminUiNotifications: input.adminUiNotifications,
			webhooks: input.webhooks,
			observability: input.observability,
			pwa: input.pwa,
			theme: input.theme,
			sportsGlobalConfig: input.sportsGlobalConfig,
			preLoginBannerUrl: input.preLoginBannerUrl ?? null,
			postLoginBannerUrl: input.postLoginBannerUrl ?? null,
			playerTheme: input.playerTheme ?? null,
		})
		return { success: true }
	}

	// Helper to preserve existing value if input is undefined, otherwise use input
	// Only include field if input is provided OR existing value exists (not undefined)
	const preserveOrUpdate = <T>(inputVal: T | undefined, existingVal: T | null | undefined): T | null | undefined => {
		if (inputVal !== undefined) return inputVal
		// Only preserve if existing value is defined (not undefined)
		// If both are undefined, return undefined so field is omitted from update
		return existingVal !== undefined ? existingVal : undefined
	}

	// deep-merge JSON blocks where appropriate
	const merged: any = {
		updatedAt: new Date(),
		// appName removed - use whitelabels.name instead
		supportEmail: preserveOrUpdate(input.supportEmail, existing.supportEmail),
		supportPhone: preserveOrUpdate(input.supportPhone, existing.supportPhone),
		whatsappSupportPhone: preserveOrUpdate(input.whatsappSupportPhone, existing.whatsappSupportPhone),
		defaultLocale: preserveOrUpdate(input.defaultLocale, existing.defaultLocale),
		timeZone: preserveOrUpdate(input.timeZone, existing.timeZone),
		baseCurrency: preserveOrUpdate(input.baseCurrency, existing.baseCurrency),
		seoTitle: preserveOrUpdate(input.seoTitle, existing.seoTitle),
		seoDescription: preserveOrUpdate(input.seoDescription, existing.seoDescription),
		ogImageUrl: preserveOrUpdate(input.ogImageUrl, existing.ogImageUrl),
		maintenance: preserveOrUpdate(input.maintenance, existing.maintenance),
		maintenanceMessage: preserveOrUpdate(input.maintenanceMessage, existing.maintenanceMessage),
		newsTicker: preserveOrUpdate(input.newsTicker, existing.newsTicker),
		sportsEnabled: preserveOrUpdate(input.sportsEnabled, existing.sportsEnabled),
		casinoEnabled: preserveOrUpdate(input.casinoEnabled, existing.casinoEnabled),
		matkaEnabled: preserveOrUpdate(input.matkaEnabled, existing.matkaEnabled),
		agentsEnabled: preserveOrUpdate(input.agentsEnabled, existing.agentsEnabled),
		referralsEnabled: preserveOrUpdate(input.referralsEnabled, existing.referralsEnabled),
		bonusesEnabled: preserveOrUpdate(input.bonusesEnabled, existing.bonusesEnabled),
		registerEnabled: preserveOrUpdate(input.registerEnabled, existing.registerEnabled),
		depositMin: preserveOrUpdate(input.depositMin, existing.depositMin),
		depositMax: preserveOrUpdate(input.depositMax, existing.depositMax),
		withdrawalMin: preserveOrUpdate(input.withdrawalMin, existing.withdrawalMin),
		withdrawalMax: preserveOrUpdate(input.withdrawalMax, existing.withdrawalMax),
		depositFeePercent: preserveOrUpdate(input.depositFeePercent, existing.depositFeePercent),
		withdrawalFeePercent: preserveOrUpdate(input.withdrawalFeePercent, existing.withdrawalFeePercent),
		kycRequiredToWithdraw: preserveOrUpdate(input.kycRequiredToWithdraw, existing.kycRequiredToWithdraw),
		roundingStrategy: preserveOrUpdate(input.roundingStrategy, existing.roundingStrategy),
		upiPayoutsDisabled: preserveOrUpdate(input.upiPayoutsDisabled, existing.upiPayoutsDisabled),
		bankPayoutsDisabled: preserveOrUpdate(input.bankPayoutsDisabled, existing.bankPayoutsDisabled),
		hideAddUpi: preserveOrUpdate(input.hideAddUpi, existing.hideAddUpi),
		hideAddBank: preserveOrUpdate(input.hideAddBank, existing.hideAddBank),
		maxDailyWithdrawalRequests: preserveOrUpdate(input.maxDailyWithdrawalRequests, existing.maxDailyWithdrawalRequests),
		overallExposureCap: preserveOrUpdate(input.overallExposureCap, existing.overallExposureCap),
		dailyStakeLimit: preserveOrUpdate(input.dailyStakeLimit, existing.dailyStakeLimit),
		weeklyStakeLimit: preserveOrUpdate(input.weeklyStakeLimit, existing.weeklyStakeLimit),
		cashoutEnabled: preserveOrUpdate(input.cashoutEnabled, existing.cashoutEnabled),
	}

	// Handle JSON fields with merging
	// domains field removed - not in schema

	if (input.socialLinks !== undefined) {
		merged.socialLinks = mergeJson(existing.socialLinks as any, input.socialLinks as any)
	} else if (existing.socialLinks !== undefined) {
		merged.socialLinks = existing.socialLinks
	}

	if (input.analytics !== undefined) {
		merged.analytics = mergeJson(existing.analytics as any, input.analytics as any)
	} else if (existing.analytics !== undefined) {
		merged.analytics = existing.analytics
	}

	if (input.smtp !== undefined) {
		merged.smtp = mergeJson(existing.smtp as any, input.smtp as any)
	} else if (existing.smtp !== undefined) {
		merged.smtp = existing.smtp
	}

	if (input.sms !== undefined) {
		merged.sms = mergeJson(existing.sms as any, input.sms as any)
	} else if (existing.sms !== undefined) {
		merged.sms = existing.sms
	}

	if (input.adminUiNotifications !== undefined) {
		merged.adminUiNotifications = mergeJson(existing.adminUiNotifications as any, input.adminUiNotifications as any)
	} else if (existing.adminUiNotifications !== undefined) {
		merged.adminUiNotifications = existing.adminUiNotifications
	}

	if (input.webhooks !== undefined) {
		merged.webhooks = mergeJson(existing.webhooks as any, input.webhooks as any)
	} else if (existing.webhooks !== undefined) {
		merged.webhooks = existing.webhooks
	}

	if (input.observability !== undefined) {
		merged.observability = mergeJson(existing.observability as any, input.observability as any)
	} else if (existing.observability !== undefined) {
		merged.observability = existing.observability
	}

	if (input.pwa !== undefined) {
		merged.pwa = mergeJson(existing.pwa as any, input.pwa as any)
	} else if (existing.pwa !== undefined) {
		merged.pwa = existing.pwa
	}

	if (input.theme !== undefined) {
		merged.theme = mergeJson(existing.theme as any, input.theme as any)
	} else if (existing.theme !== undefined) {
		merged.theme = existing.theme
	}

	if (input.sportsGlobalConfig !== undefined) {
		merged.sportsGlobalConfig = deepMergeSportsGlobalConfig(existing.sportsGlobalConfig as any, input.sportsGlobalConfig as any)
	} else if (existing.sportsGlobalConfig !== undefined) {
		merged.sportsGlobalConfig = existing.sportsGlobalConfig
	}

	merged.preLoginBannerUrl = preserveOrUpdate(input.preLoginBannerUrl, existing.preLoginBannerUrl)
	merged.postLoginBannerUrl = preserveOrUpdate(input.postLoginBannerUrl, existing.postLoginBannerUrl)
	// The player theme is replaced whole (null clears it); a deep merge would keep stale colours.
	if (input.playerTheme !== undefined) merged.playerTheme = input.playerTheme

	// Remove undefined values to avoid setting them to null/empty
	Object.keys(merged).forEach(key => {
		if (merged[key] === undefined) {
			delete merged[key]
		}
	})

	await db.update(appConfigs)
		.set(merged)
		.where(eq(appConfigs.whitelabelId, tenant))

	return { success: true }
}

