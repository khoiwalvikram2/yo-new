import { useQuery } from '@apollo/client'
import { Link } from 'react-router-dom'
import { ADMIN_PAYOUT_ACCOUNTS } from '@/lib/graphql/payoutAccounts'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { CopyButton } from '@/ui/components/CopyButton'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from '../PlayerProfile.module.css'
interface PayoutAccount { id: string; method: string; approvalStatus: string; accountHolderName?: string | null; accountNumber?: string | null; ifscCode?: string | null; bankName?: string | null; rejectionReason?: string | null; createdAt: string }
function AccountValue({ label, value }: { label: string; value?: string | null }) {
  return value == null || value === '' ? null : <div className={styles.contact}><span className={styles.subtle}>{label}:</span><span>{value}</span><CopyButton value={value} label={`Copy ${label}`} copiedLabel={`${label} copied`} errorLabel="Failed to copy" size="sm" /></div>
}
export function PayoutAccountTab({ playerId }: { playerId: string }) {
  const { formatDate, formatTime } = useFormatDate()
  const { data, loading, error, refetch } = useQuery<{ adminPayoutAccounts: { items: PayoutAccount[]; total: number } }>(ADMIN_PAYOUT_ACCOUNTS, { variables: { input: { userId: playerId, limit: 100, offset: 0 } }, skip: !playerId, errorPolicy: 'all', fetchPolicy: 'network-only' })
  const items = data?.adminPayoutAccounts?.items || []
  const total = data?.adminPayoutAccounts?.total || 0
  const columns: DataTableColumn<PayoutAccount>[] = [
    { key: 'type', header: 'Type', cell: (row) => <StatusPill>{row.method === 'UPI' ? 'UPI' : 'Bank'}</StatusPill> },
    { key: 'details', header: 'Account Details', cell: (row) => <div className={styles.stack}>
      <AccountValue label="Holder" value={row.accountHolderName} />
      {row.method === 'BANK' ? <><AccountValue label="Acc No" value={row.accountNumber} /><AccountValue label="IFSC" value={row.ifscCode} /><AccountValue label="Bank" value={row.bankName} /></> : <AccountValue label="UPI" value={row.accountNumber} />}
      {row.rejectionReason && row.approvalStatus === 'REJECTED' ? <p className={styles.text}>Reason: {row.rejectionReason}</p> : null}
    </div> },
    { key: 'status', header: 'Status', cell: (row) => <StatusPill tone={row.approvalStatus === 'PENDING' ? 'warn' : row.approvalStatus === 'APPROVED' ? 'ok' : 'neg'}>{row.approvalStatus === 'PENDING' ? 'Pending' : row.approvalStatus === 'APPROVED' ? 'Approved' : 'Rejected'}</StatusPill> },
    { key: 'created', header: 'Created', cell: (row) => <div>{formatDate(row.createdAt, 'dd MMM yyyy')}<p className={styles.subtle}>{formatTime(row.createdAt, 'HH:mm')}</p></div> },
  ]
  return <Card title="Payout Accounts" sub="Accounts added by the player for withdrawals" body="table" tools={<Button size="sm" loading={loading} onClick={() => void refetch()}>Refresh</Button>}>
    <DataTable rows={items} columns={columns} rowKey={(row) => row.id} label="Payout Accounts" pagination={false} state={loading ? 'loading' : error ? 'error' : 'ready'} error={error?.message || 'Failed to load payout accounts'} onRetry={() => void refetch()} empty={<EmptyState title="No payout accounts added by this player yet" />} />
    {!loading && !error && total > 0 ? <div className={styles.tableFooter}><span>{total} {total === 1 ? 'account' : 'accounts'}</span><Link className={styles.link} to="/payments/payout-approvals">Manage payout approvals →</Link></div> : null}
  </Card>
}
