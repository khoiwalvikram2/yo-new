import type { MatkaDashboard } from '../../liveUiModel'
import type { FC } from 'react'
import { Card } from '@/ui/components/Card'
import { RiskAnalyticsDashboard } from './RiskAnalyticsDashboard'
import { PlayerPerformanceWidget } from './PlayerPerformanceWidget'
import styles from '../../MatkaLiveUi.module.css'
interface Props { dashboard: MatkaDashboard | null; headerHeight: number; didAnimate: boolean }
export const PerformanceTab: FC<Props> = ({ dashboard }) => <div className={styles.stack}><RiskAnalyticsDashboard kpis={dashboard?.kpis} breakdown={dashboard?.breakdown} /><Card><PlayerPerformanceWidget /></Card></div>

