import { useCurrency } from '@/shared/core/CurrencyContext'
import { useWhitelabels } from '@/shared/core/useWhitelabels'
import { useUIStore } from '@/shared/core/uiStore'
import type { SelectOption } from '@/ui/components/Select'

export interface TenantCurrencyState {
  tenant: string
  onTenantChange: (id: string) => void
  tenantOptions: SelectOption[]
  tenantsLoading: boolean
  currency: string
  onCurrencyChange: (code: string) => void
  currencyOptions: SelectOption[]
  currencyLoading: boolean
  currencyTitle: string
}

/**
 * Tenant/currency select state and handlers (Topbar.tsx:69-70, 110-111 and the select onChange
 * handlers at Topbar.tsx:221-252, verbatim logic).
 */
export function useTenantCurrency(): TenantCurrencyState {
  const tenant = useUIStore((s) => s.tenant)
  const setTenant = useUIStore((s) => s.setTenant)
  const { whitelabels, loading: tenantsLoading } = useWhitelabels()
  const {
    selectedCurrency,
    setSelectedCurrency,
    currencies,
    loading: currencyLoading,
    getWhitelabelBaseCurrencyCode,
  } = useCurrency()

  const onTenantChange = (id: string) => {
    setTenant(id)
    // Intentional, pre-existing (verbatim from Topbar.tsx:221-226): do not remove as "dead code".
    // Known gap this reload does NOT fix: the GraphQL link builds X-Tenant/X-Whitelabel-ID headers
    // from separate localStorage['TENANT']/['X_WHITELABEL_ID'] keys (set only at login, see
    // LoginPage.tsx), not from this store's `tenant` — so switching here does not actually change
    // which tenant's data subsequent requests are scoped to. Reload only refreshes the UI's own
    // display of the (unchanged) header value. Fixing this needs setTenant to also sync those two
    // localStorage keys; tracked as a follow-up, out of scope for this verbatim extraction task.
    window.location.reload()
  }

  const tenantOptions: SelectOption[] = whitelabels.map((whitelabel) => ({
    value: whitelabel.id,
    label: whitelabel.name,
  }))

  const currencyOptions: SelectOption[] = currencies
    .filter((currency) => currency.isActive)
    .map((currency) => ({
      value: currency.code,
      label: `${currency.symbol} ${currency.code}`,
    }))

  return {
    tenant,
    onTenantChange,
    tenantOptions,
    tenantsLoading,
    currency: selectedCurrency,
    onCurrencyChange: setSelectedCurrency,
    currencyOptions,
    currencyLoading,
    currencyTitle: `Display currency (Whitelabel base: ${getWhitelabelBaseCurrencyCode()})`,
  }
}
