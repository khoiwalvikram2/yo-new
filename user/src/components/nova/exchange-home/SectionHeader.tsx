import type { ReactNode } from 'react'

type SectionHeaderProps = {
  icon?: ReactNode
  title: ReactNode
  titleId?: string
  count?: ReactNode
  badge?: ReactNode
  children?: ReactNode
  variant?: 'default' | 'featured'
  className?: string
}

/** Simple card header shared by user-panel sections. */
export default function SectionHeader({ icon, title, titleId, count, badge, children, variant = 'default', className = '' }: SectionHeaderProps) {
  return <header className={`${variant === 'featured' ? 'nova-ex-games-head' : 'nova-ex-section-head'} nova-ex-nameplate${className ? ` ${className}` : ''}`}>
    <div className="nova-ex-head-label">
      {icon && <span className="nova-ex-head-icon" aria-hidden="true">{icon}</span>}
      <h2 id={titleId}>{title}</h2>
      {count !== undefined && count !== null && <span className="nova-ex-section-count">{count}</span>}
      {badge}
    </div>
    {children && <div className="nova-ex-head-tools">{children}</div>}
  </header>
}
