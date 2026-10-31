import { IconEraser, IconSettings } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { strokeFor } from '@/ui/components/icons'
import styles from '../ManagementPage.module.css'

interface MultiActionsProps {
  onEnable?: () => void
  onDisable?: () => void
  onDelete?: () => void
  selectedCount?: number
  onUpdate?: () => void
  onClear?: () => void
}

export function MultiActions({
  onEnable,
  onDisable,
  onDelete,
  selectedCount,
  onUpdate,
  onClear,
}: MultiActionsProps) {
  return (
    <div className={styles.bulkActions}>
      {selectedCount !== undefined ? (
        <span className={styles.selectedCount} aria-live="polite">Selected: {selectedCount}</span>
      ) : null}
      {onUpdate ? (
        <Button
          size="sm"
          icon={<IconSettings size={15} stroke={strokeFor(15)} />}
          onClick={onUpdate}
          disabled={selectedCount === 0}
        >
          Update
        </Button>
      ) : null}
      {onClear ? (
        <Button
          size="sm"
          variant="ghost"
          icon={<IconEraser size={15} stroke={strokeFor(15)} />}
          onClick={onClear}
          disabled={selectedCount === 0}
        >
          Clear
        </Button>
      ) : null}
      {onEnable ? <Button size="sm" onClick={onEnable}>Enable</Button> : null}
      {onDisable ? <Button size="sm" onClick={onDisable}>Disable</Button> : null}
      {onDelete ? <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button> : null}
    </div>
  )
}
