import { useQuery } from '@apollo/client'
import { IconGift } from '@tabler/icons-react'
import { DASHBOARD_FINANCIAL_INSIGHTS_QUERY } from '../graphql'
import { useDashboardStore } from '@/state/dashboardStore'
import { Card } from '@/ui/components/Card'
import { LoadingState } from '@/ui/components/LoadingState'
import { Meter } from '@/ui/components/Meter'
import { Notice } from '@/ui/components/Notice'
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/ui/components/Table'
import { FigureSection } from './FigureSection'
import { count, formatShare, periodLabel, plural, ratio, useWholeMoney } from './insightFormat'
import styles from './FinancialInsights.module.css'

/* The Financial tab's casino providers P&L and bonus analysis (the owner's ask, 2026-10-29), from
   Query.dashboardFinancialInsights. Casino figures are settled cash rounds, as the casino GGR report counts
   them; hold is GGR over turnover. Bonus "given" leaves cancelled awards out; outstanding is what is still
   pending or active now, whenever it was awarded. */

interface ProviderRow {
  vendor: string
  turnover: number
  payouts: number
  ggr: number
  bets: number
  players: number
}

interface BonusType {
  type: string
  amount: number
  awards: number
}

interface FinancialData {
  casinoProviders: ProviderRow[]
  casinoTotal: ProviderRow
  bonusGiven: number
  bonusAwards: number
  bonusByType: BonusType[]
  bonusOutstanding: number
  bonusOutstandingAwards: number
  bonusCompleted: number
  bonusExpired: number
  bonusStakes: number
}

/** A bonus type's enum value in words: "daily_first_deposit" → "Daily first deposit". */
const typeLabel = (type: string) => {
  const words = type.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function useFinancialInsights() {
  const { getDateRangeForQuery, filters } = useDashboardStore()
  const { data, loading, error } = useQuery(DASHBOARD_FINANCIAL_INSIGHTS_QUERY, {
    variables: { dateRange: getDateRangeForQuery() },
    pollInterval: 120000,
    errorPolicy: 'all',
  })
  const insights: FinancialData | undefined = data?.dashboardFinancialInsights
  return { insights, pending: loading && !data, error: error && !data ? error : undefined, period: periodLabel(filters?.dateRange?.preset) }
}

export function CasinoProvidersCard() {
  const { insights, pending, error, period } = useFinancialInsights()
  const money = useWholeMoney()
  const providers = insights?.casinoProviders ?? []
  const total = insights?.casinoTotal
  const hold = (row: ProviderRow) => formatShare(ratio(row.ggr, row.turnover))
  return (
    <Card title="Casino Providers" sub={`${period} · settled cash rounds, largest turnover first`} body="table">
      {pending ? <LoadingState height={240} label="Loading casino providers" /> : error ? (
        <Notice tone="error" title="Casino providers unavailable">{error.message}</Notice>
      ) : providers.length === 0 ? (
        <p className={styles.empty}>No settled casino rounds in this period.</p>
      ) : (
        <Table caption="Casino providers by turnover" width="wide">
          <THead>
            <TR>
              <TH>Provider</TH>
              <TH align="right">Turnover</TH>
              <TH align="right">Payouts</TH>
              <TH align="right">GGR</TH>
              <TH align="right">Hold</TH>
              <TH align="right">Bets</TH>
              <TH align="right">Players</TH>
            </TR>
          </THead>
          <TBody>
            {providers.map((row) => (
              <TR key={row.vendor}>
                <TD emphasis="key">{row.vendor}</TD>
                <TD align="right">{money(row.turnover)}</TD>
                <TD align="right">{money(row.payouts)}</TD>
                <TD align="right" tone={row.ggr < 0 ? 'neg' : 'pos'}>{money(row.ggr)}</TD>
                <TD align="right">{hold(row)}</TD>
                <TD align="right">{count(row.bets)}</TD>
                <TD align="right">{count(row.players)}</TD>
              </TR>
            ))}
          </TBody>
          {total ? (
            <TFoot>
              <TR>
                <TD emphasis="key">All providers</TD>
                <TD align="right" emphasis="key">{money(total.turnover)}</TD>
                <TD align="right" emphasis="key">{money(total.payouts)}</TD>
                <TD align="right" emphasis="key" tone={total.ggr < 0 ? 'neg' : 'pos'}>{money(total.ggr)}</TD>
                <TD align="right" emphasis="key">{hold(total)}</TD>
                <TD align="right" emphasis="key">{count(total.bets)}</TD>
                <TD align="right" emphasis="key">{count(total.players)}</TD>
              </TR>
            </TFoot>
          ) : null}
        </Table>
      )}
    </Card>
  )
}

/** Bonus given, its cost against GGR, what is still outstanding and how much finished its wagering. */
export function BonusAnalysisSection({ ggr }: { ggr?: number }) {
  const { insights, pending, error, period } = useFinancialInsights()
  const money = useWholeMoney()
  if (error) return <Notice tone="error" title="Bonus analysis unavailable">{error.message}</Notice>
  const b = insights
  const finished = (b?.bonusCompleted ?? 0) + (b?.bonusExpired ?? 0)
  const types = b?.bonusByType ?? []
  return (
    <FigureSection title="Bonus Analysis" sub={period} icon={IconGift} accent="violet" pending={pending} figures={[
      { label: 'Bonus Given', value: money(b?.bonusGiven ?? 0), note: plural(b?.bonusAwards ?? 0, 'award'), accent: 'violet' },
      { label: 'Bonus vs GGR', value: formatShare(ggr && ggr > 0 ? (b?.bonusGiven ?? 0) / ggr : null), note: 'Bonus given ÷ GGR' },
      { label: 'Outstanding Now', value: money(b?.bonusOutstanding ?? 0), note: plural(b?.bonusOutstandingAwards ?? 0, 'pending or active award'), accent: 'amber' },
      { label: 'Wagering Completed', value: formatShare(ratio(b?.bonusCompleted ?? 0, finished)), note: `${count(b?.bonusCompleted ?? 0)} completed · ${count(b?.bonusExpired ?? 0)} expired` },
      { label: 'Bonus Stakes', value: money(b?.bonusStakes ?? 0), note: 'Casino and matka bets on bonus money' },
    ]}>
      {!pending && types.length > 0 ? (
        <div className={styles.types}>
          <h3 className={styles.typesLabel}>By type</h3>
          <ul className={styles.typeList}>
            {types.map((type) => (
              <li key={type.type} className={styles.typeRow}>
                <span className={styles.typeName}>{typeLabel(type.type)}</span>
                <Meter className={styles.typeBar} value={(type.amount / Math.max(1, types[0].amount)) * 100} />
                <span className={styles.typeAmount}>{money(type.amount)}</span>
                <span className={styles.typeCount}>{plural(type.awards, 'award')}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </FigureSection>
  )
}
