import { IconRefresh, IconSettings, IconPrinter } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import styles from './AuditSurfaces.module.css'
interface AuditTableToolbarProps {
  eventsLength: number
  total: number
  onOpenColumnSettings: () => void
  onPrint: () => void
  onRefresh: () => void
}
export function AuditTableToolbar({ eventsLength, total, onOpenColumnSettings, onPrint, onRefresh }: AuditTableToolbarProps) {
  return <div className={styles.toolbar}><div><h2 className={styles.sectionTitle}>Audit Events</h2><p className={styles.secondary}>{eventsLength} of {total} events</p></div>
    <div className={styles.actions}>
      <Button icon={<IconSettings size={16} />} onClick={onOpenColumnSettings}>Column Settings</Button>
      <Button icon={<IconPrinter size={16} />} onClick={onPrint}>Print Table</Button>
      <Button icon={<IconRefresh size={16} />} onClick={onRefresh}>Refresh</Button>
    </div>
  </div>
}
