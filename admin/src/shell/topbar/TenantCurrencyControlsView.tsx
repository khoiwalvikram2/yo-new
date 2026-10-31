import type { TenantCurrencyState } from './useTenantCurrency'
import { IconAdjustmentsHorizontal } from '@tabler/icons-react'
import { Select } from '@/ui/components/Select'
import { IconButton } from '@/ui/components/IconButton'
import { Popover } from '@/ui/components/Popover'
import styles from './TenantCurrencyControls.module.css'

export interface TenantCurrencyControlsViewProps {
  state: TenantCurrencyState
  compact: boolean
}

export function TenantCurrencyControlsView(props: TenantCurrencyControlsViewProps) {
  const { state, compact } = props

  const selects = (
    <>
      <Select
        label="Tenant"
        hideLabel={!compact}
        size="sm"
        value={state.tenant}
        onChange={state.onTenantChange}
        options={state.tenantOptions}
        loading={state.tenantsLoading}
        title="Switch tenant"
      />
      <Select
        label="Currency"
        hideLabel={!compact}
        size="sm"
        value={state.currency}
        onChange={state.onCurrencyChange}
        options={state.currencyOptions}
        loading={state.currencyLoading}
        title={state.currencyTitle}
      />
    </>
  )

  if (!compact) {
    return <div className={styles.selects}>{selects}</div>
  }

  return (
    <Popover
      label="Filters"
      className={styles.filters}
      trigger={
        <IconButton label="Filters" icon={<IconAdjustmentsHorizontal size={18} stroke={1.6} />} />
      }
    >
      <div className={styles.filtersBody}>{selects}</div>
    </Popover>
  )
}
