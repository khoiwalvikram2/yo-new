/**
 * Get client IP from request, preferring proxy headers so we don't record 127.0.0.1
 * when the app runs behind nginx, load balancer, or similar.
 *
 * Order: X-Forwarded-For (first IP = client) → X-Real-IP → CF-Connecting-IP → request.ip → socket.remoteAddress
 */
export function getClientIp(request: any): string | undefined {
  if (!request) return undefined
  const headers = request.headers || {}
  const h = (key: string) => {
    const v = headers[key.toLowerCase?.() ?? key] ?? headers[key]
    if (typeof v === 'string') return v.trim()
    if (Array.isArray(v) && v[0] != null) return String(v[0]).trim()
    return undefined
  }
  const forwarded = h('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = h('x-real-ip')
  if (realIp) return realIp
  const cfIp = h('cf-connecting-ip')
  if (cfIp) return cfIp
  if (request.ip) return String(request.ip).trim()
  const socket = request.raw?.socket ?? request.socket
  const remote = socket?.remoteAddress
  if (remote) return typeof remote === 'string' ? remote.trim() : String(remote)
  return undefined
}

/**
 * Get client User-Agent for audit/logging. Prefers X-Client-User-Agent (sent by
 * frontend so it survives proxies that overwrite User-Agent), then User-Agent.
 */
export function getClientUserAgent(request: any): string | undefined {
  if (!request) return undefined
  const headers = request.headers || {}
  const h = (key: string) => {
    const v = headers[key.toLowerCase?.() ?? key] ?? headers[key]
    if (typeof v === 'string') return v.trim()
    if (Array.isArray(v) && v[0] != null) return String(v[0]).trim()
    return undefined
  }
  const clientUa = h('x-client-user-agent')
  if (clientUa) return clientUa
  const ua = h('user-agent')
  return ua || undefined
}

/**
 * Extract additional client metadata from request headers for audit logging.
 * Browsers send most of these automatically; custom headers (X-Client-*) come from the frontend.
 */
export function getClientMeta(request: any): Record<string, string | undefined> {
  if (!request) return {}
  const headers = request.headers || {}
  const h = (key: string) => {
    const v = headers[key.toLowerCase?.() ?? key] ?? headers[key]
    if (typeof v === 'string') return v.trim()
    if (Array.isArray(v) && v[0] != null) return String(v[0]).trim()
    return undefined
  }
  return {
    language: h('accept-language')?.split(',')[0]?.trim(),
    screenResolution: h('x-client-screen'),
    timezone: h('x-client-timezone'),
    platform: h('sec-ch-ua-platform')?.replace(/"/g, '') || h('x-client-platform'),
    mobile: h('sec-ch-ua-mobile'),
    referer: h('referer'),
  }
}
