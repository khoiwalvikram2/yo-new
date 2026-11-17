import { useDeleteVIPTier, useSetVIPTierStatus } from '@/modules/vip'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { confirm } from '@/ui/components/confirm'
import { toast } from '@/ui/components/toast'
import { payloadOutcome, tierDeleteCopy, tierStatusChange, type TierActionTarget } from './vipTierActionsModel'

interface VipTierActionsOptions {
  /** After a tier's status changed, e.g. to re-run the ladder validation. */
  onChanged?: () => void
  /** After a tier was deleted, e.g. to leave its detail page. */
  onDeleted?: (tier: TierActionTarget) => void
}

/**
 * Activate / Deactivate and Delete for a VIP tier (MAR-11), behind a confirmation that stays open
 * with the server's reason when it refuses (the last active tier, a tier players have been on).
 * The mutations skip the global payload toast so each outcome is said once, here. Each action is
 * offered only to a role the server would let through: vip.tiers:update and vip.tiers:delete.
 */
export function useVipTierActions({ onChanged, onDeleted }: VipTierActionsOptions = {}) {
  const permissions = useAuthStore(state => state.permissions)
  const canChangeStatus = hasPermissionWithNested(permissions, 'vip.tiers', 'update')
  const canDelete = hasPermissionWithNested(permissions, 'vip.tiers', 'delete')
  const [setStatus] = useSetVIPTierStatus()
  const [deleteTier] = useDeleteVIPTier()

  const requestStatusChange = (tier: TierActionTarget) => {
    const change = tierStatusChange(tier)
    void confirm({
      title: change.title,
      description: change.description,
      confirmLabel: change.label,
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        const { data } = await setStatus({ variables: { id: tier.id, status: change.status }, context: { skipNotification: true } })
        payloadOutcome(data?.setVIPTierStatus, `Unable to ${change.label.toLowerCase()} ${tier.name}`)
        toast({ message: change.done, tone: 'ok' })
        onChanged?.()
      },
    })
  }

  const requestDelete = (tier: TierActionTarget) => {
    const copy = tierDeleteCopy(tier)
    void confirm({
      title: copy.title,
      description: copy.description,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        const { data } = await deleteTier({ variables: { id: tier.id }, context: { skipNotification: true } })
        payloadOutcome(data?.deleteVIPTier, `Unable to delete ${tier.name}`)
        toast({ message: copy.done, tone: 'ok' })
        onDeleted?.(tier)
        onChanged?.()
      },
    })
  }

  return { canChangeStatus, canDelete, requestStatusChange, requestDelete }
}
