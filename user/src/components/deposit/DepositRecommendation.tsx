import { TrendingUp, Users, Star, Award } from 'lucide-react'
import { formatAmount } from '@/lib/currency'

interface RecommendationProps {
  userHistory?: {
    averageDeposit?: number
    lastDeposit?: number
    totalDeposits?: number
  }
  popularAmounts?: number[]
  onSelectAmount?: (amount: number) => void
}

export function DepositRecommendation({ userHistory, popularAmounts = [5000, 10000, 25000], onSelectAmount }: RecommendationProps) {
  const hasHistory = userHistory && userHistory.totalDeposits && userHistory.totalDeposits > 0

  const recommendations = [
    {
      icon: TrendingUp,
      label: 'Suggested Amount',
      amount: userHistory?.averageDeposit || 10000,
      reason: hasHistory ? 'Based on your average' : 'Popular choice',
      color: 'emerald',
    },
    {
      icon: Users,
      label: 'Most Popular',
      amount: popularAmounts[1] || 10000,
      reason: 'Chosen by 67% of users',
      color: 'blue',
    },
    {
      icon: Star,
      label: 'Optimal Amount',
      amount: 25000,
      reason: 'Best value for playing',
      color: 'purple',
    },
  ]

  const colorClasses = {
    emerald: 'bg-[color:var(--ds-color-slate-750)] border-[color:var(--ds-color-slate-600)]',
    blue: 'bg-[color:var(--ds-color-slate-750)] border-[color:var(--ds-color-slate-600)]',
    purple: 'bg-[color:var(--ds-color-slate-750)] border-[color:var(--ds-color-slate-600)]',
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Award className="h-3.5 w-3.5 text-[color:var(--ds-color-slate-450)]" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--ds-color-slate-400)]">Quick select</span>
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-0.5 px-0.5">
        {recommendations.map((rec, index) => {
          const Icon = rec.icon
          const cls = colorClasses[rec.color as keyof typeof colorClasses] || colorClasses.blue
          return (
            <button
              key={index}
              type="button"
              onClick={() => onSelectAmount?.(rec.amount)}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${cls} hover:bg-[color:var(--ds-color-slate-700)] transition-colors text-left shrink-0 snap-start min-w-0`}
            >
              <div className="w-6 h-6 rounded bg-[color:var(--ds-color-slate-650)] flex items-center justify-center shrink-0">
                <Icon className="h-3 w-3 text-[color:var(--ds-color-slate-300)]" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[color:var(--ds-color-slate-100)] leading-tight">{formatAmount(rec.amount)}</p>
                <p className="text-[10px] text-[color:var(--ds-color-slate-450)] leading-tight truncate max-w-[100px]">{rec.reason}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

