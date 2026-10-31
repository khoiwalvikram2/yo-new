import { useState } from 'react'
import { IconClock, IconCircleX, IconDownload, IconEye, IconRefresh } from '@tabler/icons-react'
import clsx from 'clsx'
import { Badge } from '@/ui/components/Badge'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { Notice } from '@/ui/components/Notice'
import type { PaginationProps } from '@/ui/components/Pagination'
import { Select } from '@/ui/components/Select'
import { Spinner } from '@/ui/components/Spinner'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import {
  HISTORY_PAGE_SIZE_OPTIONS,
  HISTORY_STATUS_OPTIONS,
  exportJobStatusLabel,
  exportTypeById,
  exportTypeExcerpt,
  exportTypeName,
  historyRangeText,
  inProgressMessage,
  isPendingJob,
  type ExportJob,
} from '../exportsPageModel'
import { ExportsFormatGlyph, ExportsTypeGlyph } from './ExportsTypeGlyph'
import styles from '../ExportsPage.module.css'

/* The Export Center's History tab (page migration C, W3 Task 128). The job table is the mockup's
 * Export Center page (M:2531-2538: the generic table template, M:3361-3409); its Range and Rows
 * columns have no data in the history query and are not built (D13, record). The status filter,
 * the in-progress notice, the expandable rows and the actions keep the legacy behaviour. */

type FormatDateTime = (date: string | Date, formatStr?: string) => string

export interface ExportsHistoryPanelProps {
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  jobs: readonly ExportJob[]
  loading: boolean
  /** The history query failed and returned no rows. */
  failed: boolean
  statusFilter: string | undefined
  onStatusChange: (status: string | undefined) => void
  onRefresh: () => void
  onDownload: (job: ExportJob) => void
  onDetails: (job: ExportJob) => void
  formatDateTime: FormatDateTime
}

function DateCell({ date, formatDateTime, empty }: { date?: string | null; formatDateTime: FormatDateTime; empty: string }) {
  if (!date) return <span className={styles.dim}>{empty}</span>
  return (
    <span className={styles.twoLine}>
      <span>{formatDateTime(date, 'MMM d, yyyy')}</span>
      <span className={styles.dim}>{formatDateTime(date, 'HH:mm:ss')}</span>
    </span>
  )
}

/* The legacy expanded row: the error, a running job's note, or the job's two moments. */
function JobExpansion({ job, formatDateTime }: { job: ExportJob; formatDateTime: FormatDateTime }) {
  if (job.errorMessage) {
    return (
      <Notice tone="error" title="Export Error Details">
        {job.errorMessage}
      </Notice>
    )
  }
  if (job.status === 'processing') {
    return (
      <p className={styles.processingNote}>
        <Spinner size="sm" decorative />
        Your export is being processed. This page will auto-refresh every 3 seconds.
      </p>
    )
  }
  return (
    <ol className={styles.timeline}>
      <li className={styles.timelineItem}>
        <span className={styles.timelineDot} aria-hidden="true" />
        <span className={styles.timelineText}>
          <span className={styles.timelineTitle}>Export Created</span>
          <span className={styles.dim}>
            {job.createdAt ? formatDateTime(job.createdAt, 'yyyy-MM-dd HH:mm:ss') : '—'}
          </span>
        </span>
      </li>
      {job.completedAt ? (
        <li className={styles.timelineItem}>
          <span className={clsx(styles.timelineDot, styles.timelineDone)} aria-hidden="true" />
          <span className={styles.timelineText}>
            <span className={styles.timelineTitle}>Export Completed</span>
            <span className={styles.dim}>{formatDateTime(job.completedAt, 'yyyy-MM-dd HH:mm:ss')}</span>
          </span>
        </li>
      ) : null}
    </ol>
  )
}

