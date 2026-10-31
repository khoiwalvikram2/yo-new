import { Meter } from '@/ui/components/Meter'
import { Notice } from '@/ui/components/Notice'
import { Button } from '@/ui/components/Button'
import { StatusPill } from '@/ui/components/StatusPill'
import { SportsSection } from './SportsSection'
import { LeaguesSection } from './LeaguesSection'
import { EventsSection } from './EventsSection'
import ReviewSection from './ReviewSection'
import type { Sport, League, Event } from './types'
import styles from './Builder.module.css'
interface Props {
  currentStep: 1 | 2 | 3 | 4; onStepChange: (step: 1 | 2 | 3 | 4) => void
  sports: Sport[]; selectedCount: number; selectedSports: Sport[]; leaguesToShow: League[]; leagues: League[]; events: Event[]
  leaguesLoading: boolean; leaguesExpanded: Record<string, boolean>; leaguesLoadingBySport: Record<string, boolean>
  eventsExpanded: Record<string, boolean>; eventsLoadingByLeague: Record<string, boolean>; reviewExpanded: Record<string, boolean>; leagueExpanded: Record<string, boolean>
  toggleSport: (key: string) => void; selectAll: () => void; clearAll: () => void
  selectAllLeaguesForSport: (key: string) => void; clearAllLeaguesForSport: (key: string) => void; toggleLeague: (key: string) => void
  toggleSportLeagues: (key: string) => void; expandAllLeagues: () => void; collapseAllLeagues: () => void
  toggleSportEvents: (key: string) => void; onToggleLeagueEvents: (key: string, checked: boolean) => void; toggleEvent: (id: string) => void
  expandAllEvents: () => void; collapseAllEvents: () => void; toggleSportReview: (key: string) => void; toggleLeagueReview: (key: string) => void; onRequestConfirm: () => void
}
const steps = ['Select Sports', 'Select Leagues', 'Select Events', 'Review'] as const
export default function ManualBuilderPanel(props: Props) {
  const step = props.currentStep
  const leagues = props.leagues.filter(league => league.selected && props.selectedSports.some(sport => sport.key === league.sportKey))
  const events = props.events.filter(event => event.selected && leagues.some(league => league.key === event.leagueKey))
  const count = step === 1 ? props.selectedCount : step === 2 ? leagues.length : events.length
  const next = step === 1 ? 'Continue to Leagues' : step === 2 ? 'Continue to Events' : 'Review & Continue'
  return <div className={styles.stack}>
    <ol className={styles.steps} aria-label="Manual builder progress">{steps.map((label, index) => <li key={label} aria-current={index + 1 === step ? 'step' : undefined}>
      <StatusPill tone={index + 1 === step ? 'info' : 'muted'}>{index + 1}</StatusPill>{label}
    </li>)}</ol>
    <Notice tone="info" title="Existing platform items">Already added markers identify leagues and events that are on your platform.</Notice>
    {step === 1 && <SportsSection sports={props.sports} selectedCount={props.selectedCount} onToggleSport={props.toggleSport} onSelectAll={props.selectAll} onClearAll={props.clearAll} />}
    {step === 2 && props.selectedSports.length > 0 && <LeaguesSection selectedSports={props.selectedSports} leaguesToShow={props.leaguesToShow}
      onToggleLeague={props.toggleLeague} onSelectAllLeaguesForSport={props.selectAllLeaguesForSport} onClearAllLeaguesForSport={props.clearAllLeaguesForSport}
      loading={props.leaguesLoading} leaguesExpanded={props.leaguesExpanded} onToggleSportLeagues={props.toggleSportLeagues}
      onExpandAllLeagues={props.expandAllLeagues} onCollapseAllLeagues={props.collapseAllLeagues} leaguesLoadingBySport={props.leaguesLoadingBySport} />}
    {step === 3 && <EventsSection events={props.events} leagues={props.leagues} selectedSports={props.selectedSports} eventsExpanded={props.eventsExpanded}
      onToggleSportEvents={props.toggleSportEvents} onToggleLeagueEvents={props.onToggleLeagueEvents} onToggleEvent={props.toggleEvent}
      onExpandAll={props.expandAllEvents} onCollapseAll={props.collapseAllEvents} eventsLoadingByLeague={props.eventsLoadingByLeague} />}
    {step === 4 && <ReviewSection selectedSports={props.selectedSports} leagues={props.leagues} events={props.events} reviewExpanded={props.reviewExpanded}
      leagueExpanded={props.leagueExpanded} onToggleSport={props.toggleSportReview} onToggleLeague={props.toggleLeagueReview} />}
    <div className={styles.wizardActions}>
      <div className={styles.progress}><Meter value={step / 4 * 100} label="Manual builder progress" valueText={`Step ${step} of 4: ${steps[step - 1]}`} /><span>{step}/4 · {steps[step - 1]}</span></div>
      <div className={styles.actions}><StatusPill tone={step === 4 ? 'ok' : 'info'}>{count} {step === 1 ? 'sports' : step === 2 ? 'leagues' : 'events'} selected</StatusPill>
        <Button disabled={step === 1} onClick={() => props.onStepChange(Math.max(1, step - 1) as Props['currentStep'])}>Back</Button>
        {step === 4 ? <Button variant="primary" onClick={props.onRequestConfirm}>Add to Platform</Button> : <Button variant="primary" disabled={count === 0} onClick={() => props.onStepChange((step + 1) as Props['currentStep'])}>{next}</Button>}
      </div>
    </div>
  </div>
}

