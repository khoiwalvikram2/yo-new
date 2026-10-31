import { useEffect, useMemo } from 'react'
import { useQuery } from '@apollo/client'
import { WHITELABEL_PAYMENT_METHODS } from '@/lib/graphql/deposits'
import { Checkbox } from '@/ui/components/Checkbox'
import { Notice } from '@/ui/components/Notice'

export type ReceivingAccountOption = { id: string; label: string; enabled: boolean; vipTierIds: string[] | null }

type Bank = { id: string; bankName?: string | null; accountName?: string | null; accountNumber?: string | null; enabled?: boolean | null; vipTierIds?: string[] | null }
type Upi = { id: string; upiId?: string | null; displayName?: string | null; enabled?: boolean | null; vipTierIds?: string[] | null }

/** null = every tier, [] = none; the same rule the server applies. */
const allowsTier = (ids: string[] | null, tierId: string) => ids == null || ids.includes(tierId)

/**
 * The receiving accounts a tier may use, chosen from the tier form; Payment Methods
 * edits the same setting from the account's side. The value stays null until the
 * accounts load, and a save leaves the accounts untouched while it is null.
 */
export function VipTierAccountsPicker({ tierId, value, onChange, onAccounts }: {
  tierId?: string
  value: string[] | null
  onChange: (ids: string[]) => void
  onAccounts?: (accounts: ReceivingAccountOption[]) => void
}) {
  const { data, loading, error } = useQuery<{ whitelabelPaymentMethods: { banks?: Bank[] | null; upis?: Upi[] | null } | null }>(
    WHITELABEL_PAYMENT_METHODS, { fetchPolicy: 'network-only' })
  const accounts = useMemo<ReceivingAccountOption[]>(() => [
    ...(data?.whitelabelPaymentMethods?.banks || []).map(bank => ({ id: bank.id, enabled: bank.enabled !== false, vipTierIds: bank.vipTierIds ?? null,
      label: `Bank · ${bank.bankName || bank.accountName || 'Account'}${bank.accountNumber ? ` ••${String(bank.accountNumber).slice(-4)}` : ''}` })),
    ...(data?.whitelabelPaymentMethods?.upis || []).map(upi => ({ id: upi.id, enabled: upi.enabled !== false, vipTierIds: upi.vipTierIds ?? null,
      label: `UPI · ${upi.displayName || upi.upiId || 'Account'}` })),
  ], [data])

  useEffect(() => {
    if (!data) return
    onAccounts?.(accounts)
    // A new tier joins the accounts that are open to every tier; an existing one
    // starts from the accounts that allow it today.
    if (value === null) onChange(accounts.filter(account => tierId ? allowsTier(account.vipTierIds, tierId) : account.vipTierIds == null).map(account => account.id))
    // Only a fresh load seeds the selection; the admin's later clicks own it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  return <fieldset style={{ gridColumn: '1 / -1', border: '1px solid var(--line)', borderRadius: 5, padding: 14, display: 'grid', gap: 12 }}>
    <legend>Receiving accounts</legend>
    {loading ? <p role="status">Loading receiving accounts…</p> : null}
    {error ? <Notice tone="error">Unable to load receiving accounts. Saving keeps their current tier access.</Notice> : null}
    {!loading && !error && !accounts.length ? <p>No bank or UPI accounts yet. Add them in Payment Methods.</p> : null}
    {value !== null ? accounts.map(account => <Checkbox key={account.id} label={`${account.label}${account.enabled ? '' : ' — inactive'}`}
      checked={value.includes(account.id)} onChange={checked => onChange(checked ? [...value, account.id] : value.filter(id => id !== account.id))} />) : null}
    {value !== null && accounts.length > 0 && !value.length
      ? <Notice tone="warn">No account selected: players on this tier cannot deposit by bank transfer or UPI.</Notice> : null}
  </fieldset>
}
