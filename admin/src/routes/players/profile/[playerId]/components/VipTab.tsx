import { useQuery, gql } from '@apollo/client'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { Meter } from '@/ui/components/Meter'
import { Notice } from '@/ui/components/Notice'
import { Spinner } from '@/ui/components/Spinner'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from '../PlayerProfile.module.css'
const PLAYER_VIP_QUERY = gql`
  query PlayerVip($playerId: ID!) {
    playerVip(playerId: $playerId) {
      tierId
      tierName
      tierLevel
      currentPoints
      lifetimePoints
      monthlyDeposits
      nextTierId
      nextTierName
      pointsToNextTier
      benefits
      perks {
        name
        description
        icon
      }
      history {
        id
        fromTierId
        fromTierName
        toTierId
        toTierName
        reason
        pointsAtChange
        createdAt
      }
      transactions {
        id
        type
        points
        description
        balanceBefore
        balanceAfter
        createdAt
      }
    }
  }
`


interface VipHistory { id: string; fromTierName?: string; toTierName?: string; reason?: string; pointsAtChange: number; createdAt: string }
interface VipTransaction { id: string; type: string; points: number; description?: string; balanceBefore: number; balanceAfter: number; createdAt: string }
interface VipInfo { tierName?: string; tierLevel?: number; currentPoints: number; lifetimePoints: number; monthlyDeposits?: number | null; nextTierName?: string; pointsToNextTier?: number; benefits?: string[]; perks?: { name: string; description: string }[]; history?: VipHistory[]; transactions?: VipTransaction[] }
export function VipTab({ playerId }: { playerId: string }) {
  const { formatDate, formatTime, formatDateTime } = useFormatDate()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { data, loading, error } = useQuery<{ playerVip?: VipInfo }>(PLAYER_VIP_QUERY, { variables: { playerId }, errorPolicy: 'all' })
  const vip = data?.playerVip
  if (loading) return <div className={styles.loading} role="status"><Spinner /> Loading VIP information…</div>
  if (error || !vip) return <EmptyState title="No VIP information available" />
  // Tiers are earned by this month's approved deposits, not by the points balance.
  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const current = Number(vip.monthlyDeposits) || 0
  const next = Number(vip.pointsToNextTier) || 0
  const percentage = next > 0 && Number.isFinite(current) ? Math.min(100, Math.max(0, current / (current + next) * 100)) : 100
  const transactions = vip.transactions || []
  const columns: DataTableColumn<VipTransaction>[] = [
    { key: 'type', header: 'Type', cell: (row) => <StatusPill tone={row.type === 'credit' ? 'ok' : 'neg'}>{row.type}</StatusPill> },
    { key: 'points', header: 'Points', align: 'right', cell: (row) => row.points.toLocaleString() },
    { key: 'description', header: 'Description', cell: (row) => row.description || '—' },
    { key: 'balance', header: 'Balance', cell: (row) => `${row.balanceBefore.toLocaleString()} → ${row.balanceAfter.toLocaleString()}` },
    { key: 'date', header: 'Date', cell: (row) => <div>{formatDate(row.createdAt, 'dd MMM yyyy')}<p className={styles.subtle}>{formatTime(row.createdAt, 'HH:mm')}</p></div> },
  ]
  return <div className={styles.stack}>
    <Card title="Current VIP Tier" sub="VIP status and tier information" tools={<RBACGuard required={[{ domain: 'players.vip', actions: ['update'] }]}><Button disabled title="Tier adjustment is not connected to a server action">Adjust Tier</Button></RBACGuard>}>
      <div className={styles.stack}>
        <Notice tone="info" title="Changing the tier">Change this player's tier from the player list: open the player's actions and use VIP Tier (a tier, or Automatic).</Notice>
        <div className={styles.fields}><Stat variant="bare" label="Current Tier" value={`${vip.tierName || ''} (Level ${vip.tierLevel ?? ''})`} /><Stat variant="bare" label="Current Points" value={vip.currentPoints.toLocaleString()} /><Stat variant="bare" label="Lifetime Points" value={vip.lifetimePoints.toLocaleString()} />{vip.nextTierName ? <Stat variant="bare" label="Next Tier" value={vip.nextTierName} note={`${money(next)} more in deposits this month`} /> : null}</div>
        {vip.nextTierName ? <div className={styles.stack}><div className={styles.row}><strong>Progress to Next Tier (approved deposits this month)</strong><span>{money(current)} / {money(current + next)}</span></div><Meter value={percentage} label="Progress to Next Tier" /></div> : null}
        {vip.benefits?.length ? <div className={styles.stack}><h3 className={styles.text}>Benefits</h3><div className={styles.row}>{vip.benefits.map((benefit, index) => <StatusPill key={`${benefit}-${index}`}>{benefit}</StatusPill>)}</div></div> : null}
        {vip.perks?.length ? <div className={styles.stack}><h3 className={styles.text}>Exclusive Perks</h3><div className={styles.fields}>{vip.perks.map((perk, index) => <div key={`${perk.name}-${index}`}><strong>{perk.name}</strong><p className={styles.subtle}>{perk.description}</p></div>)}</div></div> : null}
      </div>
    </Card>
    {vip.history?.length ? <Card title="Tier History" sub={`${vip.history.length} tier change${vip.history.length !== 1 ? 's' : ''}`}><ol className={styles.timeline}>{vip.history.map((history) => <li key={history.id} className={styles.timelineItem}><div className={styles.row}><strong>{history.fromTierName || 'None'} → {history.toTierName}</strong><StatusPill>{history.pointsAtChange.toLocaleString()} pts</StatusPill></div><p className={styles.text}>{history.reason}</p><p className={styles.subtle}>{formatDateTime(history.createdAt)}</p></li>)}</ol></Card> : null}
    {transactions.length ? <Card title="Points Transactions" sub={`${transactions.length} ${transactions.length === 1 ? 'transaction' : 'transactions'}`} body="table"><DataTable rows={transactions} columns={columns} rowKey={(row) => row.id} label="Points Transactions" pagination={false} /></Card> : null}
  </div>
}

