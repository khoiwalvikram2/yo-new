import { gql, useQuery } from '@apollo/client'
import { Select } from '@/ui/components/Select'
import { Checkbox } from '@/ui/components/Checkbox'
import { Notice } from '@/ui/components/Notice'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'

const OPTIONS = gql`query DepositVipTierOptions { vipTiers { id name level status } }`
export function VipTierAccessPicker({ value, onChange, error }: {
  value: string[] | null | undefined
  onChange: (value: string[] | null) => void
  error?: string
}) {
  const { data, loading, error: loadError, refetch } = useQuery<{ vipTiers: Array<{ id: string; name: string; level: number; status: string }> }>(OPTIONS, { fetchPolicy: 'network-only' })
  useEffect(() => {
    const refresh = () => { void refetch().catch(() => {}) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refetch])
  const tiers = [...(data?.vipTiers || [])].sort((a, b) => a.level - b.level)
  return <section style={{ gridColumn: '1 / -1', display: 'grid', gap: 12 }} aria-label="VIP tier access">
    <Select label="VIP tier access" value={value == null ? 'ALL' : 'SELECTED'} layout="stacked"
      options={[{ value: 'ALL', label: 'All eligible tiers' }, { value: 'SELECTED', label: 'Selected tiers only' }]}
      onChange={mode => onChange(mode === 'ALL' ? null : value || [])} />
    {value != null ? <fieldset style={{ border: '1px solid var(--line)', borderRadius: 5, padding: 14, display: 'grid', gap: 12 }}>
      <legend>Allowed VIP tiers</legend>
      {loading ? <p role="status">Loading VIP tiers…</p> : null}
      {loadError ? <Notice tone="error">Unable to load tiers. Existing selections are preserved; retry before changing them.</Notice> : null}
      {tiers.map(tier => <Checkbox key={tier.id} label={`${tier.name} (L${tier.level})${tier.status !== 'active' ? ' — inactive' : ''}`}
        checked={value.includes(tier.id)} disabled={!!loadError || loading} onChange={checked => onChange(checked ? [...value, tier.id] : value.filter(id => id !== tier.id))} />)}
      {error ? <p role="alert">{error}</p> : null}
    </fieldset> : null}
    <p>Credit-agent players are excluded. A player without a manual assignment uses their automatic tier, starting at Bronze.</p>
    <Link to="/vip/tiers/create" target="_blank" rel="noopener noreferrer">Create a VIP tier</Link>
  </section>
}
