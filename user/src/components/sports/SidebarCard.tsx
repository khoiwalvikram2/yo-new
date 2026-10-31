import React from 'react'

interface SidebarCardProps {
  title: string | React.ReactNode
  children: React.ReactNode
  className?: string
  count?: number
  /** Use Stake-style slate colors (e.g. for sports page right sidebar) */
  variant?: 'default' | 'slate'
}

export default function SidebarCard({ title, children, className = '', count, variant = 'default' }: SidebarCardProps) {
  const isSlate = variant === 'slate'
  const cardCls = isSlate
    ? 'pb-4'
    : 'p-3 rounded-xl bg-[color:var(--surface)] border border-[color:var(--border)]/30'
  const headerCls = isSlate
    ? 'text-sm font-bold text-[color:var(--ds-color-slate-100)] mb-2.5 tracking-wide border-b border-[color:var(--ds-color-slate-600)] pb-2 flex items-center justify-between'
    : 'text-sm font-bold text-[color:var(--foreground)] mb-2.5 tracking-wide border-b border-[color:var(--brand-primary)]/30 pb-2 bg-gradient-to-r from-[color:var(--surface-2)]/40 to-[color:var(--surface)]/20 px-3 py-3 rounded-t-lg -mx-3 -mt-3 shadow-sm relative'
  const countCls = 'text-xs font-semibold text-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10 px-2 py-0.5 rounded-[5px]'
  const gradientCls = 'absolute inset-0 bg-gradient-to-r from-[color:var(--brand-primary)]/5 to-transparent rounded-t-lg'

  return (
    <div className={`${cardCls} ${className}`}>
      <h3 className={headerCls}>
        {isSlate ? (
          <>
            <span>{title}</span>
            {typeof count === 'number' && <span className={countCls}>{count}</span>}
          </>
        ) : (
          <>
            <span className="relative z-10 flex items-center justify-between">
              <span>{title}</span>
              {typeof count === 'number' && <span className={countCls}>{count}</span>}
            </span>
            <div className={gradientCls} />
          </>
        )}
      </h3>
      {children}
    </div>
  )
}
