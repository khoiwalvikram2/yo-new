import type { CasinoDashboard } from '../../casinoLiveModel'
import { RiskAnalyticsDashboard } from './RiskAnalyticsDashboard'
import { VendorAnalytics } from './VendorAnalytics'
import { PlayerPerformanceWidget } from './PlayerPerformanceWidget'
import styles from '../../CasinoLive.module.css'
interface Props { dashboard: CasinoDashboard | null; windowMins: number; headerHeight: number; didAnimate: boolean }
export function PerformanceTab({ dashboard, windowMins }: Props) {
  return <div className={styles.stack}><RiskAnalyticsDashboard kpis={dashboard?.kpis} breakdown={dashboard?.breakdown} windowMins={windowMins} /><VendorAnalytics windowMins={windowMins} /><PlayerPerformanceWidget windowMins={windowMins} /></div>
}

