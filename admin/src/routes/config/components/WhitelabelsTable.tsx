import { useMemo, useState, type MouseEvent } from 'react'
import {
  IconBolt,
  IconCash,
  IconDots,
  IconDownload,
  IconEye,
  IconKey,
  IconLoader2,
  IconSettings,
  IconWorld,
} from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useTableExport } from '@/shared/hooks/useTableExport'
import type { TableExportColumn } from '@/shared/utils/tableExport'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { Menu, MenuItem, MenuSeparator } from '@/ui/components/Menu'
import { SearchField } from '@/ui/components/SearchField'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import {
  PAGE_SIZE_OPTIONS,
  appConfigurationPath,
  countLabel,
  creditStanding,
  shareChipText,
  shareRatesExportText,
  shareRatesFor,
  whitelabelStatusLabel,
  whitelabelStatusTone,
  type Whitelabel,
  type WhitelabelStatusTone,
} from '../whitelabelsListModel'
import styles from '../WhitelabelsListPage.module.css'

const ROW_ICON = 15
const MENU_ICON = 16

export interface WhitelabelsTableProps {
  /** The rows on the current page. */
  rows: readonly Whitelabel[]
  /** Every row matching the search; exports must not stop at the current page. */
  exportRows: Whitelabel[]
  total: number
  fetching: boolean
  search: string
  onSearchChange: (value: string) => void
  onViewDetails: (whitelabel: Whitelabel, event: MouseEvent<HTMLElement>) => void
  onTrigger: (event: MouseEvent<HTMLElement>) => void
  onAdjustCredit: (whitelabel: Whitelabel) => void
  onGenerateCategories: (whitelabel: Whitelabel) => void
  onResetAdminPassword?: (whitelabel: Whitelabel) => void
  generatingTenantId?: string | null
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

function Favicon({ whitelabel }: { whitelabel: Whitelabel }) {
  const [failed, setFailed] = useState(false)
  if (!whitelabel.faviconUrl || failed) return <Avatar name={whitelabel.name} size={34} hue="auto" />
  return (
    <span className={styles.favicon}>
      <img
        src={whitelabel.faviconUrl}
        alt={`${whitelabel.name} favicon`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </span>
  )
}

function amountToneClass(tone: WhitelabelStatusTone): string {
  if (tone === 'neg') return styles.amountNeg
  if (tone === 'warn') return styles.amountWarn
  return styles.amountOk
}

export function WhitelabelsTable({
  rows,
  exportRows,
  total,
  fetching,
  search,
  onSearchChange,
  onViewDetails,
  onTrigger,
  onAdjustCredit,
  onGenerateCategories,
  onResetAdminPassword,
  generatingTenantId,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: WhitelabelsTableProps) {
  const navigate = useNavigate()
  const { formatAmount } = useCurrency()

  const exportColumns: TableExportColumn<Whitelabel>[] = useMemo(
    () => [
      { header: 'Name', key: 'name', width: 22, getter: (w) => w.name ?? '' },
      { header: 'ID', key: 'id', width: 28, getter: (w) => w.id ?? '' },
      { header: 'Primary Domain', key: 'domain', width: 14, getter: (w) => w.domain ?? '' },
      { header: 'Share %', key: 'shareRates', width: 24, getter: shareRatesExportText },
      { header: 'Credit Limit', key: 'creditLimit', width: 14, getter: (w) => (w.creditLimit != null ? Number(w.creditLimit) : null) },
      { header: 'Credit Available', key: 'creditAvailable', width: 16, getter: (w) => (w.creditAvailable != null ? Number(w.creditAvailable) : null) },
      { header: 'Credit Used', key: 'creditUsed', width: 14, getter: (w) => (w.creditUsed != null ? Number(w.creditUsed) : null) },
      { header: 'Status', key: 'status', width: 12, getter: (w) => w.status ?? '' },
    ],
    [],
  )

  const { exporting, handleExport } = useTableExport({
    data: exportRows,
    columns: exportColumns,
    filename: 'Whitelabels',
    sheetName: 'Whitelabels',
    title: `Whitelabels — ${exportRows.length} whitelabel(s)`,
  })

  const columns: DataTableColumn<Whitelabel>[] = [
    {
      key: 'whitelabel',
      header: 'Whitelabel',
      minWidth: 224,
      cell: (whitelabel) => (
        <span className={styles.identity}>
          <Favicon key={whitelabel.faviconUrl || whitelabel.id} whitelabel={whitelabel} />
          <span className={styles.identityCopy}>
            <span className={styles.identityName}>{whitelabel.name}</span>
            <span className={styles.identityId}>ID: {whitelabel.id}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'domain',
      header: 'Primary Domain',
      minWidth: 156,
      cell: (whitelabel) => <span className={styles.domain}>{whitelabel.domain}</span>,
    },
    {
      key: 'share',
      header: 'Share %',
      minWidth: 224,
      cell: (whitelabel) => (
        <span className={styles.shareRates}>
          {shareRatesFor(whitelabel).map((rate) => (
            <StatusPill key={rate.domain} tone={rate.rate > 0 ? 'info' : 'muted'}>
              {shareChipText(rate)}
            </StatusPill>
          ))}
        </span>
      ),
    },
    {
      key: 'creditLimit',
      header: 'Credit Limit',
      align: 'right',
      minWidth: 132,
      cell: (whitelabel) => <span className={styles.amount}>{formatAmount(Number(whitelabel.creditLimit || 0))}</span>,
    },
    {
      key: 'creditAvailable',
      header: 'Credit Available',
      align: 'right',
      minWidth: 148,
      cell: (whitelabel) => {
        const standing = creditStanding(whitelabel)
        return (
          <span className={styles.amountStack}>
            <span className={amountToneClass(standing.tone)}>{formatAmount(standing.available)}</span>
            <span className={styles.secondary}>{standing.usageText}</span>
          </span>
        )
      },
    },
    {
      key: 'creditUsed',
      header: 'Credit Used',
      align: 'right',
      minWidth: 124,
      cell: (whitelabel) => <span className={styles.amount}>{formatAmount(Number(whitelabel.creditUsed || 0))}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      minWidth: 104,
      cell: (whitelabel) => (
        <StatusPill tone={whitelabelStatusTone(whitelabel.status)}>
          {whitelabelStatusLabel(whitelabel.status)}
        </StatusPill>
      ),
    },
  ]

  const menuIcon = (Glyph: typeof IconCash, spinning = false) => (
    <Glyph
      size={MENU_ICON}
      stroke={strokeFor(MENU_ICON)}
      className={spinning ? styles.spin : undefined}
    />
  )

  return (
    <Card
      title="Whitelabels List"
      sub={countLabel(total)}
      body="table"
      tools={(
        <>
          <SearchField
            className={styles.search}
            size="sm"
            label="Search whitelabels"
            placeholder="Search by name or domain"
            value={search}
            onChange={onSearchChange}
          />
          <Button
            variant="primary"
            size="sm"
            icon={<IconDownload size={ROW_ICON} stroke={strokeFor(ROW_ICON)} />}
            loading={exporting}
            disabled={!total || fetching}
            onClick={() => void handleExport()}
          >
            Export Excel
          </Button>
        </>
      )}
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(whitelabel) => whitelabel.id}
        label="Whitelabels"
        state={fetching ? 'loading' : 'ready'}
        width="wide"
        empty={(
          <EmptyState
            title="No whitelabels found"
            icon={<IconWorld size={20} stroke={strokeFor(20)} />}
          />
        )}
        pagination={
          total > 0
            ? {
                current: page,
                pageSize,
                total,
                onChange: onPageChange,
                onPageSizeChange,
                itemName: 'whitelabels',
                pageSizeOptions: PAGE_SIZE_OPTIONS,
              }
            : false
        }
        rowActions={(whitelabel) => ({
          primary: (
            <span className={styles.rowActions}>
              <Tooltip content="View Details">
                <IconButton
                  size="sm"
                  label={`View details for ${whitelabel.name}`}
                  icon={<IconEye size={ROW_ICON} stroke={strokeFor(ROW_ICON)} />}
                  onClick={(event) => onViewDetails(whitelabel, event)}
                />
              </Tooltip>
              <Menu
                trigger={(
                  <IconButton
                    size="sm"
                    label={`More actions for ${whitelabel.name}`}
                    icon={<IconDots size={ROW_ICON} stroke={strokeFor(ROW_ICON)} />}
                    onClick={onTrigger}
                  />
                )}
              >
                <MenuItem icon={menuIcon(IconCash)} onSelect={() => onAdjustCredit(whitelabel)}>
                  Adjust Credit
                </MenuItem>
                <MenuItem icon={menuIcon(IconSettings)} onSelect={() => navigate(appConfigurationPath(whitelabel.id))}>
                  App Configuration
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  icon={menuIcon(generatingTenantId === whitelabel.id ? IconLoader2 : IconBolt, generatingTenantId === whitelabel.id)}
                  disabled={generatingTenantId === whitelabel.id}
                  onSelect={() => onGenerateCategories(whitelabel)}
                >
                  {generatingTenantId === whitelabel.id ? 'Generating casino categories…' : 'Generate casino categories'}
                </MenuItem>
                {onResetAdminPassword ? (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      icon={menuIcon(IconKey)}
                      tone="danger"
                      onSelect={() => onResetAdminPassword(whitelabel)}
                    >
                      Reset Admin Password
                    </MenuItem>
                  </>
                ) : null}
              </Menu>
            </span>
          ),
        })}
      />
    </Card>
  )
}
