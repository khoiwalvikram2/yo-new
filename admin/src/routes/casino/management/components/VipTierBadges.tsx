import { useMemo } from 'react'
import { useQuery } from '@apollo/client'
import { IconCheck, IconCrown } from '@tabler/icons-react'
import { GAME_VIP_TIERS } from '@/lib/graphql/casino'
import { Spinner } from '@/ui/components/Spinner'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import type { GameVipTier, VipTier } from '../casinoManagementModel'
import styles from '../ManagementPage.module.css'

interface VipTierBadgesProps {
  gameId: string
  vipTiers: VipTier[]
  onManage: () => void
}

interface GameVipTiersData { gameVipTiers: GameVipTier[] }

export function VipTierBadges({ gameId, vipTiers, onManage }: VipTierBadgesProps) {
  const { data, loading } = useQuery<GameVipTiersData>(GAME_VIP_TIERS, {
    variables: { gameId },
    skip: !gameId,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })
  const enabledTiers = useMemo(
    () => (data?.gameVipTiers ?? []).filter((setting) => setting.enabled),
    [data?.gameVipTiers],
  )

  if (loading) return <Spinner size="sm" label="Loading VIP tiers" />

  return (
    <button type="button" onClick={onManage} className={styles.tierBadges} title="Click to manage VIP tiers">
      {enabledTiers.length === 0 ? (
        <StatusPill status="enabled" icon={<IconCheck size={12} stroke={strokeFor(12)} />}>Default</StatusPill>
      ) : (
        <>
          {enabledTiers.slice(0, 2).map((setting) => {
            const tier = vipTiers.find((candidate) => candidate.id === setting.tierId)
            return tier ? (
              <StatusPill key={setting.tierId} tone="info" icon={<IconCrown size={12} stroke={strokeFor(12)} />}>
                {tier.name}
              </StatusPill>
            ) : null
          })}
          {enabledTiers.length > 2 ? <StatusPill tone="neutral">+{enabledTiers.length - 2}</StatusPill> : null}
        </>
      )}
    </button>
  )
}
