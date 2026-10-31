import './loadEnv.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { db } from '../src/db/client.js'
import {
  casinoApiProviders,
  casinoGames,
  casinoVendors,
  whitelabels,
  whitelabelCasinoGameSettings,
} from '../src/db/schema.js'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { checkWhitelabelExists, checkFileExists, exitWithError, logStep, logSuccess } from './seedUtils.js'
import { isLatinGameName } from './gameNameUtils.js'

function kebabCase(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function ensureGapCasinoProvider(): Promise<number> {
  const key = 'gapcasino'
  const name = 'GapCasino'
  const existing = await db.select({ id: casinoApiProviders.id }).from(casinoApiProviders).where(eq(casinoApiProviders.key, key))
  if (existing.length) return existing[0].id
  const inserted = await db.insert(casinoApiProviders).values({ key, name, status: 'active' }).returning({ id: casinoApiProviders.id })
  return inserted[0].id
}

async function ensureVendor(providerId: number, externalId: string, name: string): Promise<number> {
  const slug = kebabCase(name)
  const existing = await db.select({ id: casinoVendors.id }).from(casinoVendors).where(eq(casinoVendors.slug, slug))
  if (existing.length) return existing[0].id
  const inserted = await db.insert(casinoVendors).values({ name, slug }).returning({ id: casinoVendors.id })
  return inserted[0].id
}

async function upsertGame(params: {
  providerId: number
  vendorId: number
  externalId: string
  tableId?: string | null
  name: string
  slug: string
  thumbnailUrl?: string | null
  isActive: boolean
  mainCategory: 'live_casino' | 'casino' | 'slots'
}) {
  const { providerId, vendorId, externalId, tableId, name, slug, thumbnailUrl, isActive, mainCategory } = params
  await db.insert(casinoGames).values({
    apiProviderId: providerId,
    vendorId,
    externalId,
    tableId: tableId ?? null,
    name,
    slug,
    thumbnailUrl: thumbnailUrl ?? null,
    isActive,
    mainCategory: mainCategory as 'live_casino' | 'casino' | 'slots',
  }).onConflictDoUpdate({
    target: [casinoGames.apiProviderId, casinoGames.externalId],
    set: {
      tableId: tableId ?? null,
      name,
      slug,
      thumbnailUrl: thumbnailUrl ?? null,
      isActive,
      updatedAt: sql`now()`,
    },
  })
}

async function linkTenantSettings(tenant: string, gameId: number, order: number) {
  await db.insert(whitelabelCasinoGameSettings).values({ tenantId: tenant, gameId, enabled: true, order })
    .onConflictDoUpdate({ target: [whitelabelCasinoGameSettings.tenantId, whitelabelCasinoGameSettings.gameId], set: { enabled: true, order } })
}

export async function seedGapCasino() {
  const tenant = 'default'
  logStep(1, 2, 'Checking prerequisites')
  const whitelabelExists = await checkWhitelabelExists(tenant)
  if (!whitelabelExists) exitWithError(`Whitelabel '${tenant}' not found. Ensure database is initialized.`)
  logSuccess(`Whitelabel '${tenant}' exists`)
  const filePath = path.resolve(process.cwd(), '..', 'gap-casino-games.json')
  const fileExists = await checkFileExists(filePath)
  if (!fileExists) exitWithError(`gap-casino-games.json not found at project root. Expected path: ${filePath}`)
  logSuccess(`JSON file found: gap-casino-games.json`)
  logStep(2, 2, 'Importing Gap Casino games')
  const providerId = await ensureGapCasinoProvider()
  const raw = await fs.readFile(filePath, 'utf8')
  const allData = JSON.parse(raw) as Array<Record<string, unknown>>
  const limitRaw = process.env.LIMIT ? Number(process.env.LIMIT) : undefined
  const data = Number.isFinite(limitRaw) && limitRaw! > 0 ? allData.slice(0, limitRaw) : allData
  let linked = 0
  const orderByVendorCategory: Record<string, number> = {}
  for (const rec of data) {
    const title = String(rec?.title || rec?.name || '')
    const gameId = String(rec?.game_id || rec?.id || '')
    if (!title || !gameId) continue
    if (!isLatinGameName(title)) continue
    const vendorName = String(rec?.provider_name || 'Unknown')
    const vendorExternalId = String(rec?.provider_id || vendorName)
    const vendorId = await ensureVendor(providerId, vendorExternalId, vendorName)
    const categoryRaw = String(rec?.game_category || '').trim()
    const mainCategory = categoryRaw === 'Slots' ? 'slots' : 'live_casino'
    const slug = kebabCase(title) || kebabCase(String(rec?.table_id || gameId))
    const thumb = (rec?.game_images as string) ?? null
    const tableId = (rec?.table_id as string) ?? null
    await upsertGame({
      providerId,
      vendorId,
      externalId: gameId,
      tableId,
      name: title,
      slug,
      thumbnailUrl: thumb,
      isActive: true,
      mainCategory,
    })
    const g = await db.select({ id: casinoGames.id }).from(casinoGames).where(and(
      eq(casinoGames.apiProviderId, providerId),
      eq(casinoGames.externalId, gameId),
    ))
    const gid = g[0]?.id
    if (gid) {
      const key = `${vendorId}:${mainCategory}`
      const nextOrder = (orderByVendorCategory[key] || 0) + 1
      orderByVendorCategory[key] = nextOrder
      await linkTenantSettings(tenant, gid, nextOrder)
      linked++
    }
  }

  // Ensure all GAP games are active (enabled by default)
  await db
    .update(casinoGames)
    .set({ isActive: true, updatedAt: sql`now()` })
    .where(eq(casinoGames.apiProviderId, providerId))
  console.log('   Set is_active=true for all GAP games')

  // Force tenant settings: ALL whitelabels should show GAP games as ENABLED in admin
  const gapRows = await db
    .select({ id: casinoGames.id })
    .from(casinoGames)
    .where(eq(casinoGames.apiProviderId, providerId))
  const gapGameIds = gapRows.map((r) => r.id)
  const allTenants = await db.select({ id: whitelabels.id }).from(whitelabels)
  if (gapGameIds.length > 0 && allTenants.length > 0) {
    for (const { id: tenantId } of allTenants) {
      await db
        .update(whitelabelCasinoGameSettings)
        .set({ enabled: true, updatedAt: sql`now()` })
        .where(
          and(
            eq(whitelabelCasinoGameSettings.tenantId, tenantId),
            inArray(whitelabelCasinoGameSettings.gameId, gapGameIds)
          )
        )
      const existing = await db
        .select({ gameId: whitelabelCasinoGameSettings.gameId })
        .from(whitelabelCasinoGameSettings)
        .where(
          and(
            eq(whitelabelCasinoGameSettings.tenantId, tenantId),
            inArray(whitelabelCasinoGameSettings.gameId, gapGameIds)
          )
        )
      const existingSet = new Set(existing.map((r) => r.gameId))
      for (const gameId of gapGameIds) {
        if (!existingSet.has(gameId)) {
          await db
            .insert(whitelabelCasinoGameSettings)
            .values({ tenantId, gameId, enabled: true })
            .onConflictDoUpdate({
              target: [whitelabelCasinoGameSettings.tenantId, whitelabelCasinoGameSettings.gameId],
              set: { enabled: true, updatedAt: sql`now()` },
            })
          existingSet.add(gameId)
        }
      }
    }
    console.log(`   Set enabled=true for ${allTenants.length} whitelabel(s) on ${gapGameIds.length} GAP games`)
  }

  console.log(`\n✅ Gap Casino seeding done.`)
  console.log(`   Processed ${data.length} records (of ${allData.length})`)
  console.log(`   Linked ${linked} games for tenant '${tenant}' (enabled for all whitelabels)`)
}

if (process.argv[1]?.includes('seedGapCasino')) {
  seedGapCasino().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
}
