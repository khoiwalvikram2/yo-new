import { useState, useMemo } from 'react'
import { CreditCard, QrCode, Building, ArrowRight, AlertCircle } from 'lucide-react'
import { PaymentMethodCard, type PaymentMethod } from './PaymentMethodCard'
import { PaymentMethodSkeleton } from './SkeletonLoader'

interface PaymentMethodSelectorProps {
  methods: PaymentMethod[]
  loading?: boolean
  error?: string | null
  selectedMethodId?: string
  onSelect: (method: PaymentMethod) => void
  onProceed: () => void
  amount: number
  disabled?: boolean
  prominentAccountLimits?: boolean
}

export function PaymentMethodSelector({
  methods,
  loading,
  error,
  selectedMethodId,
  onSelect,
  onProceed,
  amount,
  disabled = false,
  prominentAccountLimits = false,
}: PaymentMethodSelectorProps) {
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'upi' | 'bank' | 'gateway'>('all')

  // Group methods by type
  const groupedMethods = useMemo(() => {
    const groups: Record<string, PaymentMethod[]> = {
      gateway: [],
      upi: [],
      bank: [],
    }

    methods.forEach((method) => {
      const withinLimits =
        (method.minAmount == null || amount >= method.minAmount) &&
        (method.maxAmount == null || amount <= method.maxAmount)

      if (withinLimits) {
        groups[method.type]?.push(method)
      }
    })

    return groups
  }, [methods, amount])

  const filteredMethods = useMemo(() => {
    if (categoryFilter === 'all') {
      return [...groupedMethods.gateway, ...groupedMethods.upi, ...groupedMethods.bank]
    }
    return groupedMethods[categoryFilter] || []
  }, [groupedMethods, categoryFilter])

  const selectedMethod = useMemo(() => {
    return methods.find((m) => m.id === selectedMethodId)
  }, [methods, selectedMethodId])

  const canProceed = selectedMethod && amount > 0 && (selectedMethod.minAmount == null || amount >= selectedMethod.minAmount) && (selectedMethod.maxAmount == null || amount <= selectedMethod.maxAmount)

  const categories = [
    { key: 'all' as const, label: 'All Methods', icon: CreditCard },
    { key: 'gateway' as const, label: 'Payment Gateway', icon: CreditCard },
    { key: 'upi' as const, label: 'UPI', icon: QrCode },
    { key: 'bank' as const, label: 'Bank Transfer', icon: Building },
  ]

  if (loading) {
    return (
      <div className="dep-method-step">
        <div className="dep-filters">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="dep-skel-chip animate-pulse" />
          ))}
        </div>
        <div className="dep-methods">
          {[1, 2, 3, 4].map((i) => (
            <PaymentMethodSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dep-alert">
        <AlertCircle />
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div className="dep-method-step">
      <div className="dep-filters">
        {categories.map((cat) => {
          const Icon = cat.icon
          const count = cat.key === 'all' ? methods.length : groupedMethods[cat.key]?.length || 0
          const isActive = categoryFilter === cat.key
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => setCategoryFilter(cat.key)}
              disabled={count === 0}
              className={`dep-filter${isActive ? ' is-active' : ''}`}
            >
              <Icon />
              <span>{cat.label}</span>
              <span className="dep-filter-count">({count})</span>
            </button>
          )
        })}
      </div>

      {filteredMethods.length === 0 ? (
        <div className="dep-method-empty">
          <AlertCircle />
          <p>No methods for this amount</p>
        </div>
      ) : (
        <div className="dep-methods">
          {filteredMethods.map((method) => (
            <PaymentMethodCard
              key={method.id}
              method={method}
              isSelected={selectedMethodId === method.id}
              onClick={() => onSelect(method)}
              disabled={disabled}
              showDetails
              prominentAccountLimits={prominentAccountLimits}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onProceed}
        disabled={!canProceed || disabled}
        className="dep-btn dep-btn-primary"
      >
        Proceed <ArrowRight />
      </button>
    </div>
  )
}

