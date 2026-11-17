import type { MatkaDashboard } from '../../liveUiModel'
import type { FC } from 'react'
import { PlayerJourneyMapping } from './PlayerJourneyMapping'
import { BidTypeAnalytics } from './BidTypeAnalytics'
import { MatkaAnalytics } from './MatkaAnalytics'
import { PlayerAnalyticsWidget } from './PlayerAnalyticsWidget'
import { DigitAnalytics } from './DigitAnalytics'
import { MarketSessionAnalytics } from './MarketSessionAnalytics'
import { DigitHeatmap } from './DigitHeatmap'
import { DigitFrequencyAnalysis } from './DigitFrequencyAnalysis'
import styles from '../../MatkaLiveUi.module.css'
interface Props { dashboard: MatkaDashboard | null; didAnimate: boolean }
export const AnalyticsTab: FC<Props> = ({ dashboard }) => <div className={styles.stack}><PlayerJourneyMapping /><div className={styles.grid2}><BidTypeAnalytics breakdown={dashboard?.breakdown} /><MatkaAnalytics breakdown={dashboard?.breakdown} /></div><DigitAnalytics breakdown={dashboard?.breakdown} /><div className={`${styles.grid2} ${styles.alignStart}`}><DigitHeatmap breakdown={dashboard?.breakdown} /><DigitFrequencyAnalysis breakdown={dashboard?.breakdown} /></div><MarketSessionAnalytics breakdown={dashboard?.breakdown} /><PlayerAnalyticsWidget /></div>

