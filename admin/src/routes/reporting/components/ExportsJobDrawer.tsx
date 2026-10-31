import { IconCloudDownload } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { DescriptionList, type DescriptionListItem } from '@/ui/components/DescriptionList'
import { Drawer } from '@/ui/components/Drawer'
import { Notice } from '@/ui/components/Notice'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import { exportJobStatusLabel, exportTypeName, isPendingJob, type ExportJob } from '../exportsPageModel'
import { ExportsFormatGlyph } from './ExportsTypeGlyph'
import styles from '../ExportsPage.module.css'

/* The Export Center's job details (page migration C, W3 Task 128). The mockup draws no export drawer;
 * this is the approved drawer (M:1136-1167, as on Deposit Requests) at the mockup's own width,
 * min(420px, 100%) (M:1137), holding the legacy details, notices and download. */

type FormatDateTime = (date: string | Date, formatStr?: string) => string

export interface ExportsJobDrawerProps {
  open: boolean
  job: ExportJob | null
  onClose: () => void
  onDownload: (job: ExportJob) => void
  formatDateTime: FormatDateTime
}

export function ExportsJobDrawer({ open, job, onClose, onDownload, formatDateTime }: ExportsJobDrawerProps) {
  const items: DescriptionListItem[] = job
    ? [
        { key: 'type', term: 'Export Type', value: exportTypeName(job.reportType) },
        {
          key: 'format',
          term: 'Format',
          value: (
            <span className={styles.formatTag}>
              <ExportsFormatGlyph format={job.exportFormat} size={12} />
              {job.exportFormat}
            </span>
          ),
        },
        {
          key: 'status',
          term: 'Status',
          value: <StatusPill status={job.status}>{exportJobStatusLabel(job.status)}</StatusPill>,
        },
        {
          key: 'created',
          term: 'Created',
          value: job.createdAt ? formatDateTime(job.createdAt, 'yyyy-MM-dd HH:mm:ss') : '—',
        },
        ...(job.completedAt
          ? [{ key: 'completed', term: 'Completed', value: formatDateTime(job.completedAt, 'yyyy-MM-dd HH:mm:ss') }]
          : []),
      ]
    : []

  const canDownload = Boolean(job && job.status === 'completed' && job.fileUrl)

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Export Details"
      size="sm"
      footer={job && canDownload ? (
        <Button
          variant="primary"
          size="lg"
          block
          icon={<IconCloudDownload size={18} stroke={strokeFor(18)} />}
          onClick={() => onDownload(job)}
        >
          {`Download File (${job.exportFormat})`}
        </Button>
      ) : undefined}
    >
      {job ? (
        <div className={styles.drawerBody}>
          <DescriptionList items={items} />
          {job.errorMessage ? (
            <Notice tone="error" title="Error">
              {job.errorMessage}
            </Notice>
          ) : null}
          {isPendingJob(job) ? (
            <Notice tone="info" title="Export in Progress">
              Your export is being processed. The download button will appear once it&apos;s completed.
            </Notice>
          ) : job.status === 'failed' ? (
            <Notice tone="error" title="Export Failed">
              {job.errorMessage || 'The export could not be completed. Please try again.'}
            </Notice>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  )
}
