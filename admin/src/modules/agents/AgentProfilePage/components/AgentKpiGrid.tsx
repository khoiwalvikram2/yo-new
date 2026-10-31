import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconUsers, IconCurrencyRupee, IconTrendingUp, IconArrowsExchange, IconClockHour4, IconBolt, IconGift } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { AccountListMetric } from '@/modules/account-lists/AccountList'
import type { StatHue } from '@/ui/components/Stat'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { DateField } from '@/ui/components/DateField'
import { PROFILE_STATS_PRESETS, type ProfileStats } from './agentProfileModel'
import styles from './AgentProfileComponents.module.css'

/** The stats period: a preset, and the calendar dates agentDashboardStats reads (null to null is all time). */
export interface ProfileStatsPeriod { preset: string; from: string | null; to: string | null }

interface PeriodProps {
  period: ProfileStatsPeriod
  onPresetChange: (preset: string) => void
  /** Both dates set a custom range; clearing either goes back to all time. */
  onCustomRange: (from: string | null, to: string | null) => void
}

export function AgentStatsPeriod({ period, onPresetChange, onCustomRange }: PeriodProps) {
  return <div className={styles.period}>
    <SegmentedControl label="Stats date range" size="sm" value={period.preset} options={PROFILE_STATS_PRESETS} onChange={onPresetChange} />
    {period.preset === 'custom' && <>
      <DateField label="Stats From" size="sm" value={period.from || ''} max={period.to || undefined} onChange={from => onCustomRange(from || null, period.to)} />
      <DateField label="Stats To" size="sm" value={period.to || ''} min={period.from || undefined} onChange={to => onCustomRange(period.from, to || null)} />
    </>}
  </div>
}

interface AgentKpiGridProps extends PeriodProps {
  stats: ProfileStats | null | undefined
  /** Before the first answer: the same cards with placeholder figures. */
  loading?: boolean
}
type WalletTab = 'cash' | 'bonus' | 'referralBonus'
interface KpiItem { title: string; value: string; note?: string; icon: ReactNode; tone?: 'positive' | 'negative' }

/** The Overview's head: which wallet and period, then four headline figures for that wallet. */
export function AgentKpiGrid({ stats, loading = false, ...period }: AgentKpiGridProps) {
  const [walletTab, setWalletTab] = useState<WalletTab>('cash')
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const safe = (n: number) => (Number.isFinite(n) ? n : 0)
  const money = (value: number | undefined) => safe(convertFromWhitelabelCurrency(Number(value ?? 0)))
  const count = (value: number | undefined) => Number(value ?? 0).toLocaleString('en-IN')
  const fmtPl = (v: number) => (v >= 0 ? '+' : '-') + formatAmount(Math.abs(v))
  // GGR and net deposits keep their sign in front of the currency (-₹100.00), with no plus.
  const fmtGgr = (v: number) => (v < 0 ? '-' : '') + formatAmount(Math.abs(v))
  const toneOf = (v: number) => v > 0 ? 'positive' as const : v < 0 ? 'negative' as const : undefined

  const totalDeposits = money(stats?.totalDeposits)
  const totalWithdrawals = money(stats?.totalWithdrawals)
  const plCash = money(stats?.plByWalletType?.cash)
  const plBonus = money(stats?.plByWalletType?.bonus)
  const plReferral = money(stats?.plByWalletType?.referralBonus)
  const ggrCash = money(stats?.ggrByWalletType?.cash)
  const ggrBonus = money(stats?.ggrByWalletType?.bonus)
  const ggrReferral = money(stats?.ggrByWalletType?.referralBonus)
  const pending = Number(stats?.pendingDeposits ?? 0) + Number(stats?.pendingWithdrawals ?? 0)
  const players: KpiItem = { title: 'Total Players', value: count(stats?.totalPlayers), note: `${count(stats?.directPlayerCount)} direct · ${count(stats?.subAgentPlayerCount)} under sub-agents`, icon: <IconUsers size={18} /> }
  const active: KpiItem = { title: 'Active Players', value: count(stats?.activePlayers24h), note: `Last 24 hours · ${count(stats?.newPlayersToday)} new today`, icon: <IconBolt size={18} /> }

  const items: Record<WalletTab, KpiItem[]> = {
    cash: [
      { title: 'Cash P/L', value: fmtPl(plCash), tone: toneOf(plCash), note: `GGR ${fmtGgr(ggrCash)}`, icon: <IconCurrencyRupee size={18} /> },
      { title: 'Net Deposits', value: fmtGgr(totalDeposits - totalWithdrawals), note: `${formatAmount(totalDeposits)} in · ${formatAmount(totalWithdrawals)} out`, icon: <IconArrowsExchange size={18} /> },
      active,
      { title: 'Pending Requests', value: count(pending), note: `${formatAmount(money(stats?.pendingDepositsAmount))} deposits · ${formatAmount(money(stats?.pendingWithdrawalsAmount))} withdrawals`, icon: <IconClockHour4 size={18} /> },
    ],
    bonus: [
      { title: 'Bonus P/L', value: fmtPl(plBonus), tone: toneOf(plBonus), note: 'Bonus (period)', icon: <IconCurrencyRupee size={18} /> },
      { title: 'Bonus GGR', value: fmtGgr(ggrBonus), note: 'Bonus (period)', icon: <IconTrendingUp size={18} /> },
      players,
      active,
    ],
    referralBonus: [
      { title: 'Referral P/L', value: fmtPl(plReferral), tone: toneOf(plReferral), note: 'Referral (period)', icon: <IconCurrencyRupee size={18} /> },
      { title: 'Referral GGR', value: fmtGgr(ggrReferral), note: 'Referral (period)', icon: <IconTrendingUp size={18} /> },
      players,
      active,
    ],
  }
  const hues: StatHue[] = ['ind', 'blu', 'vio', 'grn']
  return <div className={styles.stack}>
    <div className={styles.controls}>
      <SegmentedControl label="Wallet type" value={walletTab} onChange={(next) => setWalletTab(next as WalletTab)} options={[
        { value: 'cash', label: 'Cash' },
        { value: 'bonus', label: 'Bonus', icon: <IconGift size={16} /> },
        { value: 'referralBonus', label: 'Referral Bonus', icon: <IconUsers size={16} /> },
      ]} />
      <AgentStatsPeriod {...period} />
    </div>
    {/* The same stats cards as every list page (AccountListMetric), four across. */}
    <div className={styles.overviewKpis} role="group" aria-label="Agent figures" aria-busy={loading || undefined}>
      {items[walletTab].map((item, index) => <AccountListMetric key={item.title} label={item.title} value={<span className={clsx(item.tone && styles[item.tone])}>{item.value}</span>} note={item.note} icon={item.icon} hue={hues[index % hues.length]} loading={loading} />)}
    </div>
  </div>
}
