import type { ReactNode } from 'react'
import {
  IconBan,
  IconCircleCheck,
  IconDownload,
  IconInbox,
  IconPencil,
  IconTrash,
} from '@tabler/icons-react'
import type { Currency } from '@/shared/types/currency'
import { useCurrencyActions } from '@/shared/core/useCurrency'
import { useTableExport } from '@/shared/hooks/useTableExport'
import {
  CURRENCY_EXPORT_COLUMNS,
  currencyCountLabel,
  exportTitle,
  formatExchangeRate,
} from '@/routes/currency/currencyManagementModel'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { confirm } from '@/ui/components/confirm'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { Spinner } from '@/ui/components/Spinner'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import styles from './CurrencyTable.module.css'

interface CurrencyTableProps {
  currencies: Currency[]
  loading?: boolean
  /** currency.list update: Edit, Activate and Deactivate. Without it they are not offered (the server refuses them). */
  canUpdate: boolean
  /** currency.list delete. */
  canDelete: boolean
  onEdit: (currency: Currency) => void
  footer?: ReactNode
}

interface ActionBusy {
  activate: boolean
  deactivate: boolean
  delete: boolean
}

const ACTION_ICON_SIZE = 15

/** An action's glyph, or a spinner while that kind of action runs (the legacy shared `loading` flags). */
function actionIcon(busy: boolean, icon: ReactNode) {
  return busy ? <Spinner size="sm" decorative /> : icon
}

function RowActions({
  currency,
  busy,
  canUpdate,
  canDelete,
  onEdit,
  onActivate,
  onDeactivate,
  onDelete,
}: {
  currency: Currency
  busy: ActionBusy
  canUpdate: boolean
  canDelete: boolean
  onEdit: () => void
  onActivate: () => void
  onDeactivate: () => void
  onDelete: () => void
}) {
  // An active currency cannot be deleted (legacy: a disabled button and Popconfirm); the control stays
  // focusable so its tooltip is reachable.
  const deleteBlocked = currency.isActive || busy.delete
  return (
    <span className={styles.rowActions}>
      {canUpdate ? (
        <Tooltip content="Edit Currency">
          <IconButton
            size="sm"
            label={`Edit ${currency.code}`}
            icon={<IconPencil size={ACTION_ICON_SIZE} stroke={strokeFor(ACTION_ICON_SIZE)} />}
            onClick={onEdit}
          />
        </Tooltip>
      ) : null}
      {!canUpdate ? null : currency.isActive ? (
        <Tooltip content="Deactivate Currency">
          <IconButton
            size="sm"
            label={`Deactivate ${currency.code}`}
            icon={actionIcon(busy.deactivate, <IconBan size={ACTION_ICON_SIZE} stroke={strokeFor(ACTION_ICON_SIZE)} />)}
            aria-disabled={busy.deactivate ? true : undefined}
            aria-busy={busy.deactivate ? true : undefined}
            onClick={onDeactivate}
          />
        </Tooltip>
      ) : (
        <Tooltip content="Activate Currency">
          <IconButton
            size="sm"
            label={`Activate ${currency.code}`}
            icon={actionIcon(busy.activate, <IconCircleCheck size={ACTION_ICON_SIZE} stroke={strokeFor(ACTION_ICON_SIZE)} />)}
            aria-disabled={busy.activate ? true : undefined}
            aria-busy={busy.activate ? true : undefined}
            onClick={onActivate}
          />
        </Tooltip>
      )}
      {canDelete ? (
        <Tooltip content="Delete Currency">
          <IconButton
            size="sm"
            label={`Delete ${currency.code}`}
            icon={actionIcon(busy.delete, <IconTrash size={ACTION_ICON_SIZE} stroke={strokeFor(ACTION_ICON_SIZE)} />)}
            aria-disabled={deleteBlocked ? true : undefined}
            aria-busy={busy.delete ? true : undefined}
            onClick={onDelete}
          />
        </Tooltip>
      ) : null}
    </span>
  )
}

/**
 * The currencies card: the rows of the current page, their actions and Export Excel (which, as before,
 * exports the rows it is given). The table's own mutations, confirmations and copy are the legacy ones; the
 * Apollo notification link still reports each action's server message.
 */
