import './loadEnv.js'
import { db } from '../src/db/client.js'
import { sportsTable } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { checkWhitelabelExists, exitWithError, logSuccess } from './seedUtils.js'

const DEFAULT_SPORTS_API_URL = 'http://174.138.121.69/get-sports'
const DEFAULT_FETCH_TIMEOUT_MS = 30_000

type ProviderSport = { eventType: { id: string; name: string }; marketCount?: number }

async function fetchSports(url: string): Promise<ProviderSport[]> {
  const timeoutMs = Number(process.env.SPORTS_FETCH_TIMEOUT_MS) || DEFAULT_FETCH_TIMEOUT_MS
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`Failed to fetch sports: ${res.status}`)
    const data = await res.json()
    return data as ProviderSport[]
  } finally {
    clearTimeout(timeoutId)
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
}

export async function seedSports() {
  const tenant = 'default'
  const whitelabelExists = await checkWhitelabelExists(tenant)
  if (!whitelabelExists) {
    exitWithError(`Whitelabel '${tenant}' not found. Ensure database is initialized.`)
  }
  logSuccess(`Whitelabel '${tenant}' exists`)

  const url = process.env.SPORTS_API_URL || DEFAULT_SPORTS_API_URL
  const reset = process.env.RESET === '1' || process.argv.includes('--reset')

  if (reset) {
    await db.delete(sportsTable)
    console.log('Cleared all existing sports (global data)')
  }

  const items = await fetchSports(url)
  const base = items.map(i => {
    const rawName = i.eventType?.name || 'Unknown'
    const normalized = rawName === 'Soccer' ? 'Football' : rawName
    return {
      id: String(i.eventType?.id ?? ''),
      name: normalized,
    }
  })
  const fixedOrder: Record<string, number> = {
    cricket: 1,
    football: 2,
    tennis: 3,
  }
  const others = base
    .filter(b => !fixedOrder[b.name.toLowerCase()])
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b, idx) => ({ ...b, sort: 4 + idx }))
  const withSort = base.map(b => ({
    ...b,
    sort: fixedOrder[b.name.toLowerCase()] ?? (others.find(o => o.id === b.id)?.sort ?? 999),
  }))
  const imports = withSort.map(b => {
    const key = slugify(b.name.replace(/\//g, '-')).replace(/-{2,}/g, '-')
    return { sportCode: b.id, key, name: b.name, sort: b.sort }
  })

  let inserted = 0
  let updated = 0
  for (const item of imports) {
    const existing = await db.select().from(sportsTable).where(eq(sportsTable.sportCode, item.sportCode))
    if (existing.length === 0) {
      await db.insert(sportsTable).values({
        sportCode: item.sportCode,
        key: item.key,
        name: item.name,
        sort: item.sort ?? 999,
        status: 'active',
      })
      inserted++
    } else {
      const current = existing[0]
      await db.update(sportsTable).set({
        key: item.key,
        name: item.name,
        sort: item.sort ?? current.sort,
        updatedAt: new Date(),
      }).where(eq(sportsTable.id, current.id))
      updated++
    }
  }

  console.log(`\n✅ Sports seeding done. Inserted: ${inserted}, Updated: ${updated}`)
}

if (process.argv[1]?.includes('seedSports')) {
  seedSports().catch((err) => { console.error(err); process.exit(1) })
}
