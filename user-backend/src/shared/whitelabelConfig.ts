import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { appConfigs } from '@shared/db/schema.js'

const CACHE_TTL_MS = 60 * 1000 // 60 seconds

interface CachedConfig {
	baseCurrency: string
	timeZone: string
	timestamp: number
}

const cache = new Map<string, CachedConfig>()

const CURRENCY_TIMEZONE_MAPPING: Record<string, string> = {
	INR: 'Asia/Kolkata',
	USD: 'America/New_York',
	EUR: 'Europe/Berlin',
	GBP: 'Europe/London',
	JPY: 'Asia/Tokyo',
	AUD: 'Australia/Sydney',
	CAD: 'America/Toronto',
	CHF: 'Europe/Zurich',
	CNY: 'Asia/Shanghai',
	AED: 'Asia/Dubai',
	BTC: 'UTC',
}

const CURRENCY_SYMBOL_MAPPING: Record<string, string> = {
	INR: '₹',
	USD: '$',
	EUR: '€',
	GBP: '£',
	JPY: '¥',
	AUD: 'A$',
	CAD: 'C$',
	CHF: 'CHF',
	CNY: '¥',
	AED: 'د.إ',
	BTC: '₿',
}

function getCached(tenant: string): CachedConfig | null {
	const entry = cache.get(tenant)
	if (!entry) return null
	if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
		cache.delete(tenant)
		return null
	}
	return entry
}

async function getOrFetchConfig(tenant: string): Promise<CachedConfig> {
	const cached = getCached(tenant)
	if (cached) return cached

	const row = await db.query.appConfigs.findFirst({
		where: eq(appConfigs.whitelabelId, tenant),
	})
	const baseCurrency = row?.baseCurrency || 'INR'
	const timeZone = row?.timeZone || CURRENCY_TIMEZONE_MAPPING[baseCurrency] || 'UTC'
	const entry: CachedConfig = { baseCurrency, timeZone, timestamp: Date.now() }
	cache.set(tenant, entry)
	return entry
}

/**
 * Get whitelabel base currency from app_configs with 60s cache.
 */
export async function getWhitelabelCurrency(tenant: string): Promise<string> {
	try {
		const config = await getOrFetchConfig(tenant)
		return config.baseCurrency
	} catch (error) {
		return 'INR'
	}
}

/**
 * Get whitelabel timezone from app_configs or fallback to currency-based mapping. Uses 60s cache.
 */
export async function getWhitelabelTimezone(tenant: string): Promise<string> {
	try {
		const config = await getOrFetchConfig(tenant)
		return config.timeZone
	} catch (error) {
		return 'UTC'
	}
}

/**
 * Get currency symbol for backend error messages / display.
 */
export function getCurrencySymbol(currencyCode: string): string {
	return CURRENCY_SYMBOL_MAPPING[currencyCode] ?? currencyCode
}
