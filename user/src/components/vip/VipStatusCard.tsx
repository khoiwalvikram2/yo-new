import { Crown, Trophy, Calendar, Check, Target } from 'lucide-react'
import { getDefaultLocale } from '@/lib/currency'

type VIPTier = {
  id: string
  name: string
  level: number
  minMonthlyDeposit: number
  color: string
  benefits: string[]
  perks: Array<{ name: string; description: string; icon?: string | null }>
}

type VIPMember = {
  id: string
  tierId: string
  tierName: string
  tierLevel: number
  tierColor: string
  currentPoints: number
  lifetimePoints: number
  monthlyDeposits: number
  nextTier: VIPTier | null
  pointsToNextTier: number | null
  joinedAt: string
  benefits: string[]
  perks: Array<{ name: string; description: string; icon?: string | null }>
}

interface VipStatusCardProps {
  vipStatus: VIPMember
  progressPercentage: number
}

/** The player's tier, points and progress to the next tier; the tier colour is the only accent. */
export default function VipStatusCard({ vipStatus, progressPercentage }: VipStatusCardProps) {
  const tierStyle = { '--vip-tier-color': vipStatus.tierColor } as React.CSSProperties
  return (
    <section className="nova-acct-panel nova-vip-panel" style={tierStyle}>
      <header className="nova-acct-panel-head">
        <Crown aria-hidden="true" />
        <h2>Your VIP Status</h2>
        <span className="nova-vip-panel-note">Track your progress and unlock rewards</span>
      </header>

      <div className="nova-vip-status">
        <div className="nova-vip-status-tier">
          <span className="nova-vip-crest"><Crown aria-hidden="true" /></span>
          <div>
            <h3>{vipStatus.tierName}</h3>
            <p>
              <span><Trophy aria-hidden="true" />Level {vipStatus.tierLevel}</span>
              <span><Calendar aria-hidden="true" />Since {new Date(vipStatus.joinedAt).toLocaleDateString(getDefaultLocale(), { month: 'short', year: 'numeric' })}</span>
            </p>
          </div>
          <span className="nova-vip-active"><Check aria-hidden="true" />Active Tier</span>
        </div>

        <dl className="nova-vip-stats">
          <div><dt>Current Points</dt><dd>{vipStatus.currentPoints.toLocaleString()}</dd></div>
          <div><dt>Lifetime Points</dt><dd>{vipStatus.lifetimePoints.toLocaleString()}</dd></div>
          <div><dt>Qualifying deposits this month</dt><dd>{vipStatus.monthlyDeposits.toLocaleString()}</dd></div>
        </dl>

        {vipStatus.nextTier && (
          <div className="nova-vip-next">
            <div className="nova-vip-next-head">
              <span><Target aria-hidden="true" />Next Tier: <strong>{vipStatus.nextTier.name}</strong></span>
              <strong className="nova-vip-next-pct">{progressPercentage.toFixed(0)}%</strong>
            </div>
            <div className="nova-vip-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercentage)} aria-label={`Progress to ${vipStatus.nextTier.name}`}>
              <span style={{ width: `${progressPercentage}%` }} />
            </div>
            {vipStatus.pointsToNextTier !== null && vipStatus.pointsToNextTier > 0 && (
              <p className="nova-vip-next-note">
                <strong>{vipStatus.pointsToNextTier.toLocaleString()}</strong> more in approved deposits to unlock {vipStatus.nextTier.name}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
