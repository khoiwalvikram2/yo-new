import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { IconDownload, IconEye, IconInbox } from '@tabler/icons-react'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { CopyButton } from '@/ui/components/CopyButton'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { StatusPill } from '@/ui/components/StatusPill'
import { toast } from '@/ui/components/toast'
import {
  exportFailureMessage,
  payoutAccountSummaryLines,
  payoutMethodLabel,
  payoutMethodTone,
  payoutStatusLabel,
  payoutTableContact,
  type PayoutAccountItem,
} from '../payoutAccountApprovalsModel'
import { exportPayoutAccountsToExcel } from '../utils/exportPayoutAccounts'
import styles from '../PayoutAccountApprovals.module.css'

// The export utility and the page read the row type from here, as they always have.
export type { PayoutAccountItem } from '../payoutAccountApprovalsModel'

type PayoutAccountsTableProps = {
  items: PayoutAccountItem[]
  fetching: boolean
  total?: number
  onView: (item: PayoutAccountItem) => void
  footer?: ReactNode
}

/**
 * The legacy Account Details cell: holder, number, IFSC and bank for a BANK account, holder and UPI ID
 * otherwise, each line with its copy action. Copy feedback names the line, as the legacy notification did.
 */
function AccountSummary({ account }: { account: PayoutAccountItem }) {
  const lines = payoutAccountSummaryLines(account)
  if (!lines.length) return <>—</>

  return (
    <dl className={styles.accountList}>
      {lines.map((line) => (
        <div key={line.key} className={styles.accountRow}>
          <dt className={styles.accountTerm}>{line.label}</dt>
          <dd className={styles.accountValue}>
            {line.mono ? (
              <code className={styles.accountText} title={line.value}>{line.value}</code>
            ) : (
              <span className={styles.accountText} title={line.value}>{line.value}</span>
            )}
            <CopyButton
              size="sm"
              value={line.value}
              label={`Copy ${line.label}`}
              copiedLabel={`${line.label} copied`}
              errorLabel="Failed to copy"
            />
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function PayoutAccountsTable({ items, fetching, total, onView, footer }: PayoutAccountsTableProps) {
  const { formatDate, formatTime } = useFormatDate()
  const [exporting, setExporting] = useState(false)

  // Exports the rows on screen (the current page), titled with the server total, as before.
  const handleExport = async () => {
    if (!items.length) {
      toast({ title: 'No Data', message: 'There are no payout accounts to export.', tone: 'warn' })
      return
    }
    setExporting(true)
    try {
      await exportPayoutAccountsToExcel(items, total ?? items.length)
      toast({ title: 'Export Complete', message: 'Payout accounts exported to Excel successfully.', tone: 'ok' })
    } catch (error: unknown) {
      toast({ title: 'Export Failed', message: exportFailureMessage(error), tone: 'error' })
    } finally {
      setExporting(false)
    }
  }

  const columns = useMemo<DataTableColumn<PayoutAccountItem>[]>(
    () => [
      {
        key: 'user',
        header: 'User',
        cell: (item) => (
          <div className={styles.stack}>
            {item.user?.id ? (
              <Link className={styles.playerLink} to={`/players/profile/${item.user.id}`}>
                {item.user.name || '—'}
              </Link>
            ) : (
              <span>{item.user?.name || '—'}</span>
            )}
            <span className={styles.secondary}>{payoutTableContact(item.user)}</span>
          </div>
        ),
      },
      {
        key: 'method',
        header: 'Type',
        cell: (item) => (
          <StatusPill tone={payoutMethodTone(item.method)}>{payoutMethodLabel(item.method)}</StatusPill>
        ),
      },
      {
        key: 'account',
        header: 'Account Details',
        cell: (item) => <AccountSummary account={item} />,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (item) => (
          <StatusPill status={item.approvalStatus}>{payoutStatusLabel(item.approvalStatus)}</StatusPill>
        ),
      },
      {
        key: 'createdAt',
        header: 'Created',
        cell: (item) => (
          <div className={styles.stack}>
            <span>{item.createdAt ? formatDate(item.createdAt, 'dd MMM yyyy') : '—'}</span>
            <span className={styles.secondary}>{item.createdAt ? formatTime(item.createdAt, 'HH:mm') : '—'}</span>
          </div>
        ),
      },
    ],
    [formatDate, formatTime],
  )

  const accountCount = total ?? items.length

  return (
    <Card
      title="Payout Account Approvals"
      sub={`${accountCount.toLocaleString()} ${accountCount === 1 ? 'account' : 'accounts'}`}
      body="table"
      tools={(
        <Button
          variant="primary"
          size="sm"
          icon={<IconDownload size={15} stroke={strokeFor(15)} />}
          loading={exporting}
          onClick={() => void handleExport()}
          disabled={!items.length || fetching}
        >
          Export Excel
        </Button>
      )}
    >
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(item) => item.id}
        label="Payout accounts"
        state={fetching ? 'loading' : 'ready'}
        width="wide"
        empty={(
          <EmptyState
            title="No payout accounts found"
            icon={<IconInbox size={20} stroke={strokeFor(20)} />}
          />
        )}
        rowActions={(item) => ({
          primary: (
            <IconButton
              size="sm"
              label={`View details for payout account ${item.id}`}
              icon={<IconEye size={15} stroke={strokeFor(15)} />}
              onClick={() => onView(item)}
            />
          ),
        })}
      />
      {footer}
    </Card>
  )
}
