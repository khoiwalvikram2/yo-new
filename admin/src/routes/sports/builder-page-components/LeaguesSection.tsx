import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Checkbox } from '@/ui/components/Checkbox'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { StatusPill } from '@/ui/components/StatusPill'
import type { League, Sport } from './types'
import styles from './Builder.module.css'
interface LeaguesSectionProps {
  selectedSports: Sport[]; leaguesToShow: League[]; onToggleLeague: (key: string) => void
  onSelectAllLeaguesForSport: (key: string) => void; onClearAllLeaguesForSport: (key: string) => void
  loading?: boolean; leaguesExpanded: Record<string, boolean>; onToggleSportLeagues: (key: string) => void
  onExpandAllLeagues: () => void; onCollapseAllLeagues: () => void; leaguesLoadingBySport?: Record<string, boolean>
}
export function LeaguesSection(props: LeaguesSectionProps) {
  const { selectedSports, leaguesToShow, leaguesExpanded, leaguesLoadingBySport } = props
  return <Card title="Select Leagues" sub="Choose competitions from your selected sports" tools={<div className={styles.actions}>
    <Button size="sm" onClick={props.onExpandAllLeagues}>Expand all</Button><Button size="sm" onClick={props.onCollapseAllLeagues}>Collapse all</Button>
  </div>}><div className={styles.stack}>
    {props.loading ? <LoadingState label="Loading leagues" /> : <>
      {!leaguesToShow.length && !Object.values(leaguesLoadingBySport ?? {}).some(Boolean) && <EmptyState title="No leagues found for the selected sports" />}
      {selectedSports.map(sport => {
        const leagues = leaguesToShow.filter(league => league.sportKey === sport.key).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        if (!leagues.length && !leaguesLoadingBySport?.[sport.key]) return null
        const expanded = Boolean(leaguesExpanded[sport.key])
        return <section key={sport.key} className={styles.group}>
          <Button className={styles.disclosure} aria-expanded={expanded} onClick={() => props.onToggleSportLeagues(sport.key)}>{sport.name} · {leagues.length} leagues · {leagues.filter(league => league.selected).length} selected · {expanded ? 'Hide' : 'Show'}</Button>
          {expanded && <div className={styles.groupBody}>
            {leaguesLoadingBySport?.[sport.key] && <LoadingState label={`Loading ${sport.name} leagues`} />}
            <div className={styles.row}><span>Available Leagues</span><div className={styles.actions}><Button size="sm" onClick={() => props.onSelectAllLeaguesForSport(sport.key)}>Select all</Button><Button size="sm" onClick={() => props.onClearAllLeaguesForSport(sport.key)}>Clear</Button></div></div>
            <div className={styles.sportGrid}>{leagues.map(league => <div key={league.key} className={styles.choice}>
              <Checkbox label={league.name} checked={league.selected} onChange={() => props.onToggleLeague(league.key)} />
              {league.alreadyAdded && <StatusPill tone="info">Already added</StatusPill>}
            </div>)}</div>
          </div>}
        </section>
      })}
    </>}
  </div></Card>
}

