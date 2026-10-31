import jwt from 'jsonwebtoken'
import { getAppConfig } from '../../config/app.js'
import { db } from '../../db/client.js'

const config = getAppConfig()

export type AuthContext = {
  userId: number | null
  /** Tenant from JWT (user's login whitelabel). Use for user-scoped data (wallet, bets, profile). */
  tenant: string
  /** Tenant from request (Host / x-whitelabel header). Use for site-scoped data (app settings, ads, feature flags). */
  requestTenant: string
  rawToken?: string
  /** Set when a valid JWT was sent but token_version didn't match (force logout). */
  forceLoggedOut?: boolean
}

type TokenPayload = { sub?: string; userId?: number; tenant?: string; v?: number }

// Cache for domain to tenant mapping (refreshes every 5 minutes)
let domainTenantCache: Map<string, string> = new Map()
let cacheLastUpdated = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function refreshDomainCache() {
  const now = Date.now()
  if (now - cacheLastUpdated < CACHE_TTL && domainTenantCache.size > 0) {
    return
  }
  
  try {
    const newCache = new Map<string, string>()
    
    // Get all app configs using db.query pattern
    const configs = await db.query.appConfigs.findMany({
      columns: {
        whitelabelId: true,
      },
    })
    
    for (const cfg of configs) {
      if (!cfg.whitelabelId) continue
      
      // Parse domains - get from whitelabels table instead
      let domains: string[] = []
      const rawDomains = null as any
      
      if (Array.isArray(rawDomains)) {
        domains = rawDomains.filter(d => typeof d === 'string')
      } else if (typeof rawDomains === 'string') {
        try {
          const parsed = JSON.parse(rawDomains)
          domains = Array.isArray(parsed) ? parsed : [rawDomains]
        } catch {
          domains = [rawDomains]
        }
      } else if (rawDomains && typeof rawDomains === 'object') {
        domains = Object.values(rawDomains).filter(d => typeof d === 'string') as string[]
      }
      
      for (const domain of domains) {
        if (domain && typeof domain === 'string') {
          // Normalize domain (lowercase, remove port for matching)
          const normalized = domain.toLowerCase().trim().split(':')[0]
          newCache.set(normalized, cfg.whitelabelId)
          // Also store with port if present
          newCache.set(domain.toLowerCase().trim(), cfg.whitelabelId)
        }
      }
    }
    
    // Also get domain from whitelabels table as fallback
    const wls = await db.query.whitelabels.findMany({
      columns: {
        id: true,
        domain: true,
      },
    })
    
    for (const wl of wls) {
      if (wl.domain) {
        const normalized = wl.domain.toLowerCase().trim().split(':')[0]
        if (!newCache.has(normalized)) {
          newCache.set(normalized, wl.id)
        }
        if (!newCache.has(wl.domain.toLowerCase().trim())) {
          newCache.set(wl.domain.toLowerCase().trim(), wl.id)
        }
      }
      // Map whitelabel id to itself (so Host or x-whitelabel can be the id, e.g. "kondareddi")
      if (wl.id) {
        const idKey = wl.id.toLowerCase().trim()
        if (!newCache.has(idKey)) {
          newCache.set(idKey, wl.id)
        }
      }
    }
    
    domainTenantCache = newCache
    cacheLastUpdated = now
  } catch (error) {
  }
}

function getTenantFromHost(host: string): string | null {
  if (!host) return null
  
  const normalized = host.toLowerCase().trim()
  const withoutPort = normalized.split(':')[0]
  
  // Try exact match first
  if (domainTenantCache.has(normalized)) {
    return domainTenantCache.get(normalized)!
  }
  
  // Try without port
  if (domainTenantCache.has(withoutPort)) {
    return domainTenantCache.get(withoutPort)!
  }
  
  // Try subdomain matching (e.g., play.white-com.com should match white-com.com)
  for (const [domain, tenant] of domainTenantCache.entries()) {
    if (withoutPort.endsWith('.' + domain) || withoutPort === domain) {
      return tenant
    }
  }
  
  return null
}

/** Extract hostname from a URL string (e.g. Referer). Returns empty if invalid. */
function hostFromUrl(url: string): string {
  if (!url || typeof url !== 'string') return ''
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    return parsed.hostname || ''
  } catch {
    return ''
  }
}

