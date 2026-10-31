import { LiveHeatmap } from './LiveHeatmap'
import { VendorHeatmap } from './VendorHeatmap'
import { PlayerHeatmapWidget } from './PlayerHeatmapWidget'
import type { CasinoDashboard } from '../../casinoLiveModel'
import styles from '../../CasinoLive.module.css'
interface HeatmapTabProps { dashboard: CasinoDashboard | null; windowMins: number; didAnimate: boolean }
export function HeatmapTab({ dashboard, windowMins }: HeatmapTabProps) {
  return <div className={styles.stack}><LiveHeatmap breakdown={dashboard?.breakdown} windowMins={windowMins} /><VendorHeatmap breakdown={dashboard?.breakdown} /><PlayerHeatmapWidget windowMins={windowMins * 24} /></div>
}

