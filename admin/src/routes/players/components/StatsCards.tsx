import { useQuery, gql } from '@apollo/client'
import { IconUsers, IconWallet, IconActivity, IconAlertCircle, IconCreditCard } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import type { StatProps } from '@/ui/components/Stat'
import { AccountListMetric } from '@/modules/account-lists/AccountList'
import { strokeFor } from '@/ui/components/icons'
import styles from '@/modules/account-lists/AccountList.module.css'
const PLAYER_LIST_STATS_QUERY = gql`
  query PlayerListStats($parentType: String) {
    playersListStats(parentType: $parentType) {
      totalPlayers
      activePlayers
      suspendedPlayers
      inactivePlayers
      totalBalance
      totalBonus
      totalExposure
      totalCreditLimit
      totalCreditUsed
      highUtilizationCount
    }
  }
`;


export function StatsCards({ parentType = 'ALL', defer = false }: { parentType?: string; defer?: boolean }) {
  const { getCurrencySymbol } = useCurrency();
  const permissions = useAuthStore(s => s.permissions);
  const agent = useAuthStore(s => s.agent);
  const canViewWallet = !!agent || hasPermissionWithNested(permissions, 'players.wallet', 'view');
  const canViewCredit = !!agent || hasPermissionWithNested(permissions, 'players.credit', 'view');
  const mask = '••••';
  const { data, loading } = useQuery(PLAYER_LIST_STATS_QUERY, {
    variables: {
      parentType: parentType === 'ALL' ? undefined : parentType,
    },
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-first',
    skip: defer,
  });

  const s = data?.playersListStats;
  const totalPlayers = s?.totalPlayers ?? 0;
  const activePlayers = s?.activePlayers ?? 0;
  const suspendedPlayers = s?.suspendedPlayers ?? 0;
  const inactivePlayers = s?.inactivePlayers ?? 0;
  const totalBalance = s?.totalBalance ?? 0;
  const totalBonus = s?.totalBonus ?? 0;
  const totalExposure = s?.totalExposure ?? 0;
  const totalCreditLimit = s?.totalCreditLimit ?? 0;
  const totalCreditUsed = s?.totalCreditUsed ?? 0;
  const highUtilizationPlayers = s?.highUtilizationCount ?? 0;
  const creditUtilization = totalCreditLimit > 0 ? Math.round((totalCreditUsed / totalCreditLimit) * 100) : 0;
  const activeRate = totalPlayers > 0 ? Math.round((activePlayers / totalPlayers) * 100) : 0;


  // Until the first answer the cards hold their own height with placeholders, so the page does not jump.
  const pending = (defer || loading) && !data
  const money = (v: number) => getCurrencySymbol() + v.toLocaleString()
  const count: StatProps = { label: parentType === 'ALL' ? 'Total Players' : parentType === 'DIRECT' ? 'Direct Players' : parentType === 'SUB_AGENTS' ? 'Sub-Agent Players' : parentType === 'CREDIT' ? 'Credit Players' : parentType === 'COMMISSION' ? 'Commission Players' : 'Sharing Players', value: totalPlayers, note: parentType === 'ALL' || parentType === 'SHARING' ? `${activePlayers} active, ${suspendedPlayers + inactivePlayers} issues` : `${activePlayers} active, ${suspendedPlayers} suspended`, icon: <IconUsers size={18} stroke={strokeFor(18)} />, hue: 'blu' }
  const balance: StatProps = { label: parentType === 'ALL' ? 'Total Balance' : 'Balance', value: canViewWallet ? money(totalBalance) : mask, note: canViewWallet ? 'Bonus: ' + money(totalBonus) : undefined, icon: <IconWallet size={18} stroke={strokeFor(18)} />, hue: 'vio' }
  const rate: StatProps = { label: 'Active Rate', value: activeRate + '%', note: `${activePlayers} of ${totalPlayers}`, icon: <IconActivity size={18} stroke={strokeFor(18)} />, hue: 'grn' }
  const exposure: StatProps = { label: 'Exposure', value: canViewWallet ? money(totalExposure) : mask, note: suspendedPlayers + ' at risk', icon: <IconAlertCircle size={18} stroke={strokeFor(18)} />, hue: 'red' }
  const attention: StatProps = { label: 'Attention', value: suspendedPlayers + inactivePlayers, note: `${suspendedPlayers} suspended, ${inactivePlayers} inactive`, icon: <IconAlertCircle size={18} stroke={strokeFor(18)} />, hue: 'red' }
  const credit: StatProps[] = [count,
    { label: 'Utilization', value: creditUtilization + '%', note: canViewCredit ? money(totalCreditUsed) + ' / ' + money(totalCreditLimit) : mask, icon: <IconCreditCard size={18} stroke={strokeFor(18)} />, hue: 'blu' },
    { label: 'Available', value: canViewCredit ? money(totalCreditLimit - totalCreditUsed) : mask, note: canViewCredit ? 'Limit: ' + money(totalCreditLimit) : undefined, icon: <IconWallet size={18} stroke={strokeFor(18)} />, hue: 'grn' },
    { label: 'Alerts', value: highUtilizationPlayers, note: highUtilizationPlayers > 0 ? 'High usage' : 'Healthy', icon: <IconAlertCircle size={18} stroke={strokeFor(18)} />, hue: 'red' }]
  const cards = parentType === 'CREDIT' ? credit : [count, balance, rate, parentType === 'SHARING' || parentType === 'COMMISSION' ? attention : exposure]
  if (!['ALL', 'DIRECT', 'CREDIT', 'SHARING', 'COMMISSION', 'SUB_AGENTS'].includes(parentType)) return null
  return <div className={styles.metrics} aria-busy={pending || undefined}>{cards.map(card => <AccountListMetric key={String(card.label)} {...card} loading={pending} />)}</div>
}
