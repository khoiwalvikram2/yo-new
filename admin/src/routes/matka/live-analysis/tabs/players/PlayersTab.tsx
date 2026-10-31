import { PlayerOverview } from './PlayerOverview'
import { TopPlayersTable } from './TopPlayersTable'
import { PlayerSegments } from './PlayerSegments'
import { PlayerProfitability } from './PlayerProfitability'
import styles from '../../MatkaLiveUi.module.css'
export const PlayersTab: FC<{ didAnimate: boolean }> = () => <div className={styles.stack}><PlayerOverview /><TopPlayersTable /><PlayerSegments /><PlayerProfitability /></div>

import type { FC } from 'react'
