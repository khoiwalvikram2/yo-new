import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconTrendingUp, IconCurrencyDollar, IconPercentage, IconArrowsExchange, IconGift, IconChartLine, IconCash, IconWallet, IconUsers } from '@tabler/icons-react'
import { nowIST } from '@/shared/utils/date'
import { usePlayerProfileStore, defaultProfileFilters } from '@/state/playerProfileStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { AccountListMetric } from '@/modules/account-lists/AccountList'
import type { StatHue } from '@/ui/components/Stat'
import { DateField } from '@/ui/components/DateField'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import type { ProfileKpis, ProfileWallet } from '../profileModel'
import styles from '../PlayerProfile.module.css'

interface KpiGridProps {
  playerId: string; kpis?: ProfileKpis | null; wallet?: ProfileWallet | null
  /** Before the overview answers: the same controls and cards, with placeholder figures. */
  loading?: boolean
}

type WalletTab = 'cash' | 'bonus' | 'referralBonus'

interface KpiItem {
  title: string
  value: string
  subtitle?: string
  icon: ReactNode
  /** Signs a P/L figure. */
  tone?: 'positive' | 'negative'
}

const DATE_PRESET_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last week' },
  { value: '30d', label: 'Last month' },
  { value: 'all_time', label: 'All time' },
  { value: 'custom', label: 'Custom' },
]

/** The period the profile's dated figures read (Overview, Bets History, Transactions): a preset, or two dates. */
export function ProfilePeriod({ playerId }: { playerId: string }) {
  const profileFilters = usePlayerProfileStore((s) => (playerId ? s.profiles[playerId] : undefined))
  const setDateRange = usePlayerProfileStore((s) => s.setDateRange)
  const setCustomRange = usePlayerProfileStore((s) => s.setCustomRange)
  const { dateRange, dateFrom, dateTo } = profileFilters ?? defaultProfileFilters
  const activePreset = dateFrom && dateTo ? 'custom' : dateRange
  const choosePreset = (value: string) => {
    if (value === 'custom') {
      const to = nowIST()
      setCustomRange(playerId, to.subtract(30, 'day').format('YYYY-MM-DD'), to.format('YYYY-MM-DD'))
    } else setDateRange(playerId, value)
  }
  const changeDay = (from: string, to: string) => {
    if (from && to) setCustomRange(playerId, from, to)
    else setDateRange(playerId, '30d')
  }
  return <div className={styles.period}>
    <SegmentedControl label="Date range" size="sm" value={activePreset} options={DATE_PRESET_OPTIONS} onChange={choosePreset} />
    {activePreset === 'custom' && <>
      <DateField label="From" size="sm" value={dateFrom || ''} max={dateTo || undefined} onChange={(next) => changeDay(next, dateTo || '')} />
      <DateField label="To" size="sm" value={dateTo || ''} min={dateFrom || undefined} onChange={(next) => changeDay(dateFrom || '', next)} />
    </>}
  </div>
}

