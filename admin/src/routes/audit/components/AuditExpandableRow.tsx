import { IconCopy } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import type { AuditEvent } from '@/modules/audit/types'
import { getChangeSummary } from '@/modules/audit/services/auditService'
import styles from '../AuditEvents.module.css'
export function AuditExpandableRow({ record, onCopy }: { record: AuditEvent; onCopy: (text: string, successMessage: string) => void }) {
  return <div className={styles.changed}><div className={styles.stack}><p className={styles.secondary}>{getChangeSummary(record.before, record.after)}</p>
    <div className={styles.details}>{(['before', 'after'] as const).map((key) => record[key] ? <section key={key} className={styles.stack}>
      <h3 className={styles.strong}>{key === 'before' ? 'Before' : 'After'}</h3>
      <pre className={styles.json} tabIndex={0} aria-label={`${key} state`}>{JSON.stringify(record[key], null, 2)}</pre>
      <Button size="xs" icon={<IconCopy size={14} />} aria-label={`Copy ${key} state`} onClick={() => onCopy(JSON.stringify(record[key], null, 2), key === 'before' ? 'Before data copied!' : 'After data copied!')}>Copy</Button>
    </section> : null)}</div>
  </div></div>
}
