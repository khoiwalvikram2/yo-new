/**
 * GMAG game history / round detail client.
 * RoundDetail API: POST to {{gmag_game_data_url}}/history/roundDetail?hash={{xxx}}
 * Returns the round detail URL for wagering details (brand should call this to get URL).
 */

import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'

export type FetchRoundDetailParams = {
  roundId: string
  endTime: string
  providerCode: string
  language?: string
}

export type FetchRoundDetailResult = {
  url: string
}

function getEnv(): { gameDataUrl: string; secretKey: string; brandId: number } {
  const gameDataUrl = process.env.GMAG_GAME_DATA_URL?.trim()
  const secretKey = process.env.GMAG_SECRET_KEY?.trim()
  const brandIdRaw = process.env.GMAG_BRAND_ID
  if (!gameDataUrl || !secretKey) {
    throw new Error('GMAG_GAME_DATA_URL and GMAG_SECRET_KEY must be set in env.')
  }
  const brandId = brandIdRaw ? Number(brandIdRaw) : 0
  if (!Number.isFinite(brandId)) {
    throw new Error('GMAG_BRAND_ID must be a number in env.')
  }
  return { gameDataUrl, secretKey, brandId }
}

function buildGmagHashPlainString(params: Record<string, unknown>, secretKey: string): string {
  const keys = Object.keys(params).sort()
  const parts: string[] = []
  for (const key of keys) {
    if (key === 'hash') continue
    const val = params[key]
    const str =
      Array.isArray(val) ? JSON.stringify(val) : val === null || val === undefined ? '' : String(val)
    parts.push(`${key}=${str}`)
  }
  return parts.join('&') + secretKey
}

function computeGmagHash(params: Record<string, unknown>, secretKey: string): string {
  const plain = buildGmagHashPlainString(params, secretKey)
  return createHash('md5').update(plain, 'utf8').digest('hex')
}

/**
 * Normalize endTime to GMAG format: YYYY-MM-DD HH:mm:00 in GMT+0.
 * Accepts ISO string (e.g. 2026-03-12T04:53:09.803Z) or already "YYYY-MM-DD HH:mm:00".
 */
function normalizeEndTimeToGmag(endTime: string): string {
  const s = endTime.trim()
  const gmagLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/
  if (gmagLike.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid endTime: ${endTime}`)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  const min = String(d.getUTCMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}:00`
}

/**
 * RoundDetail API per GMAG spec:
 * - URL: https://{{gmag_game_data_url}}/history/roundDetail?hash={{xxx}}
 * - Method: POST
 * - Body: requestId, brandId, roundId, endTime (YYYY-MM-DD HH:mm:00 GMT+0), providerCode, language (optional)
 * - Response: { error, message, data } where data is the round detail URL string.
 */
export async function fetchRoundDetail(params: FetchRoundDetailParams): Promise<FetchRoundDetailResult> {
  const { gameDataUrl, secretKey, brandId } = getEnv()
  const endTimeNormalized = normalizeEndTimeToGmag(params.endTime)

  const url = new URL(gameDataUrl)
  const basePath = url.pathname.replace(/\/?$/, '')
  const path = `${basePath}/history/roundDetail`
  const fullUrl = `${url.origin}${path}`

  const body: Record<string, unknown> = {
    requestId: randomUUID(),
    brandId: String(brandId),
    roundId: params.roundId,
    endTime: endTimeNormalized,
    providerCode: params.providerCode,
  }
  if (params.language != null && params.language.trim() !== '') {
    body.language = params.language.trim()
  }

  const hash = computeGmagHash(body, secretKey)
  const fetchUrl = `${fullUrl}?hash=${encodeURIComponent(hash)}`

  const res = await fetch(fetchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const json = text ? (() => { try { return JSON.parse(text) as Record<string, unknown> } catch { return {} } })() : {}

  if (!res.ok) {
    const msg = String(((json as { message?: string }).message ?? text) || res.statusText)
    throw new Error(msg)
  }

  const errCode = json.error
  if (errCode !== undefined && errCode !== '0') {
    const msg = String((json as { message?: string }).message ?? 'GM-Ag API error')
    throw new Error(msg)
  }

  const data = json.data
  if (typeof data !== 'string' || !data.trim()) {
    throw new Error('No round detail URL returned')
  }
  return { url: data.trim() }
}
