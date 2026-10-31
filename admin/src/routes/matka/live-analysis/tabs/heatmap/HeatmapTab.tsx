import type { MatkaDashboard } from '../../liveUiModel'
import type { FC } from 'react'
import { LiveHeatmap } from './LiveHeatmap'
import { PlayerHeatmapWidget } from './PlayerHeatmapWidget'
import styles from '../../MatkaLiveUi.module.css'
interface Props { dashboard: MatkaDashboard | null; didAnimate: boolean }
export const HeatmapTab: FC<Props> = ({ dashboard }) => <div className={styles.stack}><LiveHeatmap breakdown={dashboard?.breakdown} /><PlayerHeatmapWidget /></div>

