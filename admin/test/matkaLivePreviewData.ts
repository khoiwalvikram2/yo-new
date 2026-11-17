import type { FetchResult, Operation } from '@apollo/client'
import type { SelectionSetNode } from 'graphql'
import type { MatkaBet, MatkaDashboard } from '../src/routes/matka/live-analysis/liveUiModel'
const stamp = Date.now()
export const matkaBetsFixture: MatkaBet[] = Array.from({ length: 52 }, (_, index) => ({
  id: `matka-bet-${index}`, userId: index % 4 + 1, userName: ['Asha Sharma', 'Ravi Kumar', 'Mina Singh', 'Dev Patel'][index % 4],
  matkaId: `matka-${index % 7}`, matkaName: ['Kalyan', 'Main Bazar', 'Milan Day', 'Milan Night', 'Rajdhani', 'Starline', 'Jackpot'][index % 7],
  matkaType: index % 2 ? 'worli' : 'starline', marketName: index % 2 ? 'OPEN' : 'CLOSE', marketSession: index % 2 ? 'open' : 'close',
  bidType: index % 3 ? 'single' : 'double', betNumbers: String(index % 10), betAmount: 100 + index * 10, potentialWin: 900 + index * 90,
  actualWin: index >= 40 ? 1000 : null, payoutMultiplier: 9, status: index < 30 ? 'pending' : index < 40 ? 'active' : index < 46 ? 'won' : 'lost', currency: 'INR', createdAt: new Date(stamp - index * 60000).toISOString(),
}))
export const matkaDashboardFixture: MatkaDashboard = {
  kpis: { at: new Date(stamp).toISOString(), betsPerMin: 20, wagered: 10000, payouts: 9500, ggr: 500, rtp: 95, potentialPayouts: 90000, activePlayers: 4 },
  breakdown: {
    byMatka: Array.from({ length: 7 }, (_, i) => ({ matkaId: `matka-${i}`, matkaName: ['Kalyan', 'Main Bazar', 'Milan Day', 'Milan Night', 'Rajdhani', 'Starline', 'Jackpot'][i], wagered: 2000 - i * 150, payouts: 1800 - i * 140, ggr: 200 - i * 10, bets: 30 - i * 2 })),
    byType: [{ matkaType: 'worli', wagered: 6000, payouts: 5500, ggr: 500, bets: 30 }, { matkaType: 'starline', wagered: 4000, payouts: 4000, ggr: 0, bets: 20 }],
    byMarket: [{ marketName: 'OPEN', wagered: 6000, payouts: 5500, ggr: 500, bets: 30 }, { marketName: 'CLOSE', wagered: 4000, payouts: 4000, ggr: 0, bets: 20 }],
    byBidType: [{ bidType: 'single', wagered: 7000, payouts: 6500, ggr: 500, bets: 35 }, { bidType: 'double', wagered: 3000, payouts: 3000, ggr: 0, bets: 15 }],
    bySession: [{ marketSession: 'open', wagered: 6000, payouts: 5500, ggr: 500, bets: 30 }, { marketSession: 'close', wagered: 4000, payouts: 4000, ggr: 0, bets: 20 }],
    byDigit: Array.from({ length: 10 }, (_, i) => ({ digit: String(i), wagered: 1000 - i * 50, payouts: 500, exposure: 500 - i * 50, bets: 10 - i })),
    bySelection: Array.from({ length: 7 }, (_, i) => ({ selection: String(i), matkaId: `matka-${i}`, matkaName: ['Kalyan', 'Main Bazar', 'Milan Day', 'Milan Night', 'Rajdhani', 'Starline', 'Jackpot'][i], marketName: 'OPEN', marketSession: 'open', bidType: 'single', wagered: 1000, payouts: 500, exposure: 500 - i * 25, bets: 8 + i })),
  },
}
function complete(selection: SelectionSetNode, value: unknown): unknown {
  if (value == null) return null
  if (Array.isArray(value)) return value.map(item => complete(selection, item))
  const source = value as Record<string, unknown>
  const fields = selection.selections.flatMap(node => node.kind === 'InlineFragment' ? node.selectionSet.selections : [node])
  return Object.fromEntries(fields.filter(node => node.kind === 'Field').map(field => {
    const key = field.alias?.value || field.name.value
    const raw = field.name.value === '__typename' ? source[key] || 'MatkaFixture' : source[key] ?? null
    return [key, field.selectionSet ? complete(field.selectionSet, raw) : raw]
  }))
}
export interface MatkaFixtureState { empty?: boolean; refused?: boolean; createCount?: number; failAfter?: number; fail?: string }
export function matkaFixtureResponse(operation: Operation, state: MatkaFixtureState = {}): FetchResult {
  if (state.fail === operation.operationName) throw new Error('Matka preview data unavailable')
  let value: Record<string, unknown>
  switch (operation.operationName) {
    case 'CurrentWhitelabel': value = { whitelabelCurrent: { id: 'preview-tenant', name: 'Preview Tenant', domain: 'preview.example.test' } }; break
    case 'Currencies': value = { currencies: [{ code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2, isActive: true, exchangeRate: 1 }] }; break
    case 'MatkaLiveDashboard': value = { matkaLiveDashboard: state.empty ? { ...matkaDashboardFixture, breakdown: { byMatka: [], byType: [], byMarket: [], byBidType: [], bySession: [], byDigit: [], bySelection: [] } } : matkaDashboardFixture }; break
    case 'MatkaPlayerEvents': value = { matkaPlayerEvents: state.empty ? null : { id: 'event-1', userId: '1', userName: 'Asha Sharma', matkaId: 'matka-0', matkaName: 'Kalyan', matkaType: 'worli', marketName: 'OPEN', bidType: 'single', betAmount: 100, potentialWin: 900, status: 'pending', at: new Date(stamp).toISOString() } }; break
    case 'MatkaRiskAlerts': value = { matkaRiskAlerts: { at: new Date(stamp).toISOString(), items: state.empty ? [] : [{ id: 'risk-1', type: 'concentration', severity: 'warning', title: 'Preview concentration warning', description: 'Review open-market exposure.', entity: 'Kalyan', value: 20, threshold: 10, at: new Date(stamp).toISOString() }] } }; break
    case 'MatkaExposureBook': value = { matkaExposureBook: { at: new Date(stamp).toISOString(), markets: state.empty ? [] : ['OPEN', 'CLOSE'].map(marketName => ({ marketName, marketSession: marketName.toLowerCase(), bets: 15, totalStake: 1500, potentialPayout: 2000, exposure: -500, selections: [{ marketName, marketSession: marketName.toLowerCase(), bidType: 'single', selectionKey: `${marketName}:single:7`, bets: 4, totalStake: 400, potentialPayout: 900, exposure: -500 }] })) } }; break
    case 'MatkaLiveBetsPage': {
      const f = operation.variables.filters || {};
      const all = state.empty ? [] : matkaBetsFixture;
      const rows = all.filter(row => (!f.status || (Array.isArray(f.status) ? f.status.includes(row.status) : f.status === row.status)) && (!f.matkaName || f.matkaName === row.matkaName) && (!f.marketName || f.marketName === row.marketName) && (!f.bidType || f.bidType === row.bidType) && (f.stakeMin == null || row.betAmount >= f.stakeMin) && (f.stakeMax == null || row.betAmount <= f.stakeMax) && (!f.search || [row.userName,row.marketName,row.betNumbers].some(v => String(v).toLowerCase().includes(f.search.toLowerCase()))));
      value = { betsPage: { total: rows.length, items: rows.map(row=>({...row,__typename:'MatkaBet'})).slice(operation.variables.offset ?? 0, (operation.variables.offset ?? 0) + (operation.variables.limit ?? 20)) }, betsFilterOptions: { matkaNames: [...new Set(all.map(r=>r.matkaName))], marketNames: [...new Set(all.map(r=>r.marketName))], bidTypes: [...new Set(all.map(r=>r.bidType))] } }; break;
    }
    case 'MatkaBets': {
      const query = operation.variables.query || {}
      const statuses: string[] = query.statuses?.length ? query.statuses : query.status ? [query.status] : []
      const rows = state.empty ? [] : matkaBetsFixture.filter(row => (!statuses.length || statuses.includes(row.status)) && (!query.dateFrom || row.createdAt >= query.dateFrom))
      value = { matkaBets: rows.slice(0, Number(query.limit) || 1000) }; break
    }
    case 'Users': value = { users: state.empty ? [] : [1, 2, 3, 4].map(id => ({ id: String(id), createdAt: new Date(stamp - (id === 1 ? 2 : 20) * 86400000).toISOString(), vipTierName: id === 1 ? 'Gold' : 'Silver', status: 'ACTIVE' })) }; break
    case 'MatkaCatalog':
    case 'Matkas': value = { matkas: { items: [{ id: 'matka-0', name: 'Kalyan', code: 'KAL', status: 'ACTIVE', matkaType: 'worli', markets: [] }], total: 1 } }; break
    case 'CreateTestMatkaBet': {
      state.createCount = (state.createCount || 0) + 1
      if (state.refused || state.failAfter != null && state.createCount > state.failAfter) return { errors: [{ message: 'Test bet refused' }] }
      value = { createTestMatkaBet: { ...matkaBetsFixture[0], ...operation.variables.input, id: `test-created-${state.createCount}` } }; break
    }
    default: throw new Error(`Unexpected Matka preview operation: ${operation.operationName}`)
  }
  const definition = operation.query.definitions.find(node => node.kind === 'OperationDefinition')
  if (!definition || definition.kind !== 'OperationDefinition') throw new Error('Missing operation')
  return { data: complete(definition.selectionSet, value) as Record<string, unknown> }
}
