import type { ProfileActivity, ProfileKpis, ProfileProduct } from './profileModel'

export type ProfileProductKey = 'sports' | 'casino' | 'matka'
export const PROFILE_PRODUCTS: readonly ProfileProductKey[] = ['sports', 'casino', 'matka']
export const PROFILE_PRODUCT_LABELS: Record<ProfileProductKey, string> = { sports: 'Sports', casino: 'Casino', matka: 'Matka' }

export interface ProfileProductRow {
  product: ProfileProductKey
  label: string
  /** Every bet placed in the period; null when the overview has no row for the product. */
  bets: number | null
  stake: number
  openStake: number
  ggr: number
  pl: number
  /** The product's whole-number share of the period's stake. */
  share: number
}

const amount = (value: unknown) => { const number = Number(value); return Number.isFinite(number) ? number : 0 }

/**
 * One row per product for the period. Bets and stake come from topProducts (every bet placed, open ones
 * included), open stake from exposureByProduct, GGR and P/L from the KPI breakdowns. A product the
 * overview has no topProducts row for falls back to its settled stake from the KPIs.
 */
export function profileProductRows(kpis: ProfileKpis | undefined, topProducts: readonly ProfileProduct[] = [], exposure: readonly { product?: string; exposure?: number }[] = []): ProfileProductRow[] {
  const settled: Record<ProfileProductKey, number | undefined> = { sports: kpis?.totalSportsStake, casino: kpis?.totalCasinoStake, matka: kpis?.totalMatkaStake }
  const rows = PROFILE_PRODUCTS.map((product) => {
    const top = topProducts.find((item) => (item.product || '').toLowerCase() === product)
    const open = exposure.find((item) => (item.product || '').toLowerCase() === product)
    return {
      product,
      label: PROFILE_PRODUCT_LABELS[product],
      bets: top?.betCount ?? null,
      stake: amount(top?.totalStake ?? settled[product]),
      openStake: amount(open?.exposure ?? (product === 'sports' ? kpis?.totalSportsOpenStake : 0)),
      ggr: amount(kpis?.ggrByProduct?.[product]),
      pl: amount(kpis?.plByProduct?.[product]),
      share: 0,
    }
  })
  const total = rows.reduce((sum, row) => sum + row.stake, 0)
  return rows.map((row) => ({ ...row, share: total > 0 ? Math.round((row.stake / total) * 100) : 0 }))
}

export type ProfileActivityKind = 'bet' | 'deposit' | 'withdrawal' | 'other'
export interface ProfileActivityEntry {
  id: string
  kind: ProfileActivityKind
  timestamp?: string
  description?: string
  product?: string
  status?: string
  /** A bet's stake, or a deposit's or withdrawal's amount. */
  amount?: number
  method?: string
}

function metadataOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>
  if (typeof value !== 'string' || !value) return {}
  try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {} } catch { return {} }
}

/** The overview's recent activity (newest first): bets, approved deposits and completed withdrawals, each
 *  with the figures its metadata carries (a JSON string from the API, or an object). */
export function profileActivityEntries(activity: readonly ProfileActivity[] = []): ProfileActivityEntry[] {
  return activity.map((event, index) => {
    const meta = metadataOf(event.metadata)
    const type = (event.type || '').toLowerCase()
    const kind: ProfileActivityKind = type === 'bet' || type === 'deposit' || type === 'withdrawal' ? type : 'other'
    const value = meta.stake ?? meta.amount
    return {
      id: event.id || `activity-${index}`,
      kind,
      timestamp: event.timestamp,
      description: event.description,
      product: typeof meta.product === 'string' ? meta.product : undefined,
      status: typeof meta.status === 'string' ? meta.status : undefined,
      amount: value == null || value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value),
      method: typeof meta.method === 'string' && meta.method ? meta.method : undefined,
    }
  })
}
