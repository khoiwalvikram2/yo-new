import { upsertRiskLimit } from '@/stores/index.js'
import { getSportsAdapters } from '@src/adapters/sportsRegistry.js'
import { sportsAutoConfigsTable } from '@shared/db/schema.js'
import { db } from '@src/db/client.js'
import { and, eq, inArray } from 'drizzle-orm'
import { upsertSports, setSportStatus, upsertLeague, upsertEvent, upsertMarket, upsertRunner, deleteAutoRuns } from '@src/repos/sports/sportsRepo.js'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'
import { scheduleAutoConfig } from '@src/services/autoSportsQueue.js'
import { upsertSportSettings, sportSettingsAfterUpsert } from '@src/repos/sports/sportsSettingsRepo.js'
import { sportsLimitsProblem } from '@src/domains/sports/settingsLimits.js'
import { upsertLeagueSettingsRepo } from '@src/repos/sports/leagueSettingsRepo.js'
import { upsertEventSettingsRepo } from '@src/repos/sports/eventSettingsRepo.js'
import { upsertRiskConfig } from '@src/repos/sports/riskConfigRepo.js'
import { sportsLeaguesTable, sportsEventsTable, sportsMarketsTable, sportsTable } from '@shared/db/schema.js'
import { eventHasAnyAllowedProviderMarket, NO_ALLOWED_MARKETS_REASON } from '@src/repos/sports/ingestMarketAllowlist.js'
import { hasPermission } from '@src/domains/common/auth.js'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
}

/**
 * Sport, league, event and market status, and the sport and league order, are
 * platform data.
 *
 * sports, sports_leagues, sports_events and sports_markets carry no whitelabel:
 * one row serves every brand, and user-backend refuses a bet on anything that is
 * not active. The map's `sports.configuration` and `sports.events` updates are
 * granted by the flat `sports:write` every Whitelabel Admin holds, so one brand
 * switched a market, an event, a league or a whole sport off for all of them.
 * There is no per-whitelabel status to send the write to instead (the
 * whitelabel's own sport, league and event settings hold limits only), so, as
 * for the casino provider catalogue, the platform permission is asked on top of
 * the map.
 */
function requirePlatformCatalogueAccess(ctx: any, name: string): void {
  if (!hasPermission(ctx?.permissions ?? [], 'all', '*')) {
    throw new Error(`Forbidden: ${name} changes the sports catalogue every whitelabel shares and requires platform administrator permission`)
  }
}

