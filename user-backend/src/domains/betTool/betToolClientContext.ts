/** Column limits on `sports_bets` (ip, user_agent, device_info, location, country). */
const LEN = { ip: 45, ua: 512, device: 256, loc: 256, ctry: 64 } as const

function trunc(s: string, max: number): string {
  const t = s.trim()
  return t.length <= max ? t : t.slice(0, max)
}

export type BetToolClientContextFields = {
  ipAddress: string | null
  userAgent: string | null
  deviceInfo: string | null
  location: string | null
  country: string | null
}

/**
 * Optional client fields from bet-tool JSON (`ipAddress` or `ip`, `userAgent`, `deviceInfo` string or object, `location`, `country`).
 * Values are trimmed and truncated to fit `sports_bets` columns.
 */
export function parseBetToolClientContext(body: Record<string, unknown>): BetToolClientContextFields {
  const ipRaw = body.ipAddress ?? body.ip
  const ipAddress =
    typeof ipRaw === 'string' && ipRaw.trim() ? trunc(ipRaw, LEN.ip) : null
  const userAgent =
    typeof body.userAgent === 'string' && body.userAgent.trim() ? trunc(body.userAgent, LEN.ua) : null
  let deviceInfo: string | null = null
  if (body.deviceInfo != null) {
    if (typeof body.deviceInfo === 'string' && body.deviceInfo.trim()) {
      deviceInfo = trunc(body.deviceInfo, LEN.device)
    } else if (typeof body.deviceInfo === 'object' && !Array.isArray(body.deviceInfo)) {
      deviceInfo = trunc(JSON.stringify(body.deviceInfo), LEN.device)
    }
  }
  const location =
    typeof body.location === 'string' && body.location.trim() ? trunc(body.location, LEN.loc) : null
  const country =
    typeof body.country === 'string' && body.country.trim() ? trunc(body.country, LEN.ctry) : null
  return { ipAddress, userAgent, deviceInfo, location, country }
}

/**
 * `casino_bets.metadata` JSONB: nested `betToolClient` for admin/debug.
 * `deviceInfo` is kept as a JSON object when the body sends an object; otherwise a truncated string.
 */
export function buildCasinoBetToolMetadata(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const flat = parseBetToolClientContext(body)
  const betToolClient: Record<string, unknown> = {}
  if (flat.ipAddress) betToolClient.ipAddress = flat.ipAddress
  if (flat.userAgent) betToolClient.userAgent = flat.userAgent
  if (flat.location) betToolClient.location = flat.location
  if (flat.country) betToolClient.country = flat.country
  const di = body.deviceInfo
  if (di != null) {
    if (typeof di === 'object' && !Array.isArray(di)) {
      betToolClient.deviceInfo = di
    } else if (typeof di === 'string' && di.trim()) {
      betToolClient.deviceInfo = flat.deviceInfo
    }
  }
  if (Object.keys(betToolClient).length === 0) return undefined
  return { betToolClient }
}
