import type { ReactNode } from 'react'

/** A white matchbook panel; the caller supplies the charcoal head and the body. */
export default function SectionCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={`wd-section ${className || ''}`}>
      {children}
    </section>
  )
}

