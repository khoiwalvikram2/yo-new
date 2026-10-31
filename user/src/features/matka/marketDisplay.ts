import type { MatkaMarket, MatkaSession } from '@/lib/api/matka'

export function matkaMarketResult(market: MatkaMarket): string {
  const result = market.result
  const center = market.kind === 'WORLI'
    ? `${result.openDigit ?? '*'}${result.closeDigit ?? '*'}`
    : market.kind === 'STARLINE' ? result.openDigit ?? '*' : result.jodi ?? '**'
  return `${result.openResult || '***'} – ${center} – ${result.closeResult || '***'}`
}

export function hasMatkaResult(market: MatkaMarket): boolean {
  return [market.result.openResult, market.result.closeResult, market.result.openDigit, market.result.closeDigit, market.result.jodi]
    .some(value => value !== null && value !== undefined && value !== '')
}

export function matkaCutoff(market: MatkaMarket, side: MatkaSession, locale = 'en'): string {
  const session = market.sessions.find(session => session.side === side && session.enabled)
  if (!session || !Number.isFinite(Date.parse(session.lockAt))) return '—'
  try {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: market.timezone }).format(new Date(session.lockAt))
  } catch { return '—' }
}