/** The acting admin. `ctx.user` carries the admin id as `sub`; `id` is never set, so audits read 'system'. */
function actorOf(ctx: any): string {
  return String(ctx?.user?.sub ?? ctx?.user?.id ?? 'system')
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ids from a reorder that name no row of the table (a malformed id names none). */
async function unknownCatalogueIds(table: typeof sportsTable | typeof sportsLeaguesTable, ids: string[]): Promise<string[]> {
  const wellFormed = ids.filter((id) => UUID_PATTERN.test(id))
  const found = wellFormed.length
    ? new Set((await db.select({ id: table.id }).from(table).where(inArray(table.id, wellFormed))).map((row) => String(row.id)))
    : new Set<string>()
  return ids.filter((id) => !found.has(id))
}

export const sportsMutationResolvers = {
  upsertRiskLimit: async (_: any, args: any) => {
    const next = upsertRiskLimit({ 
      segment: args.input.segment ?? undefined, 
      userId: args.input.userId ?? undefined, 
      maxStake: args.input.maxStake, 
      liabilityCap: args.input.liabilityCap 
    })
    return next
  },
  seedSportsFromProvider: async (_: any, args: any, ctx: any) => {
    const provider = args.provider as string
    const wl = ctx?.whitelabel?.id as string
    const [adapter] = getSportsAdapters(provider)
    if (!adapter) throw new Error('Unknown provider')
    const items = await adapter.listSports({ whitelabelId: wl })
    const base = items.map(i => {
      const rawName = i.eventType?.name || 'Unknown'
      const normalized = rawName === 'Soccer' ? 'Football' : rawName
      return { id: String(i.eventType?.id ?? ''), name: normalized }
    })
    const fixedOrder: Record<string, number> = { cricket: 1, football: 2, tennis: 3 }
    const others = base
      .filter(b => !fixedOrder[b.name.toLowerCase()])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((b, idx) => ({ ...b, sort: 4 + idx }))
    const withSort = base.map(b => ({
      ...b,
      sort: fixedOrder[b.name.toLowerCase()] ?? (others.find(o => o.id === b.id)?.sort || 999),
    }))
    const imports = withSort.map(b => {
      const key = slugify(b.name.replace(/\//g, '-')).replace(/-{2,}/g, '-')
      return {
        whitelabelId: wl,
        sportCode: b.id,
        key,
        name: b.name,
        sort: b.sort,
      }
    })
    const { inserted, updated } = await upsertSports(imports)
    try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'seedSportsFromProvider', resourceType: 'sports', resourceId: String(provider), before: null, after: { inserted, updated } }) } catch {}
    return { inserted, updated }
  },
  setSportStatus: async (_: any, args: any, ctx: any) => {
    requirePlatformCatalogueAccess(ctx, 'setSportStatus')
    const key = String(args.key)
    const status = String(args.status).toLowerCase() === 'active' ? 'active' : 'inactive'
    // Global data - no tenant filtering
    if (!(await setSportStatus(key, status))) throw new Error('Sport not found')
    try { await recordAuditDb({ tenant: (ctx?.whitelabel?.id ?? 'default') as any, actorId: actorOf(ctx), domain: 'sports', action: 'setSportStatus', resourceType: 'sport', resourceId: key, before: null, after: { status } }) } catch {}
    return true
  },
  persistSportsSelections: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string
    const [adapter] = getSportsAdapters('SportsProviderA')
    let leaguesUpserted = 0
    let eventsUpserted = 0
    let marketsUpserted = 0
    let runnersUpserted = 0
    let skippedMarkets = 0
    const skippedEvents: Array<{ leagueCode: string; leagueName: string; eventCode: string; eventName: string; reason: string }> = []
    for (const ev of (args.events || [])) {
      // Resolve sportId from input (DB id already provided by FE)
      const leagueKey = slugify(ev.leagueName)
      const eventKey = slugify(ev.eventName)
      // Fetch markets and runners from provider for this event
      const markets = await adapter.listMarkets({ eventId: String(ev.eventCode) })
      if (!eventHasAnyAllowedProviderMarket(markets as any[])) {
        skippedEvents.push({
          leagueCode: String(ev.leagueCode),
          leagueName: String(ev.leagueName),
          eventCode: String(ev.eventCode),
          eventName: String(ev.eventName),
          reason: NO_ALLOWED_MARKETS_REASON,
        })
        continue
      }

      const leagueId = await upsertLeague({
        sportId: ev.sportId,
        leagueCode: String(ev.leagueCode),
        key: leagueKey,
        name: ev.leagueName,
      })
      leaguesUpserted++
      const eventId = await upsertEvent({
        leagueId,
        eventCode: String(ev.eventCode),
        key: eventKey,
        name: ev.eventName,
        startTime: ev.startTime ?? null,
      })
      eventsUpserted++
      for (const m of (markets || [])) {
        const marketId = await upsertMarket({
          eventId,
          marketCode: String(m?.marketId ?? ''),
          name: String(m?.marketName ?? 'Market'),
          type: 'match_odds',
        })
        if (!marketId) {
          skippedMarkets++
          continue
        }
        marketsUpserted++
        const runners = (m?.runners || [])
        for (const r of runners) {
          await upsertRunner({
            marketId,
            selectionCode: String(r?.selectionId ?? ''),
            name: String(r?.runnerName ?? 'Runner'),
            sort: Number(r?.sortPriority ?? 999),
          })
          runnersUpserted++
        }
      }
    }
    const persistEvSkip = skippedEvents.length > 0 ? `. ${skippedEvents.length} events skipped (no Match Odds market)` : ''
    const persistMarketSkip = skippedMarkets > 0 ? `. ${skippedMarkets} markets skipped (not in allowlist)` : ''
    const resultPersist = { 
      success: true, 
      message: `Successfully added ${leaguesUpserted} leagues, ${eventsUpserted} events, ${marketsUpserted} markets, and ${runnersUpserted} runners${persistEvSkip}${persistMarketSkip}.`,
      leaguesUpserted, 
      eventsUpserted, 
      marketsUpserted, 
      runnersUpserted, 
      skippedEventsCount: skippedEvents.length, 
      skippedEvents,
      skippedMarketsCount: skippedMarkets,
    }
    try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'persistSportsSelections', resourceType: 'events', resourceId: 'bulk', before: null, after: resultPersist }) } catch {}
    return resultPersist
  },
  upsertAutoSportsConfig: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string
    const existing = await db.select({ id: sportsAutoConfigsTable.id, leagueCodes: sportsAutoConfigsTable.leagueCodes, frequencyHours: sportsAutoConfigsTable.frequencyHours, active: sportsAutoConfigsTable.active }).from(sportsAutoConfigsTable)
      .where(and(eq(sportsAutoConfigsTable.whitelabelId, wl), eq(sportsAutoConfigsTable.sportId, String(args.sportId))))
    if (existing.length) {
      await db.update(sportsAutoConfigsTable)
        .set({ leagueCodes: (args.leagueCodes ?? null) as any, frequencyHours: Number(args.frequencyHours ?? 6), active: args.active ?? true, updatedAt: new Date() })
        .where(eq(sportsAutoConfigsTable.id, existing[0].id))
      // re-schedule next run
      await scheduleAutoConfig(wl, String(args.sportId))
      try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'upsertAutoSportsConfig', resourceType: 'autoConfig', resourceId: String(args.sportId), before: { id: existing[0].id, leagueCodes: existing[0].leagueCodes, frequencyHours: existing[0].frequencyHours, active: existing[0].active }, after: { leagueCodes: args.leagueCodes ?? null, frequencyHours: Number(args.frequencyHours ?? 6), active: args.active ?? true } }) } catch {}
      return { success: true, message: 'Auto config updated' }
    }
    await db.insert(sportsAutoConfigsTable).values({
      whitelabelId: wl,
      sportId: String(args.sportId),
      leagueCodes: (args.leagueCodes ?? null) as any,
      frequencyHours: Number(args.frequencyHours ?? 6),
      active: args.active ?? true,
    })
    await scheduleAutoConfig(wl, String(args.sportId))
    try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'createAutoSportsConfig', resourceType: 'autoConfig', resourceId: String(args.sportId), before: null, after: { leagueCodes: args.leagueCodes ?? null, frequencyHours: Number(args.frequencyHours ?? 6), active: args.active ?? true } }) } catch {}
    return { success: true, message: 'Auto config created' }
  },
  runAutoSportsIngestion: async (_: any, args: any, ctx: any) => {
    // Fetch events for provided leagues; ingest only Match Odds (allowlisted market name)
    const wl = ctx?.whitelabel?.id as string
    const [adapter] = getSportsAdapters('SportsProviderA')
    let leaguesUpserted = 0
    let eventsUpserted = 0
    let marketsUpserted = 0
    let runnersUpserted = 0
    let skippedMarkets = 0
    const skippedEvents: Array<{ leagueCode: string; leagueName: string; eventCode: string; eventName: string; reason: string }> = []
    const inputLeagueCodes = (args.leagueCodes ?? []) as string[]
    const sportId = String(args.sportId)
    const { getSportById, upsertLeague, upsertEvent, upsertMarket, upsertRunner, createAutoRun, completeAutoRun } = await import('@src/repos/sports/sportsRepo.js')
    const runId = await createAutoRun({ whitelabelId: wl, sportId })

    // Resolve provider sportCode to map league names
    const sport = await getSportById(sportId)
    const sportCode = String(sport?.sportCode ?? '')
    let leagueNameByCode: Record<string, string> = {}
    if (sportCode) {
      const leagues = await adapter.listLeagues({ sportCode })
      leagueNameByCode = Object.fromEntries((leagues || []).map((it: any) => [String(it?.competition?.id ?? ''), String(it?.competition?.name ?? '')]))
    }

    for (const leagueCode of inputLeagueCodes) {
      const events = await adapter.listEvents({ leagueId: String(leagueCode) })
      const leagueName = leagueNameByCode[String(leagueCode)] || String(leagueCode)
      const leagueKey = slugify(leagueName)
      for (const e of (events || [])) {
        const eventCode = String(e?.event?.id ?? '')
        const eventName = String(e?.event?.name ?? '')
        const startTime = e?.event?.openDate ? new Date(e.event.openDate).toISOString() : null
        const markets = await adapter.listMarkets({ eventId: eventCode })
        if (!eventHasAnyAllowedProviderMarket(markets as any[])) {
          skippedEvents.push({ leagueCode: String(leagueCode), leagueName, eventCode, eventName, reason: NO_ALLOWED_MARKETS_REASON })
          continue
        }

        const dbLeagueId = await upsertLeague({
          sportId,
          leagueCode: String(leagueCode),
          key: leagueKey,
          name: leagueName,
        })
        leaguesUpserted++

        const dbEventId = await upsertEvent({
          leagueId: dbLeagueId,
          eventCode,
          key: slugify(eventName),
          name: eventName,
          startTime: startTime ?? null,
        })
        eventsUpserted++

        for (const m of (markets || [])) {
          const marketId = await upsertMarket({
            eventId: dbEventId,
            marketCode: String(m?.marketId ?? ''),
            name: String(m?.marketName ?? 'Market'),
            type: 'match_odds',
          })
          if (!marketId) {
            skippedMarkets++
            continue
          }
          marketsUpserted++
          for (const r of (m?.runners || [])) {
            await upsertRunner({
              marketId,
              selectionCode: String(r?.selectionId ?? ''),
              name: String(r?.runnerName ?? 'Runner'),
              sort: Number(r?.sortPriority ?? 999),
            })
            runnersUpserted++
          }
        }
      }
    }
    try {
      await db.update(sportsAutoConfigsTable)
        .set({ lastRunAt: new Date(), lastRunStatus: 'success', updatedAt: new Date() })
        .where(and(eq(sportsAutoConfigsTable.whitelabelId, wl), eq(sportsAutoConfigsTable.sportId, sportId)))
      await scheduleAutoConfig(wl, sportId)
    } catch {}
    await completeAutoRun({
      runId,
      status: 'success',
      leaguesAdded: leaguesUpserted,
      eventsAdded: eventsUpserted,
      marketsAdded: marketsUpserted,
      runnersAdded: runnersUpserted,
      skippedEventsCount: skippedEvents.length,
      skippedEvents,
    })
    const runEvSkip = skippedEvents.length > 0 ? `. ${skippedEvents.length} events skipped (no Match Odds market)` : ''
    const runMarketSkip = skippedMarkets > 0 ? `. ${skippedMarkets} markets skipped (not in allowlist)` : ''
    const resultRun = { 
      success: true, 
      message: `Auto ingestion completed: ${leaguesUpserted} leagues, ${eventsUpserted} events, ${marketsUpserted} markets, and ${runnersUpserted} runners added${runEvSkip}${runMarketSkip}.`,
      leaguesUpserted, 
      eventsUpserted, 
      marketsUpserted, 
      runnersUpserted, 
      skippedEventsCount: skippedEvents.length, 
      skippedEvents,
      skippedMarketsCount: skippedMarkets,
    }
    try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'runAutoSportsIngestion', resourceType: 'autoRun', resourceId: String(sportId), before: null, after: resultRun }) } catch {}
    return resultRun
  },
  deleteAutoSportsConfig: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string
    await db.delete(sportsAutoConfigsTable)
      .where(and(eq(sportsAutoConfigsTable.whitelabelId, wl), eq(sportsAutoConfigsTable.sportId, String(args.sportId))))
    // Note: existing scheduled job (if any) will noop since row is gone; next schedule won't happen
    try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'deleteAutoSportsConfig', resourceType: 'autoConfig', resourceId: String(args.sportId), before: null, after: null }) } catch {}
    return { success: true, message: 'Auto config deleted' }
  },
  deleteAutoRuns: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string
    await deleteAutoRuns(wl, String(args.sportId))
    try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'deleteAutoRuns', resourceType: 'autoRun', resourceId: String(args.sportId), before: null, after: null }) } catch {}
    return { success: true, message: 'Run history cleared' }
  },
  upsertSportSettings: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string
    const sportIds: string[] = (args?.input?.sportIds || []).map((s: any) => String(s))
    const tierId = args?.input?.tierId ? String(args.input.tierId) : null
    const mode = (String(args?.input?.mode || 'overwrite') as any)
    const {
      exchangeMinStake, exchangeMaxStake,
      bookmakerMinStake, bookmakerMaxStake,
      fancyMinStake, fancyMaxStake,
      exchangeDelay, bookmakerDelay, fancyDelay,
      exchangeCooldown, bookmakerCooldown, fancyCooldown,
      exchangeMinOdds, exchangeMaxOdds,
      exchangeCommission, bookmakerCommission, fancyCommission,
      exchangeExposureDaily, exchangeExposureWeekly, exchangeExposureCap,
      bookmakerExposureDaily, bookmakerExposureWeekly, bookmakerExposureCap,
      fancyExposureDaily, fancyExposureWeekly, fancyExposureCap,
      cashoutActive,
      riskLevel, riskThreshold, volatilityThreshold,
      alertOnBreach, alertChannel, alertRateLimit,
    } = args.input

    // default channel to email if enabling alerts without explicit channel
    const normalizedChannel = (alertOnBreach && (!alertChannel || String(alertChannel).trim() === '')) ? 'email' : alertChannel

    const input = {
      exchangeMinStake, exchangeMaxStake,
      bookmakerMinStake, bookmakerMaxStake,
      fancyMinStake, fancyMaxStake,
      exchangeDelay, bookmakerDelay, fancyDelay,
      exchangeCooldown, bookmakerCooldown, fancyCooldown,
      exchangeMinOdds, exchangeMaxOdds,
      exchangeCommission, bookmakerCommission, fancyCommission,
      exchangeExposureDaily, exchangeExposureWeekly, exchangeExposureCap,
      bookmakerExposureDaily, bookmakerExposureWeekly, bookmakerExposureCap,
      fancyExposureDaily, fancyExposureWeekly, fancyExposureCap,
      cashoutActive,
      riskLevel, riskThreshold, volatilityThreshold,
      alertOnBreach,
      alertChannel: normalizedChannel,
      alertRateLimit,
    }
    // Checked on the row each sport ends up with (the mode can keep stored fields), before any is written.
    const problem = (await sportSettingsAfterUpsert({ whitelabelId: wl, sportIds, tierId, mode, input }))
      .map((row) => sportsLimitsProblem(row))
      .find(Boolean)
    if (problem) return { success: false, message: problem }

    const { affected } = await upsertSportSettings({
      whitelabelId: wl,
      sportIds,
      tierId,
      mode,
      input,
    })
    try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'upsertSportSettings', resourceType: 'sportSettings', resourceId: sportIds.join(','), before: null, after: { tierId: tierId || 'default', mode, affected } }) } catch {}
    return { success: true, message: `Settings applied to ${affected} sport(s)` }
  },
  reorderSports: async (_: any, args: any, ctx: any) => {
    requirePlatformCatalogueAccess(ctx, 'reorderSports')
    const wl = ctx?.whitelabel?.id as string
    const items: Array<{ id: string; sort: number }> = (args?.inputs || []).map((x: any) => ({ id: String(x.id), sort: Number(x.sort) }))
    // Basic validation
    if (!items.length) return { success: false, message: 'No items to reorder' }
    // Nothing is written unless every id is a sport, so an unknown id is not reported as reordered.
    if ((await unknownCatalogueIds(sportsTable, items.map((it) => it.id))).length) return { success: false, message: 'Sport not found' }
    // Update each row (small N expected). For larger N, batch CASE WHEN could be used.
    for (const it of items) {
      await db.update(sportsTable).set({ sort: it.sort, updatedAt: new Date() }).where(eq(sportsTable.id, it.id)) // Global data - no tenant filtering
    }
    try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'reorderSports', resourceType: 'sports', resourceId: 'bulk', before: null, after: { count: items.length } }) } catch {}
    return { success: true, message: 'Sports order updated' }
  },
  upsertLeagueSettings: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string
    const actorId = actorOf(ctx)
    const { leagueIds, input } = args
    // The row is replaced by the input, so the input is what gets checked, before any league is written.
    const problem = sportsLimitsProblem(input ?? {})
    if (problem) return { success: false, message: problem }
    let successCount = 0
    for (const leagueId of leagueIds) {
      const tierId = input.tierId ?? 'default'
      const dataToSave = {
        whitelabelId: wl,
        leagueId,
        tierId,
        exchangeMinStake: input.exchangeMinStake,
        exchangeMaxStake: input.exchangeMaxStake,
        bookmakerMinStake: input.bookmakerMinStake,
        bookmakerMaxStake: input.bookmakerMaxStake,
        fancyMinStake: input.fancyMinStake,
        fancyMaxStake: input.fancyMaxStake,
        exchangeDelay: input.exchangeDelay,
        bookmakerDelay: input.bookmakerDelay,
        fancyDelay: input.fancyDelay,
        exchangeCooldown: input.exchangeCooldown,
        bookmakerCooldown: input.bookmakerCooldown,
        fancyCooldown: input.fancyCooldown,
        exchangeMinOdds: input.exchangeMinOdds,
        exchangeMaxOdds: input.exchangeMaxOdds,
        exchangeCommission: input.exchangeCommission,
        bookmakerCommission: input.bookmakerCommission,
        fancyCommission: input.fancyCommission,
        exchangeExposureDaily: input.exchangeExposureDaily,
        exchangeExposureWeekly: input.exchangeExposureWeekly,
        exchangeExposureCap: input.exchangeExposureCap,
        bookmakerExposureDaily: input.bookmakerExposureDaily,
        bookmakerExposureWeekly: input.bookmakerExposureWeekly,
        bookmakerExposureCap: input.bookmakerExposureCap,
        fancyExposureDaily: input.fancyExposureDaily,
        fancyExposureWeekly: input.fancyExposureWeekly,
        fancyExposureCap: input.fancyExposureCap,
        cashoutActive: input.cashoutActive,
        riskLevel: input.riskLevel,
        riskThreshold: input.riskThreshold,
        volatilityThreshold: input.volatilityThreshold,
        alertOnBreach: input.alertOnBreach,
        alertChannel: input.alertOnBreach ? (input.alertChannel ?? 'email') : null,
        alertRateLimit: input.alertOnBreach ? (input.alertRateLimit ?? 10) : null,
      }
      await upsertLeagueSettingsRepo(dataToSave)
      successCount++
      try {
        await recordAuditDb({ tenant: wl as any, actorId, domain: 'sports', action: 'upsertLeagueSettings', resourceType: 'leagueSettings', resourceId: `${leagueId}-${tierId}`, before: null, after: dataToSave })
      } catch {}
    }
    let message: string
    if (leagueIds.length === 1) {
      // Fetch human-readable league name for nicer toast message
      const row = await db
        .select({ name: sportsLeaguesTable.name })
        .from(sportsLeaguesTable)
        .where(eq(sportsLeaguesTable.id, String(leagueIds[0]))) // Global data - no tenant filtering
      const label = String(row?.[0]?.name ?? leagueIds[0])
      message = `Settings for league ${label} updated successfully.`
    } else {
      message = `Settings for ${successCount} leagues updated successfully.`
    }
    return { success: true, message }
  },
  reorderLeagues: async (_: any, args: any, ctx: any) => {
    requirePlatformCatalogueAccess(ctx, 'reorderLeagues')
    const wl = ctx?.whitelabel?.id as string
    const items: Array<{ id: string; sort: number }> = (args?.inputs || []).map((x: any) => ({ id: String(x.id), sort: Number(x.sort) }))
    // Basic validation
    if (!items.length) return { success: false, message: 'No items to reorder' }
    // Nothing is written unless every id is a league, so an unknown id is not reported as reordered.
    if ((await unknownCatalogueIds(sportsLeaguesTable, items.map((it) => it.id))).length) return { success: false, message: 'League not found' }
    // Update each row (small N expected). For larger N, batch CASE WHEN could be used.
    for (const it of items) {
      await db.update(sportsLeaguesTable).set({ sort: it.sort, updatedAt: new Date() }).where(eq(sportsLeaguesTable.id, it.id)) // Global data - no tenant filtering
    }
    try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'reorderLeagues', resourceType: 'leagues', resourceId: 'bulk', before: null, after: { count: items.length } }) } catch {}
    return { success: true, message: 'Leagues order updated' }
  },
  setLeagueStatus: async (_: any, args: any, ctx: any) => {
    requirePlatformCatalogueAccess(ctx, 'setLeagueStatus')
    const wl = ctx?.whitelabel?.id as string
    const id = String(args.id)
    const status = String(args.status).toLowerCase() === 'active' ? 'active' : 'inactive'
    if (!UUID_PATTERN.test(id)) throw new Error('League not found')
    const updated = await db.update(sportsLeaguesTable).set({ status: status as any, updatedAt: new Date() }).where(eq(sportsLeaguesTable.id, id)).returning({ id: sportsLeaguesTable.id }) // Global data - no tenant filtering
    if (!updated.length) throw new Error('League not found')
    try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'setLeagueStatus', resourceType: 'league', resourceId: id, before: null, after: { status } }) } catch {}
    return true
  },
  upsertEventSettings: async (_: any, args: any, ctx: any) => {
    const wl = ctx?.whitelabel?.id as string
    const { eventIds, input } = args
    // The row is replaced by the input, so the input is what gets checked, before any event is written.
    const problem = sportsLimitsProblem(input ?? {})
    if (problem) return { success: false, message: problem }
    let successCount = 0
    for (const eventId of eventIds) {
      const tierId = input.tierId ?? 'default'
      const dataToSave = {
        whitelabelId: wl,
        eventId,
        tierId,
        exchangeMinStake: input.exchangeMinStake,
        exchangeMaxStake: input.exchangeMaxStake,
        bookmakerMinStake: input.bookmakerMinStake,
        bookmakerMaxStake: input.bookmakerMaxStake,
        fancyMinStake: input.fancyMinStake,
        fancyMaxStake: input.fancyMaxStake,
        exchangeDelay: input.exchangeDelay,
        bookmakerDelay: input.bookmakerDelay,
        fancyDelay: input.fancyDelay,
        exchangeCooldown: input.exchangeCooldown,
        bookmakerCooldown: input.bookmakerCooldown,
        fancyCooldown: input.fancyCooldown,
        exchangeMinOdds: input.exchangeMinOdds,
        exchangeMaxOdds: input.exchangeMaxOdds,
        exchangeCommission: input.exchangeCommission,
        bookmakerCommission: input.bookmakerCommission,
        fancyCommission: input.fancyCommission,
        exchangeExposureDaily: input.exchangeExposureDaily,
        exchangeExposureWeekly: input.exchangeExposureWeekly,
        exchangeExposureCap: input.exchangeExposureCap,
        bookmakerExposureDaily: input.bookmakerExposureDaily,
        bookmakerExposureWeekly: input.bookmakerExposureWeekly,
        bookmakerExposureCap: input.bookmakerExposureCap,
        fancyExposureDaily: input.fancyExposureDaily,
        fancyExposureWeekly: input.fancyExposureWeekly,
        fancyExposureCap: input.fancyExposureCap,
        cashoutActive: input.cashoutActive,
        riskLevel: input.riskLevel,
        riskThreshold: input.riskThreshold,
        volatilityThreshold: input.volatilityThreshold,
        alertOnBreach: input.alertOnBreach,
        alertChannel: input.alertOnBreach ? (input.alertChannel ?? 'email') : null,
        alertRateLimit: input.alertOnBreach ? (input.alertRateLimit ?? 10) : null,
      }
      await upsertEventSettingsRepo(dataToSave)
      successCount++
    }
    let message: string
    if (eventIds.length === 1) {
      // Fetch human-readable event name for nicer toast message
      const row = await db
        .select({ name: sportsEventsTable.name })
        .from(sportsEventsTable)
        .where(eq(sportsEventsTable.id, String(eventIds[0]))) // Global data - no tenant filtering
      const label = String(row?.[0]?.name ?? eventIds[0])
      message = `Settings for event ${label} updated successfully.`
    } else {
      message = `Settings for ${successCount} events updated successfully.`
    }
    return { success: true, message }
  },
  setEventStatus: async (_: any, args: any, ctx: any) => {
    requirePlatformCatalogueAccess(ctx, 'setEventStatus')
    const wl = ctx?.whitelabel?.id as string
    const id = String(args.id)
    const status = String(args.status).toLowerCase() === 'active' ? 'active' : 'inactive'
    if (!UUID_PATTERN.test(id)) throw new Error('Event not found')
    const updated = await db.update(sportsEventsTable).set({ status: status as any, updatedAt: new Date() }).where(eq(sportsEventsTable.id, id)).returning({ id: sportsEventsTable.id }) // Global data - no tenant filtering
    if (!updated.length) throw new Error('Event not found')
    try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'setEventStatus', resourceType: 'event', resourceId: id, before: null, after: { status } }) } catch {}
    return true
  },
  setMarketStatus: async (_: any, args: any, ctx: any) => {
    requirePlatformCatalogueAccess(ctx, 'setMarketStatus')
    const wl = ctx?.whitelabel?.id as string
    const id = String(args.id)
    const status = String(args.status).toLowerCase() === 'active' ? 'active' : 'inactive'
    if (!UUID_PATTERN.test(id)) return { success: false, message: 'Market not found' }
    const updated = await db.update(sportsMarketsTable).set({ status: status as any, updatedAt: new Date() }).where(eq(sportsMarketsTable.id, id)).returning({ id: sportsMarketsTable.id }) // Global data - no tenant filtering
    if (!updated.length) return { success: false, message: 'Market not found' }
    try { await recordAuditDb({ tenant: wl as any, actorId: actorOf(ctx), domain: 'sports', action: 'setMarketStatus', resourceType: 'market', resourceId: id, before: null, after: { status } }) } catch {}
    return { success: true, message: `Market status updated to ${status}` }
  },
  createSportsResult: async (_: any, args: any, ctx: any) => {
    if (ctx?.directorMode === 'whitelabel') {
      return { success: false, message: 'Sports result declare is not allowed in whitelabel mode.' }
    }
    const { createSportsResult: createResult, buildSportsResultContext } = await import('@src/repos/sports/sportsResultsRepo.js')
    const { getSportById } = await import('@src/repos/sports/sportsRepo.js')
    const { settleSportsBetsForResult, settleSportsBetsForResultAllWhitelabels } = await import('@src/services/sports/sportsSettlementService.js')
    const { referralIntegrationService } = await import('@src/services/referrals/referralIntegrationService.js')

    const input = args.input
    const baseCtx = buildSportsResultContext(ctx)
    // A global result settles the market across every whitelabel. It used to be
    // decided by the *absence* of a flag — `ctx.directorMode !== 'whitelabel'` —
    // and `directorMode` is only ever set for a Super Admin. So every ordinary
    // admin and every Whitelabel Admin, who carry no `directorMode` at all, fell
    // into the global branch and settled other brands' bets by declaring a
    // result on their own screen.
    //
    // Reaching across tenants requires platform-wide permission, so that is what
    // is asked. A caller without it takes the tenant-scoped branch below, which
    // already existed and settles only their own whitelabel.
    const isPlatformAdmin = hasPermission(ctx?.permissions ?? [], 'all', '*')
    const isGlobalResult = isPlatformAdmin && ctx?.directorMode !== 'whitelabel'
    const resultCtx = { ...baseCtx, isGlobal: isGlobalResult }

    if (input.marketType === 'bookmaker' || input.marketType === 'fancy') {
      const sport = await getSportById(input.sportId)
      if (!sport || sport.sportCode !== '4') {
        return {
          success: false,
          message: 'Bookmaker and Fancy market types are only available for cricket (sport code 4)'
        }
      }
    }

    try {
      let postBonus: { userId: number; tenant: string; betAmount: number }[] = []
      let postReferral: { tenant: string; userId: number; netRevenue: number; currency: string; betId: string }[] = []
      let settledBetTimestamps: string[] = []

      await db.transaction(async (tx: any) => {
        const result = await createResult(input, resultCtx, tx)
        const resultData = {
          runnerId: input.runnerId,
          selectionName: input.selectionName,
          result: input.result,
        }
        let settlementResult: { betsSettled: number; winners: number; losers: number; voids: number; totalPayout: number; errors: string[]; postBonus?: any[]; postReferral?: any[]; settledBetCreatedTimestamps?: string[] }
        if (result.isGlobal) {
          settlementResult = await settleSportsBetsForResultAllWhitelabels(
            result.id,
            input.marketId,
            input.eventId,
            input.marketType,
            resultData,
            tx
          )
        } else {
          settlementResult = await settleSportsBetsForResult(
            result.id,
            input.marketId,
            input.eventId,
            input.marketType,
            resultData,
            resultCtx.tenant,
            resultCtx.whitelabelId,
            tx
          )
        }

        if (settlementResult.errors.length > 0) {
        }

        if (settlementResult.postBonus?.length) postBonus = settlementResult.postBonus ?? []
        if (settlementResult.postReferral?.length) postReferral = settlementResult.postReferral ?? []
        if (settlementResult.settledBetCreatedTimestamps?.length) settledBetTimestamps = settlementResult.settledBetCreatedTimestamps

        try {
          await recordAuditDb({
            tenant: resultCtx.whitelabelId as any,
            actorId: resultCtx.actorId,
            domain: 'sports',
            action: 'createSportsResult',
            resourceType: 'sports_result',
            resourceId: result.id,
            before: null,
            after: { marketId: input.marketId, marketType: input.marketType, isGlobal: result.isGlobal }
          })
        } catch {}
      })

      for (const { userId, tenant: t, betAmount } of postBonus) {
        try {
          const { updateBonusWagering } = await import('@shared/services/bonusService.js')
          await updateBonusWagering(userId, t, betAmount, 'sports', undefined, 'cash')
        } catch (e: any) {
          // Best-effort by design: a settled bet must not be rolled back because
          // its wagering progress failed. But a silent failure leaves the player's
          // bonus stuck at its old progress with nothing anywhere recording why.
          console.error(
            `[bonusWagering] failed to record sports stake for user ${userId} (${t}), amount ${betAmount}:`,
            e?.message ?? e
          )
        }
      }
      for (const { tenant: t, userId, netRevenue, currency, betId } of postReferral) {
        try {
          await referralIntegrationService.handleBetSettlement(t, userId, netRevenue, currency as any, 'sports', betId)
        } catch (e: any) {
        }
      }

      // Regenerate snapshots for past dates whose bets were just settled
      // (today's data is always live — only past-day snapshots become stale)
      try {
        if (settledBetTimestamps.length > 0) {
          const { DateTime } = await import('luxon')
          const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js')
          const tz = await getWhitelabelTimezone(resultCtx.tenant).catch(() => 'Asia/Kolkata')
          const todayStr = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd')

          const pastDateSet = new Set<string>()
          for (const iso of settledBetTimestamps) {
            const dateStr = DateTime.fromISO(iso).setZone(tz).toFormat('yyyy-MM-dd')
            if (dateStr < todayStr) pastDateSet.add(dateStr)
          }

          if (pastDateSet.size > 0) {
            const { regenerateSnapshotsForDateAfterRollback } = await import('@/services/reportingSnapshotService.js')

            let whitelabels: { id: string }[] | undefined
            if (isGlobalResult) {
              const { listWhitelabelsDb } = await import('@src/repos/common/whitelabelRepo.js')
              whitelabels = await listWhitelabelsDb()
            }

            for (const dateStr of pastDateSet) {
              const affectedDate = new Date(dateStr + 'T00:00:00Z')
              if (whitelabels) {
                for (const wl of whitelabels) {
                  await regenerateSnapshotsForDateAfterRollback(wl.id, wl.id, affectedDate, 'sports').catch(() => {})
                }
              } else {
                await regenerateSnapshotsForDateAfterRollback(resultCtx.tenant, resultCtx.whitelabelId, affectedDate, 'sports').catch(() => {})
              }
            }
          }
        }
      } catch (_snapshotErr) {
        // Non-critical: result was declared successfully, snapshot regen is best-effort
      }

      return {
        success: true,
        message: 'Sports result created successfully'
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to create sports result'
      }
    }
  },
  rollbackSportsResult: async (_: any, args: any, ctx: any) => {
    if (ctx?.directorMode === 'whitelabel') {
      return { success: false, message: 'Sports result rollback is not allowed in whitelabel mode.' }
    }
    const { rollbackSportsResult: rollbackResult, buildSportsResultContext, getSportsResultById } = await import('@src/repos/sports/sportsResultsRepo.js')
    const { reverseSportsBetSettlements } = await import('@src/services/sports/sportsSettlementService.js')

    const input = args.input
    const resultCtx = buildSportsResultContext(ctx)

    try {
      let resultBefore = await getSportsResultById(input.id, resultCtx.tenant, resultCtx.whitelabelId)
      if (!resultBefore) {
        // The tenant-scoped lookup found nothing, and the fallback below is
        // deliberately unscoped — `byIdOnly`. That is how a global result,
        // which belongs to no single whitelabel, is reached for rollback. It is
        // also how a caller reached ANOTHER brand's result and reversed its
        // settlements, because a global rollback runs across every whitelabel.
        //
        // Declaring a global result now requires platform permission
        // (`createSportsResult`); reversing one requires the same.
        if (!hasPermission(ctx?.permissions ?? [], 'all', '*')) {
          return { success: false, message: 'Result not found' }
        }
        resultBefore = await getSportsResultById(input.id, '', '', { byIdOnly: true })
      }
      if (!resultBefore) {
        return {
          success: false,
          message: 'Result not found'
        }
      }
      const isGlobal = Boolean((resultBefore as any).isGlobal)

      // Rollback the result
      const result = await rollbackResult(input, resultCtx)

      // Reverse all settlements for this result (all whitelabels when global)
      try {
        const reversalResult = await reverseSportsBetSettlements(
          input.id,
          resultBefore.marketId,
          resultBefore.eventId,
          resultCtx.tenant,
          resultCtx.whitelabelId,
          isGlobal ? { isGlobal: true } : undefined
        )

        if (reversalResult.errors.length > 0) {
        }
      } catch (reversalError: any) {
      }

      try {
        await recordAuditDb({
          tenant: resultCtx.whitelabelId as any,
          actorId: resultCtx.actorId,
          domain: 'sports',
          action: 'rollbackSportsResult',
          resourceType: 'sports_result',
          resourceId: input.id,
          before: null,
          after: { rolledBackAt: result.rolledBackAt, reason: input.reason }
        })
      } catch {}

      const affectedDate = resultBefore.declaredAt ? new Date(resultBefore.declaredAt) : new Date()
      try {
        const { regenerateSnapshotsForDateAfterRollback } = await import('@/services/reportingSnapshotService.js')
        if (isGlobal) {
          const { listWhitelabelsDb } = await import('@src/repos/common/whitelabelRepo.js')
          const whitelabels = await listWhitelabelsDb()
          for (const wl of whitelabels) {
            await regenerateSnapshotsForDateAfterRollback(wl.id, wl.id, affectedDate, 'sports')
          }
        } else {
          await regenerateSnapshotsForDateAfterRollback(resultCtx.tenant, resultCtx.whitelabelId, affectedDate, 'sports')
        }
      } catch (snapshotErr: any) {
      }

      return {
        success: true,
        message: 'Sports result rolled back successfully'
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to rollback sports result'
      }
    }
  },
  upsertSportsAutoResultsSettings: async (_: any, args: any, ctx: any) => {
    const { upsertSportsAutoResultsSettings: upsertSettings, buildSportsAutoResultsContext } = await import('@src/repos/sports/sportsAutoResultsRepo.js')
    const resultCtx = buildSportsAutoResultsContext(ctx)
    
    try {
      await upsertSettings(args.input, resultCtx)
      return {
        success: true,
        message: 'Auto results settings saved successfully'
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to save auto results settings'
      }
    }
  },
  toggleAutoResultMarketType: async (_: any, args: any, ctx: any) => {
    const { toggleAutoResultMarketType: toggleMarketType, buildSportsAutoResultsContext } = await import('@src/repos/sports/sportsAutoResultsRepo.js')
    const resultCtx = buildSportsAutoResultsContext(ctx)
    
    try {
      await toggleMarketType(args.input.id, args.input.marketType, args.input.enabled, resultCtx)
      return {
        success: true,
        message: 'Market type toggled successfully'
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to toggle market type'
      }
    }
  },
  deleteSportsAutoResultsSettings: async (_: any, args: any, ctx: any) => {
    const { deleteSportsAutoResultsSettings: deleteSettings, buildSportsAutoResultsContext } = await import('@src/repos/sports/sportsAutoResultsRepo.js')
    const resultCtx = buildSportsAutoResultsContext(ctx)
    
    try {
      await deleteSettings(args.id, resultCtx.tenant, resultCtx.whitelabelId)
      return {
        success: true,
        message: 'Auto results settings deleted successfully'
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to delete auto results settings'
      }
    }
  },
  upsertEventRiskConfig: async (_: any, args: any, ctx: any) => {
    // Block agents from accessing risk config
    if (ctx?.user?.type === 'agent') {
      throw new Error('Agents are not allowed to modify risk configuration');
    }
    
    // Get whitelabel ID from context
    // Note: ctx.whitelabel.id can be 'default' if fallback whitelabel is used
    const wl = ctx?.whitelabel?.id;
    const tenant = ctx?.tenant || 'default';
    const eventId = String(args.input.eventId);
    
    // If whitelabel ID is not available, throw error
    if (!wl) {
      throw new Error('Whitelabel ID is required');
    }
    
    // Validate weights sum to 100 if provided
    if (args.input.weights) {
      const weights = args.input.weights;
      const sum = (weights.liability || 0) + (weights.exposure || 0) + (weights.volume || 0) + (weights.odds || 0);
      if (sum !== 100) {
        throw new Error('Risk weights must sum to 100');
      }
    }
    
    const config = await upsertRiskConfig({
      tenant,
      whitelabelId: wl,
      eventId,
      percentiles: args.input.percentiles || undefined,
      weights: args.input.weights || undefined,
      amounts: args.input.amounts || undefined,
      alerts: args.input.alerts || undefined,
    });
    
    return {
      id: config.id,
      eventId: config.eventId,
      percentiles: config.percentiles,
      weights: config.weights,
      amounts: config.amounts,
      alerts: config.alerts,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    };
  },
  // Automation & Pattern Management
  upsertAutomationRule: async (_: any, args: any, ctx: any) => {
    // Block agents from accessing automation rules
    if (ctx?.user?.type === 'agent') {
      throw new Error('Agents are not allowed to modify automation rules');
    }
    
    const { upsertAutomationRule } = await import("@src/repos/sports/automationRulesRepo.js");
    const tenant = ctx?.tenant || 'default';
    const whitelabelId = ctx?.whitelabel?.id || 'default';
    
    await upsertAutomationRule({
      tenant,
      whitelabelId,
      eventId: args.input.eventId || null,
      ruleType: args.input.ruleType,
      config: args.input.config,
      enabled: args.input.enabled !== undefined ? args.input.enabled : true,
      priority: args.input.priority || 0,
    });
    
    return {
      success: true,
      message: 'Automation rule saved successfully',
    };
  },
  deleteAutomationRule: async (_: any, args: any, ctx: any) => {
    // Block agents from accessing automation rules
    if (ctx?.user?.type === 'agent') {
      throw new Error('Agents are not allowed to delete automation rules');
    }
    
    const { deleteAutomationRule } = await import("@src/repos/sports/automationRulesRepo.js");
    // The caller's own rules only: the tenant and whitelabel automationRules
    // lists and upsertAutomationRule writes. The id alone reached any brand.
    const tenant = ctx?.tenant || 'default';
    const whitelabelId = ctx?.whitelabel?.id || 'default';

    const deleted = await deleteAutomationRule(args.id, tenant, whitelabelId);

    return {
      success: deleted,
      message: deleted ? 'Automation rule deleted successfully' : 'Rule not found',
    };
  },
  voidBet: async (_: any, args: any, ctx: any) => {
    // Block agents from voiding bets
    if (ctx?.user?.type === 'agent') {
      throw new Error('Agents are not allowed to void bets');
    }
    
    const { voidBetWithRefund } = await import("@src/repos/sports/sportsBetsRepo.js");
    const { recordAuditDb } = await import("@src/repos/audit/auditRepo.js");
    const tenant = ctx?.tenant || 'default';
    try {
      await voidBetWithRefund(args.betId, args.reason, tenant);
      try {
        await recordAuditDb({
          tenant,
          actorId: String(ctx?.user?.sub ?? ctx?.user?.id ?? 'system'),
          domain: 'sports',
          action: 'void_bet',
          resourceType: 'bet',
          resourceId: args.betId,
          before: null,
          after: { reason: args.reason },
        });
      } catch {}
      return { success: true, message: `Bet voided and amount credited to wallet: ${args.reason}` };
    } catch (err: any) {
      return { success: false, message: err?.message ?? 'Failed to void bet' };
    }
  },
  cancelBet: async (_: any, args: any, ctx: any) => {
    // Block agents from cancelling/invalidating bets
    if (ctx?.user?.type === 'agent') {
      throw new Error('Agents are not allowed to cancel/invalidate bets');
    }
    
    const { cancelBet: cancelBetRepo } = await import("@src/repos/sports/sportsBetsRepo.js");
    const { recordAuditDb } = await import("@src/repos/audit/auditRepo.js");
    
    const tenant = ctx?.tenant || 'default';
    // `ctx.user` carries the admin id as `sub`; `id` is never set, so every
    // cancellation was recorded as having been made by 'system'.
    const cancelledBy = String(ctx?.user?.sub ?? ctx?.user?.id ?? 'system');
    
    try {
      await cancelBetRepo(args.betId, args.reason, cancelledBy, tenant);
      try {
        await recordAuditDb({
          tenant,
          actorId: cancelledBy,
          domain: 'sports',
          action: 'cancel_bet',
          resourceType: 'bet',
          resourceId: args.betId,
          before: null,
          after: { reason: args.reason },
        });
      } catch {}
      return {
        success: true,
        message: `Bet cancelled and amount credited to wallet: ${args.reason}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message ?? 'Failed to cancel bet',
      };
    }
  },
  flagPlayer: async (_: any, args: any, ctx: any) => {
    // Block agents from flagging players, as from every other risk write
    if (ctx?.user?.type === 'agent') {
      throw new Error('Agents are not allowed to flag players');
    }

    const { recordAuditDb } = await import("@src/repos/audit/auditRepo.js");
    const { db } = await import("@src/db/client.js");
    const { users } = await import("@shared/db/schema.js");
    const { and, eq } = await import("drizzle-orm");

    const tenant = ctx?.tenant || 'default';
    const userId = Number(args.userId);
    // `ctx.user` carries the admin id as `sub` (see cancelBet); `id` is never
    // set, so every flag was recorded as set by 'system'.
    const actorId = String(ctx?.user?.sub ?? ctx?.user?.id ?? 'system');
    const now = new Date().toISOString();

    if (!Number.isInteger(userId) || userId <= 0 || userId > 2147483647) {
      return {
        success: false,
        message: 'Invalid user ID',
      };
    }
    // The player must belong to the caller's own tenant, the scope
    // sportsPlayerProfile reads with. This matched the id alone, and player ids
    // are sequential, so an admin of one whitelabel could flag every player of
    // every other one; an id that matched nobody also answered success.
    const ownPlayer = and(eq(users.id, userId), eq(users.tenant, tenant));

    try {
      // Get current flags from user
      const userRows = await db
        .select({ flags: users.flags, tenant: users.tenant })
        .from(users)
        .where(ownPlayer)
        .limit(1);

      if (userRows.length === 0) {
        return {
          success: false,
          message: 'Player not found',
        };
      }

      const currentFlags: Array<{ flag: string; reason: string; setBy: string; setAt: string }> =
        (userRows[0]?.flags as any) || [];
      
      // Check if flag already exists
      const flagExists = currentFlags.some(f => f.flag === args.flag);
      
      if (!flagExists) {
        // Add new flag
        const newFlag = {
          flag: args.flag,
          reason: args.reason || '',
          setBy: actorId,
          setAt: now,
        };
        
        const updatedFlags = [...currentFlags, newFlag];

        // Update user flags in database
        await db
          .update(users)
          .set({ flags: updatedFlags as any })
          .where(ownPlayer);
      }

      // Record audit log, in the player's own tenant
      await recordAuditDb({
        tenant: userRows[0].tenant || tenant,
        actorId,
        domain: 'players',
        action: 'flag_player',
        resourceType: 'player',
        resourceId: args.userId,
        before: null,
        after: { flag: args.flag, reason: args.reason },
      });
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to flag player: ${error.message}`,
      };
    }
    
    return {
      success: true,
      message: `Player flagged: ${args.flag}`,
    };
  },
  unflagPlayer: async (_: any, args: any, ctx: any) => {
    // Block agents from unflagging players, as from every other risk write
    if (ctx?.user?.type === 'agent') {
      throw new Error('Agents are not allowed to unflag players');
    }

    const { recordAuditDb } = await import("@src/repos/audit/auditRepo.js");
    const { db } = await import("@src/db/client.js");
    const { users } = await import("@shared/db/schema.js");
    const { and, eq } = await import("drizzle-orm");

    const tenant = ctx?.tenant || 'default';
    const userId = Number(args.userId);
    // The admin id is `sub`, as in flagPlayer.
    const actorId = String(ctx?.user?.sub ?? ctx?.user?.id ?? 'system');

    // Validate inputs
    if (!args.userId || !Number.isInteger(userId) || userId <= 0 || userId > 2147483647) {
      return {
        success: false,
        message: 'Invalid user ID',
      };
    }

    if (!args.flag || typeof args.flag !== 'string' || args.flag.trim().length === 0) {
      return {
        success: false,
        message: 'Invalid flag name',
      };
    }
    // The caller's own tenant only, as in flagPlayer.
    const ownPlayer = and(eq(users.id, userId), eq(users.tenant, tenant));

    try {
      // Get current flags from user
      const userRows = await db
        .select({ flags: users.flags, tenant: users.tenant })
        .from(users)
        .where(ownPlayer)
        .limit(1);

      if (userRows.length === 0) {
        return {
          success: false,
          message: 'Player not found',
        };
      }
      
      const currentFlags: Array<{ flag: string; reason: string; setBy: string; setAt: string }> = 
        (userRows[0]?.flags as any) || [];
      
      // Check if flag exists
      const flagExists = currentFlags.some(f => f.flag === args.flag);
      if (!flagExists) {
        return {
          success: false,
          message: `Flag "${args.flag}" not found for this player`,
        };
      }
      
      // Remove the specified flag
      const updatedFlags = currentFlags.filter(f => f.flag !== args.flag);
      
      // Update user flags in database
      await db
        .update(users)
        .set({ flags: updatedFlags as any })
        .where(ownPlayer);

      // Record audit log, in the player's own tenant
      await recordAuditDb({
        tenant: userRows[0].tenant || tenant,
        actorId,
        domain: 'players',
        action: 'unflag_player',
        resourceType: 'player',
        resourceId: args.userId,
        before: { flag: args.flag },
        after: null,
      });
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to unflag player: ${error.message}`,
      };
    }
    
    return {
      success: true,
      message: `Player flag removed: ${args.flag}`,
    };
  },
  dismissPattern: async (_: any, args: any, ctx: any) => {
    // Block agents from dismissing patterns, as from every other risk write
    if (ctx?.user?.type === 'agent') {
      throw new Error('Agents are not allowed to dismiss betting patterns');
    }

    const { updatePatternStatus } = await import("@src/repos/sports/bettingPatternsRepo.js");
    // A pattern of the caller's own tenant and whitelabel, as bettingPatterns lists them.
    const tenant = ctx?.tenant || 'default';
    const whitelabelId = ctx?.whitelabel?.id || 'default';

    const updated = await updatePatternStatus(args.patternId, 'DISMISSED', args.reason, { tenant, whitelabelId });
    if (!updated) {
      return {
        success: false,
        message: 'Pattern not found',
      };
    }

    return {
      success: true,
      message: 'Pattern dismissed',
    };
  },
}