/** The Overview's head: which wallet and period, then that wallet's four headline figures. */
export function KpiGrid({ playerId, kpis: kpisProp, wallet, loading = false }: KpiGridProps) {
  const [walletTab, setWalletTab] = useState<WalletTab>('cash')
  const { formatAmount } = useCurrency()
  const permissions = useAuthStore(s => s.permissions)
  const agent = useAuthStore(s => s.agent)
  const canViewWallet = !!agent || hasPermissionWithNested(permissions, 'players.wallet', 'view')
  const canViewBonuses = !!agent || hasPermissionWithNested(permissions, 'players.bonuses', 'view')
  const mask = '••••'
  const fmt = (v: number) => canViewWallet ? formatAmount(v) : mask
  const fmtBonus = (v: number) => canViewBonuses ? formatAmount(v) : mask
  const fmtPL = (v: number, canView: boolean) => canView ? (v >= 0 ? '+' : '-') + formatAmount(Math.abs(v)) : mask
  // A balance-like figure that can go below zero: the minus before the currency, no plus.
  const fmtNet = (v: number) => canViewWallet ? (v < 0 ? '-' : '') + formatAmount(Math.abs(v)) : mask
  const toneOf = (v: number) => v > 0 ? 'positive' as const : v < 0 ? 'negative' as const : undefined

  // While loading every figure is a placeholder, so empty KPIs only lay out the cards.
  const kpis: ProfileKpis = kpisProp && typeof kpisProp === 'object' ? kpisProp : {}
  const safeNum = (n: unknown) => { const value = Number(n); return Number.isFinite(value) ? value : 0 }

  // ALL amounts come from the backend already in local currency (INR) — no conversion needed
  const totalWagered = safeNum(kpis.totalWagered ?? kpis.totalStake)
  const totalWinnings = safeNum(kpis.totalWinnings ?? kpis.totalReturn)
  const totalBets = safeNum(kpis.activeBets ?? kpis.openBetsCount) + safeNum(kpis.settledBetsCount)
  const averageBetSize = kpis.averageBetSize != null ? safeNum(kpis.averageBetSize) : totalBets > 0 ? totalWagered / totalBets : 0
  const winRate = totalWagered > 0 ? ((totalWinnings / totalWagered) * 100).toFixed(1) : '0.0'
  const depositsVolume = safeNum(kpis.depositVolume)
  const withdrawalsVolume = safeNum(kpis.withdrawalVolume)
  const netDeposits = kpis.netDeposits != null ? safeNum(kpis.netDeposits) : depositsVolume - withdrawalsVolume
  const plCash = safeNum(kpis.plByWalletType?.cash)
  const plBonus = safeNum(kpis.plByWalletType?.bonus)
  const plReferral = safeNum(kpis.plByWalletType?.referralBonus)
  const ggrCash = safeNum(kpis.ggrByWalletType?.cash)
  const ggrBonus = safeNum(kpis.ggrByWalletType?.bonus)
  const ggrReferral = safeNum(kpis.ggrByWalletType?.referralBonus)
  const bonusBalance = safeNum(wallet?.bonus)
  const referralBonusBalance = safeNum(wallet?.referralBonusBalance)
  const referralToCashTransfer = safeNum(kpis.referralToCashTransfer)
  const wageringPercent = kpis.wageringCompletionPercent != null ? Number(kpis.wageringCompletionPercent) : null

  const items: Record<WalletTab, KpiItem[]> = {
    cash: [
      { title: 'Cash P/L', value: fmtPL(plCash, canViewWallet), tone: toneOf(plCash), subtitle: `GGR ${fmtPL(ggrCash, canViewWallet)}`, icon: <IconCurrencyDollar size={18} /> },
      { title: 'Total Wagered', value: fmt(totalWagered), subtitle: `${totalBets.toLocaleString('en-IN')} bets · avg ${fmt(averageBetSize)}`, icon: <IconTrendingUp size={18} /> },
      { title: 'Win Rate', value: winRate + '%', subtitle: 'Winnings of wagered', icon: <IconPercentage size={18} /> },
      { title: 'Net Deposits', value: fmtNet(netDeposits), subtitle: `${fmt(depositsVolume)} in · ${fmt(withdrawalsVolume)} out`, icon: <IconArrowsExchange size={18} /> },
    ],
    bonus: [
      { title: 'Bonus Balance', value: fmtBonus(bonusBalance), subtitle: 'Active', icon: <IconGift size={18} /> },
      { title: 'GGR', value: fmtPL(ggrBonus, canViewBonuses), subtitle: 'Bonus (period)', icon: <IconTrendingUp size={18} /> },
      { title: 'P/L', value: fmtPL(plBonus, canViewBonuses), tone: toneOf(plBonus), subtitle: 'Bonus (period)', icon: <IconCurrencyDollar size={18} /> },
      { title: 'Wagering', value: wageringPercent != null ? `${wageringPercent}%` : 'N/A', subtitle: 'Completion', icon: <IconChartLine size={18} /> },
    ],
    referralBonus: [
      { title: 'Referral Bonus Balance', value: fmt(referralBonusBalance), subtitle: 'Active', icon: <IconGift size={18} /> },
      { title: 'GGR', value: fmtPL(ggrReferral, canViewWallet), subtitle: 'Referral (period)', icon: <IconTrendingUp size={18} /> },
      { title: 'P/L', value: fmtPL(plReferral, canViewWallet), tone: toneOf(plReferral), subtitle: 'Referral (period)', icon: <IconCurrencyDollar size={18} /> },
      { title: 'Referral to Cash', value: fmt(referralToCashTransfer), subtitle: 'Released to cash', icon: <IconCash size={18} /> },
    ],
  }
  const hues: StatHue[] = ['ind', 'blu', 'vio', 'grn']
  const value = (item: KpiItem) => <span className={clsx(styles.moneyValue, item.tone && styles[item.tone])}>{item.value}</span>
  return <div className={styles.stack}>
    <div className={styles.controls}>
      <SegmentedControl label="Wallet type" value={walletTab} onChange={(next) => setWalletTab(next as WalletTab)} options={[
        { value: 'cash', label: 'Cash', icon: <IconWallet size={16} /> },
        { value: 'bonus', label: 'Bonus', icon: <IconGift size={16} /> },
        { value: 'referralBonus', label: 'Referral Bonus', icon: <IconUsers size={16} /> },
      ]} />
      <ProfilePeriod playerId={playerId} />
    </div>
    {/* The same stats cards as every list page (AccountListMetric), four across. */}
    <div className={styles.overviewKpis} aria-busy={loading || undefined}>{items[walletTab].map((item, index) => <AccountListMetric key={item.title} label={item.title} value={value(item)} note={item.subtitle} icon={item.icon} hue={hues[index % hues.length]} loading={loading} />)}</div>
  </div>
}
