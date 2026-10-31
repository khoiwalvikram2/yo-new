import type { LiveEmitter } from '@src/realtime/agentScopedLive.js'
import type { SportsLiveDashboard } from './LiveAnalyticsService.js'
import { createSnapshotStream } from '@src/realtime/snapshotStream.js'

interface SportsDashboardStreamOptions {
  emitter: LiveEmitter
  topic: string
  compute: () => Promise<SportsLiveDashboard>
  intervalMs?: number
}
type Frame = { sportsLiveDashboard: SportsLiveDashboard }

/** Admin raw-emitter fallback: deliver an initial snapshot directly, then live updates and safety refreshes. */
export function createSportsDashboardStream({ emitter, topic, compute, intervalMs = 60000 }: SportsDashboardStreamOptions): AsyncIterableIterator<Frame> {
  return createSnapshotStream({
    emitter, topic, compute, intervalMs,
    extract: message => message?.payload?.sportsLiveDashboard ?? message?.sportsLiveDashboard ?? message,
    wrap: snapshot => ({ sportsLiveDashboard: snapshot }),
  })
}
