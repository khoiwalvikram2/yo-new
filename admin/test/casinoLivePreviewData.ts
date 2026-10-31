import type { Operation } from '@apollo/client'
import type { CasinoBet, CasinoDashboard } from '../src/routes/casino/live-analysis/casinoLiveModel'

export const casinoBetsFixture: CasinoBet[] = Array.from({ length: 24 }, (_, index) => ({
  id: `bet-${index}`, userId: index % 3 + 1, userName: ['Asha', 'Ravi', 'Mina'][index % 3],
  gameId: `game-${index % 7}`, gameName: ['Roulette', 'Dragon Tiger', 'Blackjack', 'Lightning Roulette', 'Baccarat', 'Poker', 'Sweet Bonanza'][index % 7],
  providerId: 'provider-one', vendorId: `vendor-${index % 5}`, vendorName: ['Evolution', 'Ezugi', 'Pragmatic', 'Playtech', 'NetEnt'][index % 5],
  stake: index === 0 ? 100 : 10 + index * 25, payout: index === 0 ? 2000 : index % 2 ? 0 : 100,
  winAmount: index === 0 ? 1900 : 0, netAmount: index === 0 ? 1900 : index % 2 ? -(10 + index * 25) : 100 - (10 + index * 25),
  status: index === 0 ? 'won' : index % 2 ? 'lost' : 'won', currency: 'INR', transactionId: `txn-reference-${index}`,
  createdAt: new Date(Date.now() - index * 10000).toISOString(), settledAt: new Date(Date.now() - index * 5000).toISOString(),
}))
export const casinoDashboardFixture: CasinoDashboard = {
  kpis: { at: new Date().toISOString(), betsPerMin: 20, wagered: 10000, payouts: 9000, ggr: 1000, rtp: 90, activePlayers: 3 },
  breakdown: {
    byGame: Array.from({ length: 7 }, (_, index) => ({ gameId: `game-${index}`, gameName: ['Roulette', 'Dragon Tiger', 'Blackjack', 'Lightning Roulette', 'Baccarat', 'Poker', 'Sweet Bonanza'][index], wagered: 2000 - index * 150, payouts: 1500 - index * 125, ggr: 500 - index * 25, bets: 40 - index * 3, thumbnailUrl: null })),
    byProvider: [{ providerId: 'provider-one', providerName: 'Casino Provider', wagered: 10000, payouts: 9000, ggr: 1000, bets: 120 }],
    byVendor: Array.from({ length: 5 }, (_, index) => ({ vendorId: `vendor-${index}`, vendorName: ['Evolution', 'Ezugi', 'Pragmatic', 'Playtech', 'NetEnt'][index], wagered: 3000 - index * 250, payouts: 2200 - index * 200, ggr: 800 - index * 50, bets: 30 - index * 3 })),
  },
}
export function casinoFixtureResponse(operation: Operation, empty = false) {
  const name = operation.operationName
  if (name === 'CasinoLiveDashboard') return { data: { casinoLiveDashboard: empty ? { ...casinoDashboardFixture, breakdown: { byGame: [], byProvider: [], byVendor: [] } } : casinoDashboardFixture } }
  if (name === 'CasinoPlayerEvents') return { data: { casinoPlayerEvents: { id: 'event-1', userId: '1', userName: 'Asha', gameId: 'game-0', gameName: 'Roulette', vendorName: 'Evolution', stake: 100, payout: 2000, status: 'won', at: new Date().toISOString() } } }
  if (name === 'CasinoLiveBetsPage') {
    const f=operation.variables.filters || {}, all=empty ? [] : casinoBetsFixture;
    const rows=all.filter(row=>(!f.status || (Array.isArray(f.status) ? f.status.includes(row.status) : row.status===f.status)) && (!f.vendorName || row.vendorName===f.vendorName) && (!f.gameName || row.gameName===f.gameName) && (f.stakeMin==null || row.stake>=f.stakeMin) && (f.stakeMax==null || row.stake<=f.stakeMax) && (!f.search || [row.userName,row.gameName,row.vendorName,row.transactionId].some(v=>String(v).toLowerCase().includes(f.search.toLowerCase()))));
    return { data: { betsPage: { total:rows.length, items:rows.map(row=>({...row,__typename:'CasinoBet'})).slice(operation.variables.offset ?? 0,(operation.variables.offset ?? 0)+(operation.variables.limit ?? 20)) }, betsFilterOptions: {vendorNames:[...new Set(all.map(r=>r.vendorName))],gameNames:[...new Set(all.map(r=>r.gameName))]} } };
  }
  if (name === 'CasinoBets'  || name === 'RecentCasinoBets') {
    const query = operation.variables.query || {}
    const bets = empty ? [] : casinoBetsFixture.filter(bet => !query.status || bet.status === query.status)
    return { data: { casinoBets: bets.slice(0, Number(query.limit) || 1000) } }
  }
  if (name === 'Users') return { data: { users: empty ? [] : [1, 2, 3].map(id => ({ id, createdAt: '2026-01-01T00:00:00Z', vipTierName: id === 1 ? 'Gold' : 'Silver', status: 'ACTIVE' })) } }
  if (name === 'CasinoApiProviders') return { data: { casinoApiProviders: [{ id: 'provider-one', key: 'casino', name: 'Casino Provider', status: 'ACTIVE', lastSyncAt: null }] } }
  if (name === 'CasinoGames') return { data: { casinoGames: { items: [{ id: 'game-0', name: 'Roulette', slug: 'roulette', mainCategory: 'CASINO', vendorId: 'vendor-0', vendorName: 'Evolution', thumbnailUrl: null, rtp: 95, demoUrl: null, betSettingsCount: 0, isActive: true, tenantEnabled: true, premiumOnly: false, order: 0, featured: false, categoryAssigned: true, limits: null, updatedAt: new Date().toISOString() }], page: 1, pageSize: 20, total: 1 } } }
  if (name === 'CreateTestCasinoBet') return { data: { createTestCasinoBet: { ...casinoBetsFixture[0], id: 'test-created', status: 'pending', ...operation.variables.input } } }
  if (name === 'SettleTestCasinoBet') return { data: { settleTestCasinoBet: { id: operation.variables.id, status: operation.variables.status, payout: operation.variables.payout, settledAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } }
  throw new Error(`Unmapped Casino preview operation: ${name}`)
}
