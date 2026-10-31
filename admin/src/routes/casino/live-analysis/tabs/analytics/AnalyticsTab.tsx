import type { CasinoDashboard } from '../../casinoLiveModel'
import { PlayerJourneyMapping } from './PlayerJourneyMapping'
import { GameAnalytics } from './GameAnalytics'
import { VendorCharts } from './VendorCharts'
import { PlayerAnalyticsWidget } from './PlayerAnalyticsWidget'
import styles from '../../CasinoLive.module.css'
interface Props { dashboard: CasinoDashboard | null; windowMins: number; didAnimate: boolean }
export function AnalyticsTab({ dashboard, windowMins }: Props) {
  return <div className={styles.stack}><PlayerJourneyMapping windowMins={windowMins} /><div className={styles.grid2}><GameAnalytics breakdown={dashboard?.breakdown} /><VendorCharts breakdown={dashboard?.breakdown} /></div><PlayerAnalyticsWidget windowMins={windowMins} /></div>
}

