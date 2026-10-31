import { IconSettings, IconX } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import styles from '../ManagementPage.module.css'

interface MultiActionsProps {
  selectedCount: number
  onUpdate: () => void
  onClear: () => void
}

export function MultiActions({ selectedCount, onUpdate, onClear }: MultiActionsProps) {
  if (selectedCount <= 0) {
    return <span className={styles.selectionHint}>Select one or more games to update settings</span>
  }

  return (
    <div className={styles.multiActions}>
      <StatusPill status="active">{selectedCount} selected</StatusPill>
      <Button
        variant="primary"
        icon={<IconSettings size={14} stroke={strokeFor(14)} />}
        onClick={onUpdate}
      >
        Update Settings
      </Button>
      <Button icon={<IconX size={14} stroke={strokeFor(14)} />} onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}