/** Resolve tenant from request only (headers / Host). Never from JWT. Use for site-scoped data. */
function getRequestTenant(request: any, host: string, whitelabelHeader: string | undefined): string {
  if (whitelabelHeader && typeof whitelabelHeader === 'string') {
    const headerTenant = getTenantFromHost(whitelabelHeader.trim())
    if (headerTenant) return headerTenant
    const headerValue = whitelabelHeader.trim()
    if (!headerValue.includes('.') && !headerValue.includes(':')) return headerValue
  }
  if (host) {
    const hostTenant = getTenantFromHost(host)
    if (hostTenant) return hostTenant
  }
  return 'default'
}

/** Collect host string from request using all common headers (handles proxies that strip Host). */
function getHostFromRequest(request: any): string {
  const headers = request?.headers
  if (!headers) return ''
  const hostVal = headers['host'] || headers['x-forwarded-host']
  if (hostVal) {
    const first = Array.isArray(hostVal) ? hostVal[0] : hostVal
    if (typeof first === 'string' && first.trim()) return first.trim().split('/')[0].split(',')[0].trim()
  }
  const origin = headers['origin']
  if (origin && typeof origin === 'string') {
    const o = origin.trim().replace(/^https?:\/\//, '').split('/')[0]
    if (o) return o
  }
  const referer = headers['referer'] || headers['referrer']
  if (referer && typeof referer === 'string') {
    const h = hostFromUrl(referer.trim())
    if (h) return h
  }
  return ''
}

/** Safely get a single string value from a header (may be string or array). */
function headerString(headers: any, key: string): string {
  const v = headers?.[key]
  if (!v) return ''
  const first = Array.isArray(v) ? v[0] : v
  return typeof first === 'string' ? first.trim() : ''
}

export async function buildAuthContext(request: any): Promise<AuthContext> {
  // Refresh cache if needed
  await refreshDomainCache()
  
  const headers = request?.headers ?? {}
  const whitelabelHeader = headerString(headers, 'x-whitelabel') || headerString(headers, 'x-whitelabel-id') || headerString(headers, 'x-tenant')
  const hostFromHeader = headerString(headers, 'host') || (headerString(headers, 'origin') || '').replace(/^https?:\/\//, '').split('/')[0] || ''
  const host = hostFromHeader || getHostFromRequest(request)
  const requestTenant = getRequestTenant(request, host, whitelabelHeader || undefined)
  
  const authHeader = request?.headers?.authorization || ''
  let tokenTenant: string | null = null
  let userId: number | null = null
  let rawToken: string | undefined
  
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length)
    rawToken = token
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as TokenPayload
      const id = decoded.userId ?? (decoded.sub ? Number(decoded.sub) : null)
      const decodedUserId = Number.isFinite(id) ? Number(id) : null
      const decodedTenant = decoded.tenant || null
      if (decodedUserId != null) {
        const { getTokenVersion, getTokenVersionById } = await import('../../repos/userRepo.js')
        const currentVersion = decodedTenant
          ? await getTokenVersion(decodedUserId, decodedTenant)
          : await getTokenVersionById(decodedUserId)
        const tokenVersion = Number(decoded.v ?? 0)
        if (currentVersion == null || tokenVersion !== currentVersion) {
          return { userId: null, tenant: decodedTenant || 'default', requestTenant, rawToken, forceLoggedOut: true }
        } else {
          userId = decodedUserId
          tokenTenant = decodedTenant
        }
      } else {
        userId = decodedUserId
        tokenTenant = decodedTenant
      }
    } catch (_) {
      userId = null
      tokenTenant = null
    }
  }
  
  // Reject JWT from another whitelabel: if token was issued for site A but request is for site B, treat as not logged in on B
  if (userId != null && tokenTenant && requestTenant && tokenTenant !== 'default' && requestTenant !== 'default' && tokenTenant !== requestTenant) {
    userId = null
  }

  // User tenant: from JWT when authenticated, else from request (so unauthenticated gets request tenant)
  const tenant = tokenTenant ?? requestTenant

  return { userId, tenant, requestTenant, rawToken }
}

export function requireAuth(ctx: AuthContext) {
  if (!ctx.userId) {
    throw new Error('Unauthorized')
  }
}

