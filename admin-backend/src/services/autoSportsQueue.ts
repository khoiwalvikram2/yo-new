import PgBoss from 'pg-boss'
import { getSportsAdapters } from '@src/adapters/sportsRegistry.js'
import { getSportById, upsertLeague, upsertEvent, upsertMarket, upsertRunner } from '@src/repos/sports/sportsRepo.js'
import { eventHasAnyAllowedProviderMarket } from '@src/repos/sports/ingestMarketAllowlist.js'
import { getAutoConfig, listActiveAutoConfigs, markAutoConfigFailure, markAutoConfigRunning, markAutoConfigSuccess } from '@src/repos/sports/sportsAutoConfigRepo.js'

const JOB_NAME = 'auto-sports/ingest'
let boss: PgBoss | null = null

function computeNextRunAt(lastRunAt: Date | null, frequencyHours: number): Date {
  if (!lastRunAt) return new Date()
  return new Date(lastRunAt.getTime() + Number(frequencyHours) * 3600 * 1000)
}

export async function startAutoSportsQueue(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    // eslint-disable-next-line no-console
    return
  }
  const { getSSLConfig } = await import('@shared/db/ssl.js')
  const ssl = getSSLConfig(connectionString)
  boss = new PgBoss({
    connectionString,
    ssl: ssl === false ? undefined : ssl,
  })
  await boss.start()

  await boss.work(JOB_NAME, async (job) => {

    const { whitelabelId, sportId } = job.data as { whitelabelId: string; sportId: string }
    try {
      // mark running
      await markAutoConfigRunning(whitelabelId, sportId)

      const [adapter] = getSportsAdapters('SportsProviderA')
      const sport = await getSportById(String(sportId))
      const sportCode = String(sport?.sportCode ?? '')
      let leagueNameByCode: Record<string, string> = {}
      if (sportCode) {
        const leagues = await adapter.listLeagues({ sportCode })
        leagueNameByCode = Object.fromEntries((leagues || []).map((it: any) => [String(it?.competition?.id ?? ''), String(it?.competition?.name ?? '')]))
      }
      const row = await getAutoConfig(whitelabelId, sportId)
      const leagueCodes: string[] = Array.isArray(row?.leagueCodes) ? (row.leagueCodes as any) : []

      for (const leagueCode of leagueCodes) {
        const events = await adapter.listEvents({ leagueId: String(leagueCode) })
        const leagueName = leagueNameByCode[String(leagueCode)] || String(leagueCode)
        const leagueKey = leagueName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '')
        for (const e of (events || [])) {
          const eventCode = String(e?.event?.id ?? '')
          const eventName = String(e?.event?.name ?? '')
          const startTime = e?.event?.openDate ? new Date(e.event.openDate).toISOString() : null
          const markets = await adapter.listMarkets({ eventId: eventCode })
          if (!eventHasAnyAllowedProviderMarket(markets as any[])) continue
          const dbLeagueId = await upsertLeague({
            sportId: String(sportId),
            leagueCode: String(leagueCode),
            key: leagueKey,
            name: leagueName,
          })
          const dbEventId = await upsertEvent({
            leagueId: dbLeagueId,
            eventCode,
            key: eventName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, ''),
            name: eventName,
            startTime: startTime ?? null,
          })
          for (const m of (markets || [])) {
            const marketId = await upsertMarket({
              eventId: dbEventId,
              marketCode: String(m?.marketId ?? ''),
              name: String(m?.marketName ?? 'Market'),
              type: 'match_odds',
            })
            if (!marketId) continue
            for (const rr of (m?.runners || [])) {
              await upsertRunner({
                marketId,
                selectionCode: String(rr?.selectionId ?? ''),
                name: String(rr?.runnerName ?? 'Runner'),
                sort: Number(rr?.sortPriority ?? 999),
              })
            }
          }
        }
      }

      await markAutoConfigSuccess(whitelabelId, sportId)
    } catch (e) {
      try {
        await markAutoConfigFailure(whitelabelId, sportId)
      } catch {}
    } finally {
      // re-enqueue next
      try { await scheduleAutoConfig(whitelabelId, sportId) } catch {}
    }
  })

  await scheduleAllAutoConfigs()
}

export async function scheduleAutoConfig(whitelabelId: string, sportId: string): Promise<void> {
  if (!boss) return
  const r = await getAutoConfig(whitelabelId, sportId)
  if (!r || !r.active) return
  const next = computeNextRunAt(r.lastRunAt ?? null, Number(r.frequencyHours ?? 6))
  await boss.send(JOB_NAME, { whitelabelId, sportId }, { startAfter: next, singletonKey: `${whitelabelId}:${sportId}` })
}

export async function scheduleAllAutoConfigs(): Promise<void> {
  if (!boss) return
  const rows = await listActiveAutoConfigs()
  for (const r of rows) {
    try {
      const next = computeNextRunAt(r.lastRunAt ?? null, Number(r.frequencyHours ?? 6))
      await boss.send(JOB_NAME, { whitelabelId: String(r.whitelabelId), sportId: String(r.sportId) }, { startAfter: next, singletonKey: `${r.whitelabelId}:${r.sportId}` })
    } catch {}
  }
}