export function ExportsHistoryPanel({
  jobs, total, page, pageSize, onPageChange, onPageSizeChange,
  loading,
  failed,
  statusFilter,
  onStatusChange,
  onRefresh,
  onDownload,
  onDetails,
  formatDateTime,
}: ExportsHistoryPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const pendingJobs = jobs.filter(isPendingJob)

  const toggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const columns: DataTableColumn<ExportJob>[] = [
    {
      key: 'reportType',
      header: 'Export Type',
      cell: (job) => (
        <span className={styles.typeCell}>
          <span className={styles.typeIcon} aria-hidden="true">
            <ExportsTypeGlyph glyph={exportTypeById(job.reportType)?.glyph} size={16} />
          </span>
          <span className={styles.typeCellText}>
            <span className={styles.typeCellName}>{exportTypeName(job.reportType)}</span>
            <span className={styles.dim}>{exportTypeExcerpt(job.reportType)}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'exportFormat',
      header: 'Format',
      cell: (job) => (
        <span className={styles.formatTag}>
          <ExportsFormatGlyph format={job.exportFormat} size={12} />
          {job.exportFormat}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (job) => <StatusPill status={job.status}>{exportJobStatusLabel(job.status)}</StatusPill>,
    },
    {
      key: 'createdAt',
      header: 'Created',
      cell: (job) => <DateCell date={job.createdAt} formatDateTime={formatDateTime} empty="—" />,
    },
    {
      key: 'completedAt',
      header: 'Completed',
      cell: (job) => <DateCell date={job.completedAt} formatDateTime={formatDateTime} empty="-" />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      sticky: 'end',
      cell: (job) => (
        <span className={styles.rowActions}>
          {job.status === 'completed' && job.fileUrl ? (
            <Button
              size="xs"
              variant="primary"
              icon={<IconDownload size={14} stroke={strokeFor(14)} />}
              onClick={() => onDownload(job)}
            >
              Download
            </Button>
          ) : isPendingJob(job) ? (
            <Tooltip content="Export is being processed. Download will be available once completed.">
              <Button size="xs" icon={<IconClock size={14} stroke={strokeFor(14)} />} aria-disabled>
                Processing
              </Button>
            </Tooltip>
          ) : job.status === 'failed' ? (
            <Tooltip content={job.errorMessage || 'Export failed'}>
              <Button size="xs" variant="danger" icon={<IconCircleX size={14} stroke={strokeFor(14)} />}>
                Failed
              </Button>
            </Tooltip>
          ) : null}
          <Button size="xs" icon={<IconEye size={14} stroke={strokeFor(14)} />} onClick={() => onDetails(job)}>
            Details
          </Button>
        </span>
      ),
    },
  ]

  const current = page

  /* antd's pager: 10 a page, sizes 10/20/50/100, "1-10 of 42 exports", and none for an empty table. A
     poll that shrinks the list keeps the page, shown at the nearest one that exists. */
  const pagination: PaginationProps | false = total > 0
    ? {
        current,
        pageSize,
        total,
        onChange: onPageChange,
        onPageSizeChange: (size) => {
          onPageSizeChange(size)
        },
        itemName: 'exports',
        pageSizeOptions: HISTORY_PAGE_SIZE_OPTIONS,
        formatSummary: ({ start, end, total }) => historyRangeText(start, end, total),
        variant: 'embedded',
      }
    : false

  return (
    <div className={styles.panel}>
      {/* Filter Section */}
      <FilterBar
        label="Filters"
        activeCount={statusFilter ? 1 : 0}
        onClearAll={() => onStatusChange(undefined)}
      >
        <Select
          label="Status"
          hideLabel
          size="sm"
          value={statusFilter ?? ''}
          options={HISTORY_STATUS_OPTIONS}
          onChange={(value) => onStatusChange(value || undefined)}
        />
      </FilterBar>

      <Card
        title="Export History"
        sub={(
          <>
            Total: <strong className={styles.total}>{jobs.length}</strong> exports
          </>
        )}
        tools={(
          <>
            {pendingJobs.length > 0 ? (
              <span className={styles.categoryCount} title={`${pendingJobs.length} job(s) in progress`}>
                <Badge count={pendingJobs.length} tone="solid" aria-hidden="true" />
                <span className={styles.srOnly}>{`${pendingJobs.length} job(s) in progress`}</span>
              </span>
            ) : null}
            <Button size="sm" icon={<IconRefresh size={15} stroke={strokeFor(15)} />} onClick={onRefresh}>
              Refresh
            </Button>
          </>
        )}
        body="table"
      >
        {pendingJobs.length > 0 ? (
          <div className={styles.tableNotice}>
            <Notice
              tone="info"
              action={(
                <Button size="sm" onClick={onRefresh}>
                  Refresh Now
                </Button>
              )}
            >
              {inProgressMessage(pendingJobs.length)}
            </Notice>
          </div>
        ) : null}

        <DataTable
          label="Export history"
          columns={columns}
          rows={jobs}
          rowKey={(job) => job.id}
          width="wide"
          state={loading ? 'loading' : failed ? 'error' : 'ready'}
          error="Export history could not be loaded."
          onRetry={onRefresh}
          empty={<EmptyState inset="none" title="No exports yet. Create your first export from the Create Export tab." />}
          expandable={{
            expanded,
            onToggle: toggle,
            render: (job) => <JobExpansion job={job} formatDateTime={formatDateTime} />,
          }}
          pagination={pagination}
        />
      </Card>
    </div>
  )
}
