import { useTenantCurrency } from './useTenantCurrency'
import { TenantCurrencyControlsView } from './TenantCurrencyControlsView'

export interface TenantCurrencyControlsProps {
  compact: boolean
}

export function TenantCurrencyControls(props: TenantCurrencyControlsProps) {
  const state = useTenantCurrency()
  return <TenantCurrencyControlsView state={state} compact={props.compact} />
}
