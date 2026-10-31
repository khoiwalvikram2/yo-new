import { RBACGuard } from '@/shared/core/RBACGuard'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import type { PlayerProfile } from '../profileModel'
import styles from '../PlayerProfile.module.css'
export function ResponsibleGamingTab({ profile }: { playerId: string; profile: PlayerProfile }) {
  if (!profile) return <EmptyState title="No profile data" />
  const limits = profile.limits || {}
  const shown = (value?: number | null) => value ? value.toLocaleString() : 'Not Set'
  return <div className={styles.stack}>
    <Card title="Betting Limits" sub="Player betting restrictions and controls" tools={<RBACGuard required={[{ domain: 'players.responsible-gaming', actions: ['update'] }]}><Button disabled title="Limit changes are not connected to a server action">Update Limits</Button></RBACGuard>}>
      <DescriptionList items={[
        { term: 'Daily Stake Limit', value: shown(limits.dailyStakeLimit) }, { term: 'Weekly Stake Limit', value: shown(limits.weeklyStakeLimit) },
        { term: 'Max Bet - Sports', value: shown(limits.maxBetSports) }, { term: 'Max Bet - Casino', value: shown(limits.maxBetCasino) }, { term: 'Max Bet - Matka', value: shown(limits.maxBetMatka) },
        { term: 'Exposure Cap Override', value: shown(limits.exposureCapOverride) }, { term: 'Cooldown Period', value: limits.cooldownSeconds ? `${limits.cooldownSeconds} seconds` : 'Not Set' },
      ]} />
      <Notice title="Limits are read-only" tone="info">The existing limits editor is not connected to a server mutation. This screen displays the configured values without claiming to save changes.</Notice>
    </Card>
    <Card title="Self-Exclusion" sub="Player self-exclusion and responsible gaming controls">
      <Notice title="Self-exclusion data is not available" tone="info">The current profile query does not provide cooling-off, self-exclusion or reality-check settings. Their status cannot be confirmed from this screen.</Notice>
      <RBACGuard required={[{ domain: 'players.responsible-gaming', actions: ['update'] }]}><div className={styles.actions}><Button disabled>Set Cooling-Off Period</Button><Button disabled variant="danger">Initiate Self-Exclusion</Button></div></RBACGuard>
    </Card>
  </div>
}

