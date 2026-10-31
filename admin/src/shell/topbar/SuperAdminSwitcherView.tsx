import { IconDatabase, IconUsers } from '@tabler/icons-react'
import clsx from 'clsx'
import { IconButton } from '@/ui/components/IconButton'
import { Popover } from '@/ui/components/Popover'
import { Select } from '@/ui/components/Select'
import { Switch } from '@/ui/components/Switch'
import type { SuperAdminModeState } from './useSuperAdminMode'
import styles from './SuperAdminSwitcher.module.css'

export interface SuperAdminSwitcherViewProps {
  state: SuperAdminModeState
  /** icon-only trigger + popover below 1024px, matching TenantCurrencyControlsView's "Filters" pattern */
  compact: boolean
}

/**
 * Presentational Super Admin mode switcher (spec Topbar; SuperAdminModeSwitcher.tsx:167-221 rebuilt with
 * the kit). The mode pill shows the current mode; the switch keeps the stable name "Whitelabel mode";
 * the whitelabel select shows only in whitelabel mode, with a placeholder for "nothing selected". Below
 * 1024px the pill and select no longer fit alongside the rest of the topbar, so they collapse into a
 * Popover behind an icon-only trigger (TenantCurrencyControlsView's "Filters" pattern).
 */
export function SuperAdminSwitcherView({ state, compact }: SuperAdminSwitcherViewProps) {
  if (!state.visible) return null

  const isWhitelabel = state.mode === 'whitelabel'
  const modeLabel = isWhitelabel ? 'Whitelabel' : 'Core'

  const content = (
    <div className={styles.root}>
      <div className={clsx(styles.modePill, isWhitelabel ? styles.modeWhitelabel : styles.modeCore)}>
        {isWhitelabel ? (
          <IconUsers size={14} stroke={1.75} aria-hidden="true" />
        ) : (
          <IconDatabase size={14} stroke={1.75} aria-hidden="true" />
        )}
        <span>{modeLabel}</span>
        <Switch
          checked={isWhitelabel}
          onChange={(checked) => state.setMode(checked ? 'whitelabel' : 'core')}
          label="Whitelabel mode"
          hideLabel
        />
      </div>

      {isWhitelabel && (
        <Select
          label="Whitelabel"
          hideLabel
          size="sm"
          className={styles.whitelabelSelect}
          placeholder="Select Whitelabel"
          value={state.selectedWhitelabelId ?? ''}
          options={state.whitelabels.map((wl) => ({ value: wl.id, label: wl.name }))}
          loading={state.whitelabelsLoading}
          onChange={state.selectWhitelabel}
        />
      )}
    </div>
  )

  if (!compact) return content

  return (
    <Popover
      label="Super Admin mode"
      trigger={
        <IconButton
          label={`Super Admin mode: ${modeLabel}`}
          icon={isWhitelabel ? <IconUsers size={18} stroke={1.6} /> : <IconDatabase size={18} stroke={1.6} />}
        />
      }
    >
      <div className={styles.popoverBody}>{content}</div>
    </Popover>
  )
}
