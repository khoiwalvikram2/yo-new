import { TrendingUp, Users, Star, Award } from 'lucide-react'
import { formatAmount } from '@/lib/currency'

interface WithdrawalRecommendationProps {
  userHistory?: {
    averageWithdrawal?: number
    lastWithdrawal?: number
    totalWithdrawals?: number
  }
  popularAmounts?: number[]
  availableBalance?: number
}

export function WithdrawalRecommendation({ 
  userHistory, 
  popularAmounts = [500, 1000, 5000], 
  availableBalance 
}: WithdrawalRecommendationProps) {
  const hasHistory = userHistory && userHistory.totalWithdrawals && userHistory.totalWithdrawals > 0

  const recommendations = [
    {
      icon: TrendingUp,
      label: 'Suggested Amount',
      amount: userHistory?.averageWithdrawal || 1000,
      reason: hasHistory ? 'Based on your average' : 'Popular choice',
    },
    {
      icon: Users,
      label: 'Most Popular',
      amount: popularAmounts[1] || 1000,
      reason: 'Chosen by 58% of users',
    },
    {
      icon: Star,
      label: 'Optimal Amount',
      amount: 5000,
      reason: 'Best value withdrawal',
    },
  ].map(rec => ({
    ...rec,
    amount: availableBalance !== undefined 
      ? Math.min(rec.amount, availableBalance)
      : rec.amount
  })).filter(rec => rec.amount >= 200) // Min withdrawal

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Award className="h-4 w-4 text-[color:var(--ds-color-slate-450)]" />
        <h4 className="text-xs font-semibold text-[color:var(--ds-color-slate-100)]">
          Smart Recommendations
        </h4>
      </div>

      {/* Mobile: Horizontal scroll, Desktop: Grid - stake state colors */}
      <div className="flex sm:grid sm:grid-cols-3 gap-2.5 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-1 px-1 sm:mx-0 sm:px-0">
        {recommendations.map((rec, index) => {
          const Icon = rec.icon
          return (
            <button
              key={index}
              onClick={() => {}}
              className="group relative p-3 rounded-lg bg-[color:var(--ds-color-slate-750)] border border-[color:var(--ds-color-slate-600)] hover:border-[#fbbf24]/40 hover:shadow-sm transition-all text-left flex-shrink-0 w-[calc(33.333%-0.67rem)] sm:w-auto snap-start min-w-[140px] sm:min-w-0"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-7 h-7 rounded-md bg-[#fbbf24]/15 border border-[#fbbf24]/30 flex items-center justify-center flex-shrink-0">
                  <Icon className="h-3.5 w-3.5 text-[#fbbf24]" />
                </div>
                {index === 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[color:var(--ds-color-slate-800)] text-[color:var(--ds-color-slate-450)] font-medium uppercase leading-none border border-[color:var(--ds-color-slate-600)]">
                    Best
                  </span>
                )}
              </div>
              
              <div>
                <p className="text-sm font-bold text-[#fbbf24] mb-1">
                  {formatAmount(rec.amount)}
                </p>
                <p className="text-[10px] text-[color:var(--ds-color-slate-450)] leading-tight">
                  {rec.reason}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

