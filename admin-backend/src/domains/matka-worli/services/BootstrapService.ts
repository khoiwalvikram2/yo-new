import { matkaSchedule } from '@shared/matka/schedule.js'
import { getActiveRulesVersionDb } from '@/repos/matka/matkaBidRulesRepo.js'
import { upsertWorliInstance } from '@/repos/matka-worli/worliInstancesRepo.js'
import { listActiveMatkasDb } from '@/repos/matka/matkaRepo.js'

export async function ensureTodayWorliInstancesForActiveMatkas(tenant = 'default') {
  const markets = await listActiveMatkasDb(tenant)
  for (const market of markets) {
    const schedule = matkaSchedule({ ...market, status: 'active' })
    if (!schedule.operatingDay) continue
    const version = await getActiveRulesVersionDb(market.id, tenant)
    for (const side of ['open', 'close'] as const) {
      const session = schedule[side]
      if (!session.enabled) continue
      await upsertWorliInstance({ marketId: market.id, runDate: schedule.runDate, side: side === 'open' ? 'OPEN' : 'CLOSE',
        scheduledOpenAtUtc: new Date(session.startsAt), scheduledLockAtUtc: new Date(session.lockAt),
        scheduledCloseAtUtc: new Date(session.resultAt), bidRulesVersionId: version?.versionId ?? null })
    }
  }
}
