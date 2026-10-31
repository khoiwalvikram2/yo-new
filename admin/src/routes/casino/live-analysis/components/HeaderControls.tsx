import { LiveWorkspaceHeader, type LiveHeaderProps } from '@/routes/live-analysis/LiveWorkspace'
import { Notice } from '@/ui/components/Notice'
import styles from '../CasinoLive.module.css'

interface HeaderControlsProps extends LiveHeaderProps {
  windowMins: number
  setWindowMins: (value: number) => void
}

/* The stream note reads with the head for assistive tech while the streams run (the kit head carries no
   note); paused, it shows, since then it is news. */
export function HeaderControls(props: HeaderControlsProps) {
  return <><LiveWorkspaceHeader {...props} feature="casino" />
    {props.autoRefresh
      ? <p className={styles.srOnly}>Dashboard and player-event streams update automatically. Individual tab queries keep their own polling.</p>
      : <Notice tone="info">Dashboard and player-event streams are paused. Refresh now resumes them. Individual tab queries keep their own polling.</Notice>}
  </>
}

