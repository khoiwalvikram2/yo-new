import type { CasinoDashboard, CasinoKpis } from '../../casinoLiveModel'
import { AlertsAndAnomaliesDashboard } from './AlertsAndAnomaliesDashboard'
import { FinancialHealthOverview } from './FinancialHealthOverview'
import { BigWinAlerts } from './BigWinAlerts'
import { GamePerformance } from './GamePerformance'
import { VendorOverview } from './VendorOverview'
import styles from '../../CasinoLive.module.css'
interface Props { dashboard: CasinoDashboard | null; dataHistory: Array<CasinoKpis & { timestamp: number }>; windowMins: number; didAnimate: boolean }
export function OverviewTab({ dashboard, dataHistory, windowMins }: Props) {
  return <div className={styles.stack}><AlertsAndAnomaliesDashboard kpis={dashboard?.kpis} breakdown={dashboard?.breakdown} dataHistory={dataHistory} windowMins={windowMins} /><FinancialHealthOverview kpis={dashboard?.kpis} windowMins={windowMins} /><BigWinAlerts windowMins={windowMins} /><GamePerformance breakdown={dashboard?.breakdown} /><VendorOverview breakdown={dashboard?.breakdown} /></div>
}

