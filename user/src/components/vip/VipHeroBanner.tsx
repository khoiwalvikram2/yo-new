import { Crown, Trophy, Gift, Zap, Sparkles } from 'lucide-react'

interface VipHeroBannerProps {
  totalTiers: number
}

/** Dark matchbook showcase at the top of the VIP page: pitch, headline and three highlights. */
export default function VipHeroBanner({ totalTiers }: VipHeroBannerProps) {
  return (
    <section className="nova-vip-hero">
      <div className="nova-vip-hero-copy">
        <p className="nova-vip-eyebrow">
          <Sparkles aria-hidden="true" />
          <span>Premium Membership Benefits</span>
        </p>

        <h2 className="user-vip-hero-title">Unlock Exclusive VIP Rewards</h2>

        <p className="nova-vip-hero-text">
          Earn points with every deposit, climb through exclusive tiers, and enjoy premium benefits designed for our most valued players.
        </p>

        <ul className="nova-vip-highlights">
          {/* No count until the programme has tiers: "0 VIP Tiers" reads as broken. */}
          {totalTiers > 0 && <li>
            <Trophy aria-hidden="true" />
            <strong>{totalTiers}</strong>
            <span>VIP Tiers</span>
          </li>}
          <li>
            <Gift aria-hidden="true" />
            <strong>Premium</strong>
            <span>Benefits</span>
          </li>
          <li>
            <Zap aria-hidden="true" />
            <strong>Instant</strong>
            <span>Upgrades</span>
          </li>
        </ul>
      </div>

      <div className="nova-vip-medal" aria-hidden="true">
        <span className="nova-vip-medal-ring" />
        <Crown />
      </div>
    </section>
  )
}
