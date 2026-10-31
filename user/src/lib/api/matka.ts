import { graphqlRequest } from '@/lib/graphqlClient'

export type MatkaKind = 'WORLI' | 'STARLINE' | 'JACKPOT' | 'SATTA_MATKA'
export type MatkaWallet = 'CASH' | 'BONUS' | 'REFERRAL_BONUS'
export type MatkaSession = 'OPEN' | 'CLOSE'
export type MatkaMeta = { code: number; message?: string; total?: number; page?: number; hasMore?: boolean }
export type MatkaResult = { date: string; openResult: string | null; closeResult: string | null; openDigit: string | null; closeDigit: string | null; jodi: string | null; complete: boolean }
export type MatkaMarket = {
  id: string; code: string; name: string; kind: MatkaKind; description: string | null; timezone: string; runDate: string; quoteVersion: string
  status: string; message: string | null; minStake: number; maxStake: number; featured: boolean
  sessions: Array<{ side: MatkaSession; enabled: boolean; accepting: boolean; resultAt: string; lockAt: string; startsAt: string; status: string }>
  rates: Array<{ bidType: string; label: string; payoutMultiplier: number }>; result: MatkaResult
}
export type MatkaBet = { id: string; batchId: string | null; marketId: string; marketName: string; runDate: string; bidType: string; selection: string; session: MatkaSession; amount: number; payoutMultiplier: number; potentialWin: number; actualWin: number | null; netProfit: number | null; status: string; result: string | null; walletType: string; currency: string; createdAt: string; settledAt: string | null }
export type MatkaEntry = { bidType: string; selection: string; session: MatkaSession; amount: number }
export type MatkaPlacementInput = { marketId: string; runDate: string; requestKey: string; quoteVersion: string; accountId?: string; walletType: MatkaWallet; entries: MatkaEntry[] }
export class MatkaRequestError extends Error { readonly definitive = true }
function checked<T extends { meta: MatkaMeta }>(response: T): T {
  if (response.meta.code !== 200) {
    const message = response.meta.message || 'Matka request failed'
    if (response.meta.code >= 500) throw new Error(message)
    throw new MatkaRequestError(message)
  }
  return response
}
const MARKET_FIELDS = `id code name kind description timezone runDate quoteVersion status message minStake maxStake featured
  sessions { side enabled accepting resultAt lockAt startsAt status } rates { bidType label payoutMultiplier }
  result { date openResult closeResult openDigit closeDigit jodi complete }`
const BET_FIELDS = `id batchId marketId marketName runDate bidType selection session amount payoutMultiplier potentialWin actualWin netProfit status result walletType currency createdAt settledAt`

export async function getMatkaMarkets(input: { kind?: MatkaKind; search?: string; page?: number; limit?: number } = {}) {
  const data = await graphqlRequest<{ matkaMarkets: { meta: MatkaMeta; data: MatkaMarket[] } }>(`
    query PlayerMatkaMarkets($kind: PlayerMatkaKind, $search: String, $page: Int, $limit: Int) {
      matkaMarkets(kind:$kind,search:$search,page:$page,limit:$limit) { meta { code message total page hasMore } data { ${MARKET_FIELDS} } }
    }`, input)
  return checked(data.matkaMarkets)
}
export async function getMatkaMarket(id: string) {
  const data = await graphqlRequest<{ matkaMarket: { meta: MatkaMeta; data: MatkaMarket | null } }>(`
    query PlayerMatkaMarket($id: ID!) { matkaMarket(id:$id) { meta { code message } data { ${MARKET_FIELDS} } } }`, { id })
  return checked(data.matkaMarket)
}
export async function getMatkaChart(input: { marketId: string; from: string; to: string }) {
  const data = await graphqlRequest<{ matkaChart: { meta: MatkaMeta; data: MatkaResult[] } }>(`
    query PlayerMatkaChart($marketId:ID!,$from:String!,$to:String!) {
      matkaChart(marketId:$marketId,from:$from,to:$to) { meta { code message } data { date openResult closeResult openDigit closeDigit jodi complete } }
    }`, input)
  return checked(data.matkaChart)
}
export async function getMyMatkaBets(input: { marketId?: string; status?: string; from?: string; to?: string; page?: number; limit?: number } = {}) {
  const data = await graphqlRequest<{ myMatkaBets: { meta: MatkaMeta; data: MatkaBet[] } }>(`
    query MyMatkaBets($marketId:ID,$status:String,$from:String,$to:String,$page:Int,$limit:Int) {
      myMatkaBets(marketId:$marketId,status:$status,from:$from,to:$to,page:$page,limit:$limit) { meta { code message total page hasMore } data { ${BET_FIELDS} } }
    }`, input)
  return checked(data.myMatkaBets)
}
export async function getMatkaWallet() {
  const data = await graphqlRequest<{ matkaWallet: { meta: MatkaMeta; data: Array<{ walletType: MatkaWallet; label: string; balance: number; currency: string }>; canBet: boolean; message: string | null } }>(`
    query PlayerMatkaWallet { matkaWallet { meta { code message } canBet message data { walletType label balance currency } } }`)
  return checked(data.matkaWallet)
}
export async function placeMatkaEntries(input: MatkaPlacementInput) {
  const data = await graphqlRequest<{ placeMatkaEntries: { meta: MatkaMeta; data: { batchId: string; totalStake: number; replayed: boolean; bets: MatkaBet[] } | null } }>(`
    mutation PlaceMatkaEntries($input:PlaceMatkaEntriesInput!) { placeMatkaEntries(input:$input) { meta { code message } data { batchId totalStake replayed bets { ${BET_FIELDS} } } } }`, { input })
  return checked(data.placeMatkaEntries)
}
