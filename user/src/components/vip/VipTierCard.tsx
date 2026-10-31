import { Crown, Trophy, Lock, Check, Target, Gift, Sparkles } from 'lucide-react'
import { formatAmount } from '@/lib/currency'

type VIPTier = {
  id: string
  name: string
  level: number
  minMonthlyDeposit: number
  color: string
  benefits: string[]
  perks: Array<{ name: string; description: string; icon?: string | null }>
}

interface VipTierCardProps {
  tier: VIPTier
  isCurrentTier: boolean
  isUnlocked: boolean
  /** This month's approved deposits, given for the player's current tier only. */
  monthlyDeposits?: number
}

/** One tier: a stripe and crest in the tier colour, the monthly deposit requirement, benefits and perks. */
export default function VipTierCard({ tier, isCurrentTier, isUnlocked, monthlyDeposits }: VipTierCardProps) {
  const progressPerc = tier.minMonthlyDeposit <= 0 ? 100
    : monthlyDeposits ? Math.min(100, (monthlyDeposits / tier.minMonthlyDeposit) * 100) : 0
  const state = isCurrentTier ? ' is-current' : isUnlocked ? ' is-unlocked' : ' is-locked'

  return (
    <article className={`nova-vip-tier${state}`} style={{ '--vip-tier-color': tier.color } as React.CSSProperties}>
      <header className="nova-vip-tier-head">
        <span className="nova-vip-crest"><Crown aria-hidden="true" /></span>
        <div className="nova-vip-tier-name">
          <h3>{tier.name}</h3>
          <p>
            <Trophy aria-hidden="true" />
            <span>Level {tier.level}</span>
            {isUnlocked && !isCurrentTier && <Check className="nova-vip-unlocked" role="img" aria-label="Unlocked" />}
          </p>
        </div>
        {isCurrentTier ? (
          <span className="nova-vip-active">Active</span>
        ) : !isUnlocked ? (
          <Lock className="nova-vip-lock" role="img" aria-label="Locked" />
        ) : null}
      </header>

      <div className="nova-vip-requirement">
        <span><Target aria-hidden="true" />Monthly deposits</span>
        <strong>{formatAmount(tier.minMonthlyDeposit)}</strong>
      </div>

      {isCurrentTier && monthlyDeposits !== undefined && (
        <div className="nova-vip-tier-progress">
          <div className="nova-vip-next-head">
            <span>Progress</span>
            <strong className="nova-vip-next-pct">{progressPerc.toFixed(0)}%</strong>
          </div>
          <div className="nova-vip-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPerc)} aria-label={`Progress in ${tier.name}`}>
            <span style={{ width: `${progressPerc}%` }} />
          </div>
          <div className="nova-vip-tier-range">
            <span>{formatAmount(monthlyDeposits)}</span>
            <span>{formatAmount(tier.minMonthlyDeposit)}</span>
          </div>
        </div>
      )}

      {(tier.benefits.length > 0 || tier.perks.length > 0) && (
        <div className="nova-vip-tier-body">
          {tier.benefits.length > 0 && (
            <section>
              <h4><Gift aria-hidden="true" />Benefits</h4>
              <ul className="nova-vip-benefits">
                {tier.benefits.slice(0, 4).map((benefit, idx) => (
                  <li key={idx}><Check aria-hidden="true" /><span>{benefit}</span></li>
                ))}
              </ul>
              {tier.benefits.length > 4 && <p className="nova-vip-more">+{tier.benefits.length - 4} more</p>}
            </section>
          )}

          {tier.perks.length > 0 && (
            <section>
              <h4><Sparkles aria-hidden="true" />Perks</h4>
              <ul className="nova-vip-perks">
                {tier.perks.slice(0, 4).map((perk, idx) => (
                  <li key={idx} title={perk.description || undefined}>
                    {perk.icon && <span aria-hidden="true">{perk.icon}</span>}
                    <span>{perk.name}</span>
                  </li>
                ))}
              </ul>
              {tier.perks.length > 4 && <p className="nova-vip-more">+{tier.perks.length - 4} more perks</p>}
            </section>
          )}
        </div>
      )}
    </article>
  )
}
