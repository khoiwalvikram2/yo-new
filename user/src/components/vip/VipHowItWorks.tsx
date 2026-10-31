import { Award, Target, Sparkles, TrendingUp, Gift } from 'lucide-react'

const STEPS = [
  { number: 1, icon: Target, title: 'Deposit', description: 'Fund your account' },
  { number: 2, icon: Sparkles, title: 'Earn Points', description: '1:1 ratio earned' },
  { number: 3, icon: TrendingUp, title: 'Tier Up', description: "Set by this month's deposits" },
  { number: 4, icon: Gift, title: 'Enjoy', description: 'Get exclusive perks' },
]

/** Four steps on one line (two by two on phones), joined by a hairline, numbered in red. */
export default function VipHowItWorks() {
  return (
    <section className="nova-acct-panel nova-vip-panel">
      <header className="nova-acct-panel-head">
        <Award aria-hidden="true" />
        <h2>How It Works</h2>
        <span className="nova-vip-panel-note">Your journey to VIP rewards in 4 simple steps</span>
      </header>

      <ol className="nova-vip-steps">
        {STEPS.map(step => {
          const Icon = step.icon
          return (
            <li key={step.number}>
              <span className="nova-vip-step-icon"><Icon aria-hidden="true" /></span>
              <span className="nova-vip-step-copy">
                <strong><em>{step.number}</em>{step.title}</strong>
                <small>{step.description}</small>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
