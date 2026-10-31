import type { MatkaDashboard, MatkaKpis } from '../../liveUiModel'
import type { FC } from 'react'
import { AlertsAndAnomaliesDashboard } from './AlertsAndAnomaliesDashboard'
import { MatkaPerformance } from './MatkaPerformance'
import { ExposureBook } from './ExposureBook'
import { ServerRiskAlerts } from './ServerRiskAlerts'
import { SelectionRiskDashboard } from './SelectionRiskDashboard'
import styles from '../../MatkaLiveUi.module.css'
interface Props { dashboard: MatkaDashboard | null; dataHistory: MatkaKpis[]; didAnimate: boolean }
export const OverviewTab: FC<Props> = ({ dashboard, dataHistory }) => <div className={styles.stack}><AlertsAndAnomaliesDashboard kpis={dashboard?.kpis} breakdown={dashboard?.breakdown} dataHistory={dataHistory} /><ServerRiskAlerts /><ExposureBook /><SelectionRiskDashboard breakdown={dashboard?.breakdown} /><MatkaPerformance breakdown={dashboard?.breakdown} /></div>

