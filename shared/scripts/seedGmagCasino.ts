import './loadEnv.js'
import { createHash, randomUUID } from 'node:crypto'
import { db } from '../src/db/client.js'
import {
  casinoApiProviders,
  casinoGames,
  casinoVendors,
  whitelabels,
  whitelabelCasinoGameSettings,
  whitelabelCasinoVendorSettings,
} from '../src/db/schema.js'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { checkWhitelabelExists, exitWithError, logStep, logSuccess } from './seedUtils.js'
import { isLatinGameName } from './gameNameUtils.js'

const GMAG_PROVIDER_KEY = 'gmagcasino'
const GMAG_PROVIDER_NAME = 'GM-Ag Casino'
const PAGE_SIZE = 100
const DEFAULT_TENANT = 'default'
/** Max pages to fetch (for testing). Set to 0 or leave unset to fetch all pages. */
const MAX_PAGES = Math.max(0, Number(process.env.GMAG_MAX_PAGES ?? 0) || 0)
/** Delay in ms between page requests to avoid rate limiting / 503. */
const PAGE_DELAY_MS = Math.max(0, Number(process.env.GMAG_SEED_DELAY_MS ?? 400))
/** Max retries for 503/5xx with exponential backoff (seconds). */
const RETRY_ATTEMPTS = 3
const RETRY_BACKOFF_SEC = [2, 5, 10]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function kebabCase(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function mapGameType(gameType: string): 'live_casino' | 'casino' | 'slots' {
  const t = String(gameType || '').toLowerCase()
  if (t === 'slots') return 'slots'
  if (t === 'live') return 'live_casino'
  // Map API "casino" to live_casino so categories show on user panel (Live Casino section)
  if (t === 'casino') return 'live_casino'
  return 'live_casino'
}

/** Provider code (API) → display name for DB. Lookup by lowercase key. */
const PROVIDER_CODE_TO_NAME: Record<string, string> = {
  pt: 'Playtech',
  sw: 'Skywind',
  mg: 'Microgaming',
  rb: 'RubyPlay',
  png: "Play'n GO",
  tf: 'TFGaming',
  ibc: 'IBC',
  cq9: 'CQGame',
  hab: 'Habanero',
  allbet: 'Allibet',
  ps: 'Playson',
  em: 'EveryMatrix',
  revolver: 'RevolverGaming',
  pp: 'PragmaticPlay',
  caleta: 'Caleta',
  ss: 'SuperSpade',
  mplay: 'Mplay',
  spg: 'XProGaming',
  relax: 'Relax',
  bng: 'Booongo',
  endorphina: 'Endorphina',
  pgsoft: 'PGSoft',
  inbet: 'Inbet',
  isb: 'iSoftBet/Roovo',
  bg: 'BetGames',
  eug: 'Ezugi',
  tvb: 'TVBET',
  mega: 'Mega888',
  ag: 'AG',
  spb: 'Spribe',
  betby: 'BetBy',
  ky: 'KaiYuan',
  bgaming: 'BGaming',
  evo: 'Evolution',
  rt: 'RedTiger',
  nt: 'Netent',
  gameart: 'GameArt',
  ug: 'UnitedGaming',
  zitro: 'Zitro',
  expanse: 'Expanse',
  ptn: 'Playtech N',
  bm: 'Booming Games',
  evog: 'Evolution Gaming',
  felix: 'Felix',
  pg: 'Push Gaming',
  bp: 'BluePrint',
  xg: '1X2 Gaming',
  emds: 'Endorphina_Asia',
  tbg: 'Turbogames',
  klb: 'Kalambo',
  ot: 'Onetouch',
  nta: 'Netent Asia',
  rta: 'Redtiger Asia',
  nlca: 'Nolimitcity Asia',
  btga: 'BigTimeGaming Asia',
  oaks: '3Oaks',
  pstar: 'PlayStar',
  jili: 'Jili',
  jdb: 'JUST DO THE BEST',
  og: 'Ortiz Gaming',
  fk: 'Funky Games',
  jokor: 'Joker',
  rtg: 'RTG',
  evp: 'EVOPLAY',
  hsw: 'Hacksaw',
  wardan: 'Wardan',
  belatra: 'Belatra Games',
  stst: 'Smart soft',
  mbs: 'Marbles',
  r88: 'Rich88',
  fc: 'FC slot',
  gmw: 'GMW',
  tk: 'Thunderkick',
  kr: 'Kiron',
  yb: 'Yes Bingo/ Yellow bat',
  im: 'iMoon',
  aspect: 'Aspect',
  winf: 'Winfast',
  ea: 'Aviatrix',
  bb: 'Live88',
  vp: 'Victory Poker',
  ns: 'Next Spin',
  gtsm: 'Indigo Magic',
  gtm: 'Gamomat',
  gtam: 'Atomic',
  crz: 'Creedroomz',
  naga: 'Naga',
  amatic: 'Amatic',
  bti: 'BTI',
  mascot: 'Mascot',
  lc: 'Triple Cherry',
  novomatic: 'Novomatic',
  onlyplay: 'Onlyplay',
  spinomenal: 'Spinomenal',
  gryx: 'Oryx',
  inout: 'InDout',
  supersport: 'Super Sport',
  rsg: 'RSG',
  rectangle: 'Rectangle',
  atg: 'ATG',
  platipus: 'Platipus',
  mojos: '7 mojos',
  shadylady: 'Shadylady',
  kyi: 'KY Gaming',
  ggsoft: 'GGSoft',
  gpi: 'GPI',
  popiplay: 'POPIPLAY',
  fazi: 'Fazi',
  xgd: '富贵棋牌',
  pascal: 'Pascal',
  buffalo: 'Buffalo',
  galaxsys: 'Galaxys',
  pk: 'Penguin King',
  nvma: 'Novomatic_Asia',
  db: 'DB 电子',
  cs: 'Crown Sport',
}

function getVendorDisplayName(providerCode: string): string {
  const key = providerCode.trim().toLowerCase()
  const name = (key && PROVIDER_CODE_TO_NAME[key]) || providerCode || 'Unknown'
  return name.slice(0, 120)
}

/** Provider code (API) → canonical slug so "smartsoft" and "smart-soft" use same vendor. */
const PROVIDER_CODE_TO_CANONICAL_SLUG: Record<string, string> = {
  smartsoft: 'smart-soft',
  'smart-soft': 'smart-soft',
}

function getCanonicalProviderSlug(providerCode: string): string | undefined {
  const key = providerCode.trim().toLowerCase()
  return key ? PROVIDER_CODE_TO_CANONICAL_SLUG[key] : undefined
}

/** DB column is numeric(5,2) — max 999.99. API may send e.g. 95959 for 95.959%, or 0.9634 for 96.34%. Normalize and clamp. */
function normalizeRtpForDb(rtp: string | number | null | undefined): string | null {
  if (rtp == null || String(rtp).trim() === '') return null
  const str = String(rtp).trim().replace(/,/g, '.').replace(/%/g, '')
  const num = Number.parseFloat(str)
  if (!Number.isFinite(num)) return null
  let value = num
  if (value > 999.99) value = value / 1000
  if (value > 0 && value < 1) value = value * 100
  value = Math.round(value * 100) / 100
  value = Math.max(0, Math.min(999.99, value))
  return value.toFixed(2)
}

async function ensureGmagProvider(): Promise<number> {
  const existing = await db
    .select({ id: casinoApiProviders.id })
    .from(casinoApiProviders)
    .where(eq(casinoApiProviders.key, GMAG_PROVIDER_KEY))
  if (existing.length) return existing[0].id
  const [inserted] = await db
    .insert(casinoApiProviders)
    .values({ key: GMAG_PROVIDER_KEY, name: GMAG_PROVIDER_NAME, status: 'active' })
    .returning({ id: casinoApiProviders.id })
  return inserted.id
}

async function ensureVendor(providerId: number, providerCode: string, displayName: string): Promise<number> {
  const slug = getCanonicalProviderSlug(providerCode) || kebabCase(providerCode) || 'unknown'
  const name = (displayName || 'Unknown').slice(0, 120)
  const existing = await db
    .select({ id: casinoVendors.id, name: casinoVendors.name })
    .from(casinoVendors)
    .where(eq(casinoVendors.slug, slug))
  if (existing.length) {
    if (existing[0].name !== name) {
      await db.update(casinoVendors).set({ name }).where(eq(casinoVendors.slug, slug))
    }
    return existing[0].id
  }
  const [inserted] = await db
    .insert(casinoVendors)
    .values({ name, slug })
    .returning({ id: casinoVendors.id })
  return inserted.id
}

async function upsertGame(params: {
  providerId: number
  vendorId: number
  externalId: string
  tableId?: string | null
  name: string
  slug: string
  thumbnailUrl?: string | null
  rtp?: string | null
  isActive: boolean
  mainCategory: 'live_casino' | 'casino' | 'slots'
}) {
  const {
    providerId,
    vendorId,
    externalId,
    tableId,
    name,
    slug,
    thumbnailUrl,
    rtp,
    isActive,
    mainCategory,
  } = params
  const rtpVal = normalizeRtpForDb(rtp)
  await db
    .insert(casinoGames)
    .values({
      apiProviderId: providerId,
      vendorId,
      externalId,
      tableId: tableId ?? null,
      name,
      slug,
      thumbnailUrl: thumbnailUrl ?? null,
      rtp: rtpVal,
      isActive,
      mainCategory: mainCategory as 'live_casino' | 'casino' | 'slots',
    })
    .onConflictDoUpdate({
      target: [casinoGames.apiProviderId, casinoGames.externalId],
      set: {
        tableId: tableId ?? null,
        name,
        slug,
        thumbnailUrl: thumbnailUrl ?? null,
        rtp: rtpVal,
        // Do not overwrite isActive: admin may have deactivated a game; only new rows use insert values
        mainCategory: mainCategory as 'live_casino' | 'casino' | 'slots',
        updatedAt: sql`now()`,
      },
    })
}

/** New rows: enabled + order. Existing rows: only order (preserve enabled / inactive tenant choice). */
async function linkTenantSettings(tenant: string, gameId: number, order: number) {
  await db
    .insert(whitelabelCasinoGameSettings)
    .values({ tenantId: tenant, gameId, enabled: true, order })
    .onConflictDoUpdate({
      target: [whitelabelCasinoGameSettings.tenantId, whitelabelCasinoGameSettings.gameId],
      set: { order },
    })
}

type GmagGameItem = {
  gameCode?: string
  enName?: string
  providerCode?: string
  gameType?: string
  imgDefault?: string
  rtp?: string | number
  status?: number | string
  [key: string]: unknown
}

type GmagListResponse = {
  current?: number
  pages?: number
  list?: GmagGameItem[]
  data?: GmagGameItem[]
  records?: GmagGameItem[]
}

async function fetchGameListPage(
  baseUrl: string,
  secretKey: string,
  brandId: number,
  page: number
): Promise<GmagListResponse> {
  const url = new URL(baseUrl)
  if (!url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/?$/, '') + '/'
  const path = `${url.pathname.replace(/\/$/, '')}/game/list`
  const fullUrl = `${url.origin}${path}`
  const body: Record<string, unknown> = {
    brandId,
    page,
    requestId: randomUUID(),
    size: PAGE_SIZE,
  }
  const hash = computeGmagHash(body, secretKey)
  const requestUrl = `${fullUrl}?hash=${encodeURIComponent(hash)}`
  if (page === 1) {
    console.log(`  Request: POST ${fullUrl} (brandId=${brandId}, page=1, size=${PAGE_SIZE})`)
  }

  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const backoffSec = RETRY_BACKOFF_SEC[attempt - 1] ?? 10
      console.log(`  [GMAG API] Retry ${attempt}/${RETRY_ATTEMPTS} in ${backoffSec}s for page ${page}...`)
      await sleep(backoffSec * 1000)
    }

    console.log('[GMAG API] Request', {
      method: 'POST',
      url: requestUrl,
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    let res: Response
    let responseText: string
    try {
      res = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      responseText = await res.text()
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      console.error('[GMAG API] Request failed (network error)', { url: requestUrl, err })
      if (attempt === RETRY_ATTEMPTS) throw lastErr
      continue
    }

    const responseLog: Record<string, unknown> = {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      headers: Object.fromEntries(res.headers.entries()),
    }
    try {
      const parsed = JSON.parse(responseText) as Record<string, unknown>
      const dataObj = (parsed?.data as Record<string, unknown>) ?? parsed
      const list = Array.isArray(parsed?.records)
        ? parsed.records
        : Array.isArray(parsed?.list)
          ? parsed.list
          : Array.isArray(dataObj?.records)
            ? dataObj.records
            : Array.isArray(dataObj?.list)
              ? dataObj.list
              : []
      if (Array.isArray(list) && list.length > 50) {
        responseLog.bodySummary = { ...parsed, list: `[${list.length} items]`, listPreview: list.slice(0, 2) }
      } else {
        responseLog.body = parsed
      }
    } catch {
      responseLog.rawBody = responseText.slice(0, 500)
    }
    console.log('[GMAG API] Response', responseLog)

    const isRetryable = res.status === 503 || res.status >= 500
    if (!res.ok) {
      lastErr = new Error(`GM-Ag API error: ${res.status} ${res.statusText}${responseText ? ` - ${responseText.slice(0, 200)}` : ''}`)
      if (isRetryable && attempt < RETRY_ATTEMPTS) continue
      throw lastErr
    }

    const json = JSON.parse(responseText) as { data?: GmagListResponse; list?: GmagGameItem[]; records?: GmagGameItem[]; current?: number; pages?: number; success?: boolean; code?: number; message?: string; error?: string; [key: string]: unknown }
    const data = json.data ?? json
    const list = (data as GmagListResponse).list ?? (data as GmagListResponse).records ?? (data as { data?: GmagGameItem[] }).data ?? json.list ?? json.records ?? []

    const errorVal = json.error != null ? String(json.error).trim().toUpperCase() : ''
    const isSuccessResponse = errorVal === 'SUCCESS' || errorVal === '0'
    if (json.error != null && !isSuccessResponse) {
      const errMsg = [json.message, json.error].filter(Boolean).join(' ') || JSON.stringify(json)
      throw new Error(`GM-Ag API error response: ${errMsg}`)
    }
    if (json.success === false || (typeof json.code === 'number' && json.code !== 0)) {
      const errMsg = json.message ?? json.msg ?? String(json.code ?? json)
      throw new Error(`GM-Ag API error response: ${errMsg}`)
    }
    if (list.length === 0 && page === 1) {
      console.warn('  [DEBUG] API returned 0 games on first page. Top-level keys:', Object.keys(json))
      if (typeof data === 'object' && data !== null) {
        console.warn('  [DEBUG] data keys:', Object.keys(data as Record<string, unknown>))
      }
    }
    return {
      current: (data as GmagListResponse).current ?? json.current ?? page,
      pages: (data as GmagListResponse).pages ?? json.pages ?? 1,
      list: Array.isArray(list) ? list : [],
    }
  }
  throw lastErr ?? new Error('GMAG fetch failed after retries')
}

export async function seedGmagCasino() {
  const gameDataUrl = process.env.GMAG_GAME_DATA_URL
  const secretKey = process.env.GMAG_SECRET_KEY
  const brandIdRaw = process.env.GMAG_BRAND_ID

  logStep(1, 3, 'Checking prerequisites')
  const whitelabelExists = await checkWhitelabelExists(DEFAULT_TENANT)
  if (!whitelabelExists) exitWithError(`Whitelabel '${DEFAULT_TENANT}' not found. Ensure database is initialized.`)
  logSuccess(`Whitelabel '${DEFAULT_TENANT}' exists`)

  if (!gameDataUrl?.trim()) exitWithError('GMAG_GAME_DATA_URL is not set.')
  if (!secretKey?.trim()) exitWithError('GMAG_SECRET_KEY is not set.')
  const brandId = brandIdRaw ? Number(brandIdRaw) : 0
  if (!Number.isFinite(brandId)) exitWithError('GMAG_BRAND_ID must be a number.')
  logSuccess('GM-Ag env vars present')

  logStep(2, 3, 'Fetching game list from GM-Ag API')
  if (MAX_PAGES > 0) console.log(`  (Limit: ${MAX_PAGES} pages for testing)`)
  if (PAGE_DELAY_MS > 0) console.log(`  (Delay between pages: ${PAGE_DELAY_MS}ms)`)
  const resumeFrom = Math.max(1, Number(process.env.GMAG_SEED_RESUME_FROM) || 0)
  if (resumeFrom > 1) console.log(`  Resuming from page ${resumeFrom} (will fetch pages 1–${resumeFrom - 1} then ${resumeFrom}+)`)
  const providerId = await ensureGmagProvider()
  let current = 1
  let pages = 1
  let totalPagesFetched = 0
  const allGames: GmagGameItem[] = []
  try {
    if (resumeFrom > 1) {
      for (let p = 1; p < resumeFrom && (MAX_PAGES <= 0 || p <= MAX_PAGES); p++) {
        if (p > 1 && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS)
        const result = await fetchGameListPage(gameDataUrl, secretKey, brandId, p)
        const list = result.list ?? []
        allGames.push(...list)
        pages = result.pages ?? 1
        totalPagesFetched++
        const maxPage = MAX_PAGES > 0 ? MAX_PAGES : pages
        console.log(`  Fetched page ${p}/${maxPage}, ${list.length} games`)
      }
      current = resumeFrom
    }
    do {
      if (MAX_PAGES > 0 && totalPagesFetched >= MAX_PAGES) break
      if (current > 1 && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS)
      const result = await fetchGameListPage(gameDataUrl, secretKey, brandId, current)
      const list = result.list ?? []
      allGames.push(...list)
      pages = result.pages ?? 1
      totalPagesFetched++
      current = (result.current ?? current) + 1
      const maxPage = MAX_PAGES > 0 ? MAX_PAGES : pages
      console.log(`  Fetched page ${current - 1}/${maxPage}, ${list.length} games`)
    } while (current <= pages && (MAX_PAGES <= 0 || current <= MAX_PAGES))
  } catch (err) {
    console.error(err)
    console.error(`\nTo resume from page ${current}, set GMAG_SEED_RESUME_FROM=${current} and run again.`)
    throw err
  }

  logStep(3, 3, 'Upserting games and linking to tenant')
  const orderByVendorCategory: Record<string, number> = {}
  let linked = 0
  for (const rec of allGames) {
    const gameCode = String(rec?.gameCode ?? rec?.game_id ?? '')
    const enName = String(rec?.enName ?? rec?.title ?? rec?.name ?? '')
    if (!gameCode) continue
    const nameForFilter = enName || gameCode
    if (!isLatinGameName(nameForFilter)) continue
    const providerCode = String(rec?.providerCode ?? rec?.provider_code ?? 'Unknown')
    const vendorDisplayName = getVendorDisplayName(providerCode)
    const vendorId = await ensureVendor(providerId, providerCode, vendorDisplayName)
    const gameType = mapGameType(String(rec?.gameType ?? rec?.game_type ?? ''))
    const slugRaw = kebabCase(enName) || kebabCase(gameCode) || String(gameCode).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const slug = (slugRaw || `game-${String(gameCode).slice(0, 180)}`).slice(0, 200)
    const thumbnailUrl = (rec?.imgDefault ?? rec?.img_default ?? rec?.thumbnailUrl) as string | undefined
    const rtp = rec?.rtp != null ? String(rec.rtp) : null
    const name = enName || gameCode
    await upsertGame({
      providerId,
      vendorId,
      externalId: gameCode,
      name,
      slug,
      thumbnailUrl: thumbnailUrl ?? null,
      rtp: rtp ?? null,
      isActive: true,
      mainCategory: gameType,
    })
    const [row] = await db
      .select({ id: casinoGames.id })
      .from(casinoGames)
      .where(
        and(eq(casinoGames.apiProviderId, providerId), eq(casinoGames.externalId, gameCode))
      )
    if (row?.id) {
      const key = `${vendorId}:${gameType}`
      const nextOrder = (orderByVendorCategory[key] ?? 0) + 1
      orderByVendorCategory[key] = nextOrder
      await linkTenantSettings(DEFAULT_TENANT, row.id, nextOrder)
      linked++
    }
  }

  // Do not bulk-set is_active: respect games admin marked inactive.

  // Add missing (tenant, game) rows for new games only; never force enabled=true on existing rows.
  const gmagRows = await db
    .select({ id: casinoGames.id })
    .from(casinoGames)
    .where(eq(casinoGames.apiProviderId, providerId))
  const gmagGameIds = gmagRows.map((r) => r.id)
  const allTenants = await db.select({ id: whitelabels.id }).from(whitelabels)
  if (gmagGameIds.length > 0 && allTenants.length > 0) {
    let insertedTenantGameRows = 0
    for (const { id: tenantId } of allTenants) {
      const existing = await db
        .select({ gameId: whitelabelCasinoGameSettings.gameId })
        .from(whitelabelCasinoGameSettings)
        .where(
          and(
            eq(whitelabelCasinoGameSettings.tenantId, tenantId),
            inArray(whitelabelCasinoGameSettings.gameId, gmagGameIds)
          )
        )
      const existingSet = new Set(existing.map((r) => r.gameId))
      for (const gameId of gmagGameIds) {
        if (!existingSet.has(gameId)) {
          await db
            .insert(whitelabelCasinoGameSettings)
            .values({ tenantId, gameId, enabled: true })
            .onConflictDoNothing()
          insertedTenantGameRows++
          existingSet.add(gameId)
        }
      }
    }
    console.log(
      `   Whitelabel game settings: ${insertedTenantGameRows} new row(s) (enabled=true); existing enabled/disabled unchanged`,
    )
  }

  // New vendor–tenant pairs only; do not re-enable vendors admin disabled.
  const gmagVendorRows = await db
    .select({ vendorId: casinoGames.vendorId })
    .from(casinoGames)
    .where(eq(casinoGames.apiProviderId, providerId))
  const gmagVendorIds = [...new Set(gmagVendorRows.map((r) => r.vendorId))]
  if (gmagVendorIds.length > 0) {
    const allTenantIds = await db.select({ id: whitelabels.id }).from(whitelabels)
    for (const { id: tenantId } of allTenantIds) {
      for (const vendorId of gmagVendorIds) {
        await db
          .insert(whitelabelCasinoVendorSettings)
          .values({ tenantId, vendorId, enabled: true })
          .onConflictDoNothing()
      }
    }
    console.log(
      `   Whitelabel vendor settings: inserted missing pairs with enabled=true; existing enabled flags unchanged`,
    )
  }

  console.log('\n✅ GM-Ag Casino seeding done.')
  console.log(`   Fetched ${allGames.length} games from API`)
  console.log(
    `   Processed ${linked} game link(s) for tenant '${DEFAULT_TENANT}' (new games enabled; existing inactive flags preserved)`,
  )
}

if (process.argv[1]?.includes('seedGmagCasino')) {
  seedGmagCasino()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