export function CurrencyTable({
  currencies,
  loading = false,
  canUpdate,
  canDelete,
  onEdit,
  footer,
}: CurrencyTableProps) {
  const { deleteCurrency, activateCurrency, deactivateCurrency, loading: actionLoading } = useCurrencyActions()

  const handleDelete = async (code: string) => {
    await deleteCurrency(code)
  }

  const handleActivate = async (code: string) => {
    await activateCurrency(code)
  }

  const handleDeactivate = async (code: string) => {
    await deactivateCurrency(code)
  }

  const { exporting, handleExport } = useTableExport({
    data: currencies,
    columns: CURRENCY_EXPORT_COLUMNS,
    filename: 'Currencies',
    sheetName: 'Currencies',
    title: exportTitle(currencies.length),
  })

  // The legacy Popconfirm copy, now the modal confirmation (D5). A rejected mutation keeps it open with its
  // error for a retry.
  const requestDeactivate = (code: string) => {
    void confirm({
      title: 'Deactivate currency?',
      confirmLabel: 'Deactivate',
      cancelLabel: 'Cancel',
      onConfirm: () => handleDeactivate(code),
    })
  }

  const requestDelete = (currency: Currency) => {
    if (currency.isActive || actionLoading.delete) return
    void confirm({
      title: 'Delete currency?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => handleDelete(currency.code),
    })
  }

  // No confirmation, as before. A failure is reported by the Apollo error link; the rejection is not
  // rethrown from the click.
  const activate = (code: string) => {
    handleActivate(code).catch(() => undefined)
  }

  const busy: ActionBusy = {
    activate: actionLoading.activate,
    deactivate: actionLoading.deactivate,
    delete: actionLoading.delete,
  }

  const columns: DataTableColumn<Currency>[] = [
    {
      key: 'currency',
      header: 'Currency',
      cell: (currency) => (
        <div className={styles.currencyCell}>
          <span className={styles.symbolTile} aria-hidden="true">{currency.symbol}</span>
          <span className={styles.currencyText}>
            <span className={styles.currencyName} title={currency.name}>{currency.name}</span>
            <span className={styles.currencyCode}>{currency.code}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      cell: (currency) => <span className={styles.codePill}>{currency.code}</span>,
    },
    {
      key: 'symbol',
      header: 'Symbol',
      cell: (currency) => <span className={styles.figure}>{currency.symbol}</span>,
    },
    {
      key: 'decimals',
      header: 'Decimals',
      align: 'center',
      cell: (currency) => <span className={styles.figure}>{currency.decimals}</span>,
    },
    {
      key: 'exchangeRate',
      header: 'Exchange Rate',
      align: 'right',
      cell: (currency) => <span className={styles.rate}>{formatExchangeRate(currency.exchangeRate)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (currency) => (
        currency.isActive
          ? <StatusPill tone="ok">Active</StatusPill>
          : <StatusPill tone="neg">Inactive</StatusPill>
      ),
    },
  ]

  return (
    <Card
      title="Currencies List"
      sub={currencyCountLabel(currencies.length)}
      body="table"
      tools={(
        <Button
          variant="primary"
          size="sm"
          icon={<IconDownload size={15} stroke={strokeFor(15)} />}
          loading={exporting}
          onClick={() => void handleExport()}
          disabled={!currencies.length || loading}
        >
          Export Excel
        </Button>
      )}
    >
      <DataTable
        columns={columns}
        rows={currencies}
        rowKey={(currency) => currency.code}
        label="Currencies"
        state={loading ? 'loading' : 'ready'}
        empty={(
          <EmptyState
            title="No currencies found"
            icon={<IconInbox size={20} stroke={strokeFor(20)} />}
          />
        )}
        rowActions={canUpdate || canDelete ? (currency) => ({
          primary: (
            <RowActions
              currency={currency}
              busy={busy}
              canUpdate={canUpdate}
              canDelete={canDelete}
              onEdit={() => onEdit(currency)}
              onActivate={() => {
                if (!busy.activate) activate(currency.code)
              }}
              onDeactivate={() => {
                if (!busy.deactivate) requestDeactivate(currency.code)
              }}
              onDelete={() => requestDelete(currency)}
            />
          ),
        }) : undefined}
      />
      {footer}
    </Card>
  )
}
