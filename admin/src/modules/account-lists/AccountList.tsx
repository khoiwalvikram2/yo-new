import { useId, type ReactNode } from 'react';
import clsx from 'clsx';
import { RadioGroup, type RadioOption } from '@/ui/components/RadioGroup';
import { Stat, type StatProps } from '@/ui/components/Stat';
import styles from './AccountList.module.css';

export function AccountListHeader({ title, actions }: { title: string; eyebrow?: string | null; description?: string; actions: ReactNode }) {
  return <header className={styles.header} data-page-header="title-only">
    <div className={styles.heading}>
      <h1>{title}</h1>
    </div>
    <div className={styles.headerActions}>{actions}</div>
  </header>;
}

export function AccountListGroups({ label, options, value, onChange }: {
  label: string; options: readonly RadioOption<string>[]; value: string; onChange: (value: string) => void;
}) {
  return <div className={styles.groups}>
    <RadioGroup label={label} hideLabel variant="segmented" options={[...options]} value={value} onChange={onChange} />
  </div>;
}

export function AccountListPanel({ title, sub, tools, children, body = 'table' }: {
  title: string; sub?: ReactNode; tools?: ReactNode; children: ReactNode; body?: 'table' | 'padded';
}) {
  const titleId = useId();
  return <section className={clsx(styles.panel, body === 'table' && styles.tablePanel)} aria-labelledby={titleId}>
    <div className={styles.panelHeader} data-ui-radius="panel-head">
      <div className={styles.panelCopy}><h2 id={titleId}>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
      {tools ? <div className={styles.panelTools}>{tools}</div> : null}
    </div>
    <div className={body === 'padded' ? styles.paddedBody : styles.tableBody}>{children}</div>
  </section>;
}

export function AccountListMetric(props: StatProps) {
  return <div className={styles.metric}><Stat {...props} variant="bare" size="compact" /></div>;
}
