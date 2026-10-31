import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Checkbox } from '@/ui/components/Checkbox'
import { EmptyState } from '@/ui/components/EmptyState'
import { SportImage } from './AutoSportSelector'
import type { Sport } from './types'
import styles from './Builder.module.css'
interface SportsSectionProps { sports: Sport[]; selectedCount: number; onToggleSport: (key: string) => void; onSelectAll: () => void; onClearAll: () => void }
export function SportsSection({ sports, selectedCount, onToggleSport, onSelectAll, onClearAll }: SportsSectionProps) {
  return <Card title="Select Sports" sub="Choose the sports you want to add to your platform" tools={<div className={styles.actions}>
    <Button size="sm" onClick={onSelectAll} disabled={selectedCount === sports.length}>Select All</Button>
    <Button size="sm" onClick={onClearAll} disabled={selectedCount === 0}>Clear All</Button>
  </div>}>
    {sports.length ? <div className={styles.sportGrid}>{sports.map(sport => <div key={sport.key} className={styles.choice}>
      <SportImage name={sport.name} /><Checkbox label={sport.name} checked={sport.selected} onChange={() => onToggleSport(sport.key)} />
    </div>)}</div> : <EmptyState title="No sports available" />}
  </Card>
}

