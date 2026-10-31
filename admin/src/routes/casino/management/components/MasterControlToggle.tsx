import { useState } from 'react'
import { Switch } from '@/ui/components/Switch'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import styles from '../ManagementPage.module.css'

interface MasterControlToggleProps {
  gameId: string
  isActive: boolean
  onToggle: (gameId: string, isActive: boolean) => Promise<void>
  disabled?: boolean
}

export function MasterControlToggle({
  gameId,
  isActive,
  onToggle,
  disabled = false,
}: MasterControlToggleProps) {
  const [loading, setLoading] = useState(false)
  const description = isActive
    ? 'Game is globally active - all whitelabels can enable it'
    : 'Game is globally disabled - affects all whitelabels'

  return (
    <div className={styles.masterControl}>
      <Tooltip content={description}>
        <span>
          <Switch
            checked={isActive}
            label={description}
            hideLabel
            size="sm"
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            onChange={async (checked) => {
              setLoading(true)
              try {
                await onToggle(gameId, checked)
              } finally {
                setLoading(false)
              }
            }}
          />
        </span>
      </Tooltip>
      {!isActive ? <StatusPill status="blocked">Disabled by Platform</StatusPill> : null}
    </div>
  )
}
