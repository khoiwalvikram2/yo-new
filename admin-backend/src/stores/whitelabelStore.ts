import { displayableAsset } from '@shared/utils/dataUri.js'

export type WhitelabelTheme = {
  primary: string
  success: string
  warning: string
  danger: string
  bgPage: string
  textPrimary: string
  textSecondary: string
  border: string
}

export type Whitelabel = {
  id: string
  name: string
  domain: string
  logoUrl?: string
  faviconUrl?: string
  theme?: WhitelabelTheme // Optional - fetched from app_config
}

// Default theme in case DB missing
const defaultTheme: WhitelabelTheme = {
  primary: '#2952E3',
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
  bgPage: '#ffffff',
  textPrimary: '#111827',
  textSecondary: '#6b7280',
  border: '#e5e7eb',
}

// Fallback label if DB empty
const fallback: Whitelabel = {
  id: 'default',
  name: 'Default',
  domain: 'localhost',
  logoUrl: null as any,
  faviconUrl: null as any,
  theme: defaultTheme, // Keep for backward compatibility
}

// Logos and favicons are read with displayableAsset: as stored (a data URI, or a link), and a legacy S3 key as
// null, since S3 is gone (owner decision 2026-11-04) and nothing can fetch it.

export async function listWhitelabels(): Promise<Whitelabel[]> {
  const { listWhitelabelsDb } = await import('../repos/common/whitelabelRepo.js')
  try {
    const rows = await listWhitelabelsDb()
    if (!rows?.length) return [fallback]
    
    // Logos and favicons as a page can show them
    const rowsWithUrls = await Promise.all(rows.map(async (row: any) => ({
      ...row,
      logoUrl: displayableAsset(row.logoUrl),
      faviconUrl: displayableAsset(row.faviconUrl),
    })))
    
    return rowsWithUrls
  } catch {
    return [fallback]
  }
}

export async function findWhitelabelByHost(host?: string | null): Promise<Whitelabel | null> {
  if (!host) return null
  
  // Normalize host
  const hostLower = host.toLowerCase().trim()
  const hostname = hostLower.split(':')[0] // hostname without port
  
  const { listWhitelabelsDb } = await import('../repos/common/whitelabelRepo.js')
  try {
    const rows = await listWhitelabelsDb()
    
    // Try exact match first (with or without port)
    let match = rows.find((l) => {
      const domain = String(l.domain || '').toLowerCase().trim()
      // Exact match (with or without port)
      if (hostLower === domain) return true
      // Match hostname to domain (ignoring port)
      const domainHostname = domain.split(':')[0]
      return hostname === domainHostname
    })
    
    // If no exact match, try hostname endsWith match (for subdomains)
    if (!match) {
      match = rows.find((l) => {
        const domain = String(l.domain || '').toLowerCase().trim()
        const domainHostname = domain.split(':')[0]
        // Check if hostname ends with domain or domain ends with hostname
        return hostname.endsWith(domainHostname) || domainHostname.endsWith(hostname)
      })
    }
    
    if (!match) return null
    
    // Logo and favicon as a page can show them
    return {
      ...match,
      logoUrl: displayableAsset((match as any).logoUrl),
      faviconUrl: displayableAsset((match as any).faviconUrl),
    } as any
  } catch {
    return null
  }
}

export async function getCurrentWhitelabel(ctx?: any): Promise<Whitelabel> {
  const hdr = ctx?.request?.headers
  
  // PRIORITY 1: Check for explicit whitelabel ID header (most reliable for admin panel)
  // This is sent by frontend when it knows the whitelabel ID
  // Check multiple header name variations (case-insensitive)
  const whitelabelIdHeader = hdr?.['x-whitelabel-id'] || 
                             hdr?.['X-Whitelabel-ID'] || 
                             hdr?.['x-whitelabel'] || 
                             hdr?.['X-Whitelabel'] ||
                             hdr?.['X-WHITELABEL-ID'] ||
                             hdr?.['X-WHITELABEL']
  
  if (whitelabelIdHeader) {
    const wlId = typeof whitelabelIdHeader === 'string' ? whitelabelIdHeader.trim() : Array.isArray(whitelabelIdHeader) ? whitelabelIdHeader[0]?.trim() : undefined
    
    // CRITICAL: If explicit header is 'default', return the default fallback immediately
    // This prevents falling through to Host header matching (which could return wrong whitelabel)
    if (wlId === 'default') {
      return fallback
    }
    
    if (wlId && wlId !== '') {
      try {
        const { getWhitelabelById } = await import('../repos/common/whitelabelRepo.js')
        const wl = await getWhitelabelById(wlId)
        if (wl) {
          return {
            ...wl,
            logoUrl: displayableAsset(wl.logoUrl),
            faviconUrl: displayableAsset(wl.faviconUrl),
          } as any
        } else {
        }
      } catch (err) {
      }
    }
  }
  
  // PRIORITY 2: Resolve whitelabel by host. For cross-origin admin panel requests,
  // Host is the API host (e.g. admin-api.grandwinn.com), not the page host.
  // Use X-Forwarded-Host, then Origin, then Referer, then Host. (Fastify lowercases header names.)
  const candidates: string[] = []
  const xfh = hdr?.['x-forwarded-host']
  if (xfh) {
    const v = typeof xfh === 'string' ? xfh : Array.isArray(xfh) ? xfh[0] : undefined
    if (v?.trim()) candidates.push(v.trim())
  }
  const origin = hdr?.origin
  if (origin) {
    try {
      const u = new URL(typeof origin === 'string' ? origin : origin[0])
      if (u.hostname) candidates.push(u.hostname)
    } catch {}
  }
  const referer = hdr?.referer
  if (referer) {
    try {
      const u = new URL(typeof referer === 'string' ? referer : referer[0])
      if (u.hostname) candidates.push(u.hostname)
    } catch {}
  }
  const hostHeader = hdr?.host
  if (hostHeader) {
    const v = typeof hostHeader === 'string' ? hostHeader : Array.isArray(hostHeader) ? hostHeader[0] : undefined
    if (v?.trim()) candidates.push(v.trim())
  }
  const seen = new Set<string>()
  for (const val of candidates) {
    const key = val.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const wl = await findWhitelabelByHost(val)
    if (wl) return wl
  }

  // FALLBACK: Return default
  return fallback
}

