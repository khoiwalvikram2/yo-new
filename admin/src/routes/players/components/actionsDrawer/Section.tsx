import { useId, type ReactNode } from 'react'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import styles from '../../PlayersSearch.module.css'
type SectionProps = { id: string; title: string; subtitle: string; icon: ReactNode; openSection: string; setOpenSection: (id: string) => void; children: ReactNode }
export function Section({ id, title, subtitle, icon, openSection, setOpenSection, children }: SectionProps) {
  const isOpen = openSection === id; const key = useId()
  return <section className={styles.section}><button type="button" className={styles.sectionButton} aria-label={title} aria-expanded={isOpen} aria-controls={isOpen ? key : undefined} onClick={() => setOpenSection(isOpen ? '' : id)}><span className={styles.person}><span aria-hidden="true">{icon}</span><span className={styles.sectionCopy}><span className={styles.name}>{title}</span><span className={styles.secondary}>{subtitle}</span></span></span>{isOpen ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}</button>{isOpen && <div id={key} className={styles.sectionBody}>{children}</div>}</section>
}
