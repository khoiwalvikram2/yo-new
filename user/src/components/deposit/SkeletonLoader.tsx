export function PaymentMethodSkeleton() {
  return (
    <div className="dep-skel-card animate-pulse">
      <div className="dep-skel-row">
        <div className="dep-skel-tile" />
        <div className="dep-skel-lines">
          <div className="dep-skel-line is-long" />
          <div className="dep-skel-line is-short" />
        </div>
      </div>
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <div className="p-3 rounded-lg bg-gradient-to-br from-[color:var(--ds-color-slate-800)] to-[color:var(--ds-color-slate-750)] border border-[color:var(--ds-color-slate-600)] animate-pulse">
      <div className="h-3 bg-[color:var(--ds-color-slate-750)] rounded w-20 mb-2" />
      <div className="h-6 bg-[color:var(--ds-color-slate-750)] rounded w-12" />
    </div>
  )
}

export function TransactionRowSkeleton({ theme }: { theme?: 'default' | 'slate' } = {}) {
  const slab = theme === 'slate' ? 'bg-[color:var(--ds-color-slate-750)]' : 'bg-[color:var(--surface-2)]'
  return (
    <tr className="animate-pulse">
      <td className="py-3 sm:py-4 px-2 sm:px-4">
        <div className={`h-3 rounded w-20 ${slab}`} />
      </td>
      <td className="py-3 sm:py-4 px-2 sm:px-4">
        <div className={`h-6 rounded-[5px] w-16 ${slab}`} />
      </td>
      <td className="py-3 sm:py-4 px-2 sm:px-4">
        <div className={`h-4 rounded w-24 ml-auto ${slab}`} />
      </td>
      <td className="py-3 sm:py-4 px-2 sm:px-4">
        <div className={`h-6 rounded-[5px] w-16 mx-auto ${slab}`} />
      </td>
      <td className="hidden sm:table-cell py-3 sm:py-4 px-2 sm:px-4">
        <div className={`h-3 rounded w-32 ${slab}`} />
      </td>
    </tr>
  )
}

