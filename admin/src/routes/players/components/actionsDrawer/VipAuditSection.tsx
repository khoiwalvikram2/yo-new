import { useMutation, gql } from '@apollo/client'
import { notify } from '@/shared/services/notification'
import { useVIPTiers } from '@/modules/vip/hooks/useVIP'
import type { Player } from '@/shared/types/player'
import { Combobox } from '@/ui/components/Combobox'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from '../../PlayersSearch.module.css'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { Notice } from '@/ui/components/Notice'
const SetUserVipTier = gql`
  mutation SetUserVipTier($id: ID!, $vipTierId: ID) {
    setUserVipTier(id: $id, vipTierId: $vipTierId) {
      id
      vipTierId
      vipTierName
    }
  }
`

interface VipAuditSectionProps {
  user: Player
  saving: Record<string, boolean>
  setSavingFlag: (key: string, val: boolean) => void
  onRefetch: () => void
}


export function VipAuditSection({ user, saving, setSavingFlag, onRefetch }: VipAuditSectionProps) {
  const [mutSetVipTier] = useMutation(SetUserVipTier)
  const permissions = useAuthStore(state => state.permissions)
  const canUpdate = hasPermissionWithNested(permissions, 'players.vip', 'update')
  const { data, loading, error } = useVIPTiers()
  async function change(value: string | null) {
    try {
      setSavingFlag('vip-' + user.id, true)
      await mutSetVipTier({ variables: { id: user.id, vipTierId: value === 'AUTO' ? null : value } })
      notify.success(value === 'AUTO' ? 'Automatic monthly tier enabled' : 'VIP tier updated')
      onRefetch()
    } catch (cause) { notify.error(cause instanceof Error ? cause.message : 'Failed to update VIP tier') }
    finally { setSavingFlag('vip-' + user.id, false) }
  }
  return <div className={styles.stack}>
    {error ? <Notice tone="error">Unable to load VIP tiers. Try again before saving.</Notice> : null}
    <Combobox label="VIP Tier" value={user.vipTierMode === 'AUTO' || !user.vipTierId ? 'AUTO' : user.vipTierId}
      options={[{ label: 'Automatic — monthly approved deposits', value: 'AUTO' }, ...(data?.vipTiers || []).filter(t => t.status === 'active').map(t => ({ label: t.name + ' (L' + t.level + ')', value: t.id }))]}
      onChange={value => void change(value)} placeholder="Select VIP tier" disabled={!canUpdate || loading || !!error || !!saving['vip-' + user.id]} loading={!!saving['vip-' + user.id]} />
    {user.vipTierName ? <StatusPill tone="info">Current: {user.vipTierName}</StatusPill> : null}
    <p className={styles.secondary}>Manual assignments stay fixed. Automatic uses approved deposits from the current month after program activation. Changes apply to new deposit requests.</p>
    {user.vipDepositAccess?.message ? <Notice tone="info">{user.vipDepositAccess.message}</Notice> : null}
  </div>
}
