import type { ReactNode } from 'react'
import { IconInfoCircle } from '@tabler/icons-react'
import { StatusPill, type StatusPillTone } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import styles from '../SupportAdminsPage.module.css'

const HINT_ICON = 14

/** The legacy header card at the top of each drawer: a glyph tile, a title, a line under it and a tag. */
export function DrawerIntro({
  icon,
  title,
  sub,
  tag,
  tagTone,
}: {
  icon: ReactNode
  title: ReactNode
  sub: string
  tag: string
  tagTone: StatusPillTone
}) {
  return (
    <div className={styles.intro}>
      <span className={styles.introIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.introCopy}>
        <span className={styles.introTitle}>{title}</span>
        <span className={styles.introSub}>{sub}</span>
      </span>
      <StatusPill className={styles.introTag} tone={tagTone}>
        {tag}
      </StatusPill>
    </div>
  )
}

/** The legacy drawer footer: the info hint, then the drawer's buttons. */
export function DrawerFooter({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <div className={styles.footer}>
      <p className={styles.footerHint}>
        <IconInfoCircle size={HINT_ICON} stroke={strokeFor(HINT_ICON)} aria-hidden="true" />
        {hint}
      </p>
      <div className={styles.footerActions}>{children}</div>
    </div>
  )
}

/** A titled block inside a drawer: an h3 under the drawer's h2. */
export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  )
}
