import { IconArrowUp, IconArrowDown } from '@tabler/icons-react'
import { Drawer } from '@/ui/components/Drawer'
import { Checkbox } from '@/ui/components/Checkbox'
import { Select } from '@/ui/components/Select'
import { Button } from '@/ui/components/Button'
import { TABLE_COLUMNS } from '@/modules/audit/constants'
import styles from './AuditSurfaces.module.css'

const DEFAULT_COLUMN_ORDER = ['expand', 'id', 'timestamp', 'actor', 'domain', 'action', 'resource', 'details']
const COLUMN_LABELS: Record<string, string> = Object.fromEntries(TABLE_COLUMNS.map((column) => [column.key, column.label || column.key]))
interface ColumnSettingsProps {
  open: boolean
  onClose: () => void
  visibleColumns: string[]
  columnOrder: string[]
  tableDensity: 'small' | 'middle' | 'large'
  onVisibleColumnsChange: (columns: string[]) => void
  onColumnOrderChange: (order: string[]) => void
  onTableDensityChange: (density: 'small' | 'middle' | 'large') => void
}
export function ColumnSettings({ open, onClose, visibleColumns, columnOrder, tableDensity, onVisibleColumnsChange, onColumnOrderChange, onTableDensityChange }: ColumnSettingsProps) {
  function toggle(key: string, checked: boolean) {
    if (checked) {
      onVisibleColumnsChange([...visibleColumns, key])
      if (!columnOrder.includes(key)) onColumnOrderChange([...columnOrder, key])
    } else {
      onVisibleColumnsChange(visibleColumns.filter((column) => column !== key))
      onColumnOrderChange(columnOrder.filter((column) => column !== key))
    }
  }
  function move(key: string, direction: number) {
    const index = columnOrder.indexOf(key)
    const target = index + direction
    if (index < 0 || target < 0 || target >= columnOrder.length) return
    const next = [...columnOrder]
    ;[next[index], next[target]] = [next[target], next[index]]
    onColumnOrderChange(next)
  }
  const ordered = columnOrder.filter((key) => visibleColumns.includes(key))
  return <Drawer open={open} onOpenChange={(next) => { if (!next) onClose() }} title="Column Settings" size="sm">
    <div className={styles.stack}>
      <section className={styles.stack} aria-labelledby="audit-visible-columns"><h3 id="audit-visible-columns" className={styles.sectionTitle}>Visible Columns</h3>
        {TABLE_COLUMNS.map((column) => <Checkbox key={column.key} label={column.label || column.key} checked={visibleColumns.includes(column.key)} onChange={(checked) => toggle(column.key, checked)} />)}
      </section>
      <section aria-labelledby="audit-column-order"><h3 id="audit-column-order" className={styles.sectionTitle}>Column Order</h3>
        <ol className={styles.order}>{ordered.map((key, index) => <li key={key}><span>{COLUMN_LABELS[key] ?? key}</span><div className={styles.actions}>
          <Button size="xs" disabled={index === 0} aria-label={`Move ${COLUMN_LABELS[key] ?? key} up`} icon={<IconArrowUp size={16} />} onClick={() => move(key, -1)} />
          <Button size="xs" disabled={index === ordered.length - 1} aria-label={`Move ${COLUMN_LABELS[key] ?? key} down`} icon={<IconArrowDown size={16} />} onClick={() => move(key, 1)} />
        </div></li>)}</ol>
      </section>
      <Select label="Table Density" layout="stacked" value={tableDensity} options={[{ value: 'small', label: 'Compact' }, { value: 'middle', label: 'Middle' }, { value: 'large', label: 'Large' }]} onChange={(value) => onTableDensityChange(value as ColumnSettingsProps['tableDensity'])} />
      <Button block onClick={() => { onVisibleColumnsChange([...DEFAULT_COLUMN_ORDER]); onColumnOrderChange([...DEFAULT_COLUMN_ORDER]); onTableDensityChange('middle') }}>Reset to Defaults</Button>
    </div>
  </Drawer>
}
