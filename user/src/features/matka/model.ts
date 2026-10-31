import type { MatkaBet, MatkaMarket, MatkaResult, MatkaSession } from '@/lib/api/matka'
import { gameTypes } from './kit/market-data.js'
import { matkaMarketResult } from './marketDisplay'

export type MatkaGame = { id: string; label: string; short: string; description: string; digits?: number; base?: string; closeOnly?: boolean; bulk?: boolean; motor?: boolean; combined?: boolean; combination?: boolean; group: string; icon: string; accent: string; sessions?: string[]; rateConfigured?: boolean; rateDisplay?: string }
const panaBids = ['SINGLE_PANNA', 'DOUBLE_PANNA', 'TRIPLE_PANNA']
const marketBids: Record<MatkaMarket['kind'], string[]> = {
  WORLI: ['SINGLE', 'JODI', ...panaBids, 'HALF_SANGAM', 'FULL_SANGAM'],
  STARLINE: ['SINGLE', ...panaBids],
  JACKPOT: ['JODI'],
  SATTA_MATKA: ['AB', 'A', 'B'],
}
export function gameBid(id: string, selection = ''): string {
  const base = id.replace(/-bulk$/, '')
  if (base === 'sp-dp-tp') return new Set(selection).size === 1 ? 'TRIPLE_PANNA' : new Set(selection).size === 2 ? 'DOUBLE_PANNA' : 'SINGLE_PANNA'
  return ({ single: 'SINGLE', jodi: 'JODI', 'single-patti': 'SINGLE_PANNA', 'sp-motor': 'SINGLE_PANNA', 'double-patti': 'DOUBLE_PANNA', 'dp-motor': 'DOUBLE_PANNA', 'triple-patti': 'TRIPLE_PANNA', 'half-sangam': 'HALF_SANGAM', 'full-sangam': 'FULL_SANGAM', ab: 'AB', a: 'A', b: 'B' } as Record<string, string>)[base] || ''
}
export function matkaChartRange(runDate: string) {
  const today = new Date(`${runDate}T12:00:00Z`), monday = new Date(today)
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
  const first = new Date(monday); first.setUTCDate(first.getUTCDate() - 49)
  return { from: first.toISOString().slice(0, 10), to: runDate }
}
export function asKitMarket(market: MatkaMarket, history: MatkaResult[] = [], options: Array<{ id: string; code: string; name: string }> = []) {
  const validRates = market.rates.filter(rate => Number.isFinite(rate.payoutMultiplier) && rate.payoutMultiplier > 0)
  const rates = new Set(validRates.map(rate => rate.bidType))
  const requiredBids = (game: MatkaGame) => game.combined ? panaBids : [gameBid(game.id)]
  // Market kind defines the catalogue; configured rates determine whether entries are enabled.
  const games = (gameTypes as MatkaGame[]).filter(game => requiredBids(game).every(bid => marketBids[market.kind].includes(bid)))
    .map(game => {
      const bids = requiredBids(game), rateConfigured = bids.every(bid => rates.has(bid))
      return { ...game, rateConfigured,
        rateDisplay: rateConfigured ? validRates.filter(rate => bids.includes(rate.bidType)).map(rate => `${rate.label} 1:${rate.payoutMultiplier}`).join(' / ') : 'Payout rate pending',
        sessions: market.kind === 'STARLINE' ? ['Open'] : game.closeOnly || ['JACKPOT', 'SATTA_MATKA'].includes(market.kind) ? ['Close'] : ['Open', 'Close'],
      }
    })
  const sessionTime = (side: MatkaSession, field: 'resultAt' | 'lockAt') => {
    const session = market.sessions.find(session => session.side === side)
    return session?.enabled ? new Date(session[field]).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: market.timezone }) : '—'
  }
  const raw = market.result
  return { ...market, rawResult: raw, result: matkaMarketResult(market), games, history, options,
    category: ({ WORLI: 'Worli', STARLINE: 'Starline', JACKPOT: 'Jackpot', SATTA_MATKA: 'Satta Matka' } as const)[market.kind],
    initials: market.name.split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase(), tone: 'orange', tag: market.featured ? 'Featured' : '',
    timezoneLabel: /Asia\/(Kolkata|Calcutta)/.test(market.timezone) ? 'IST' : market.timezone,
    open: sessionTime('OPEN', 'resultAt'), openBidLast: sessionTime('OPEN', 'lockAt'), close: sessionTime('CLOSE', 'resultAt'), closeBidLast: sessionTime('CLOSE', 'lockAt'),
    accepts(game: MatkaGame, session: string) {
      const bid = gameBid(game.id), combined = market.kind === 'WORLI' && ['JODI', 'HALF_SANGAM', 'FULL_SANGAM'].includes(bid)
      const configured = games.find(item => item.id === game.id)
      return !!configured?.rateConfigured && configured.sessions.includes(session) && !!market.sessions.find(item => item.enabled && item.side === (combined ? 'OPEN' : session.toUpperCase()))?.accepting
    },
  }
}
export type KitMarket = ReturnType<typeof asKitMarket>
export function asKitEntry(entry: MatkaBet, timezone: string) {
  return { ...entry, game: entry.bidType.replaceAll('_', ' '), number: entry.selection.replace('-', ' / '), amount: entry.amount,
    session: entry.session === 'OPEN' ? 'Open' : 'Close', date: entry.runDate,
    timezoneLabel: /Asia\/(Kolkata|Calcutta)/.test(timezone) ? 'IST' : timezone,
    time: new Date(entry.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: timezone }),
    status: ({ active: 'Pending', pending: 'Pending', won: 'Won', lost: 'Lost', void: 'Void', cancelled: 'Cancelled' } as Record<string, string>)[entry.status] || entry.status,
  }
}
