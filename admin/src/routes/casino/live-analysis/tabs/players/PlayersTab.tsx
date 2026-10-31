import { PlayerOverview } from "./PlayerOverview";
import { TopPlayersTable } from "./TopPlayersTable";
import { PlayerSegments } from "./PlayerSegments";
import { PlayerProfitability } from "./PlayerProfitability";

import styles from '../../CasinoLive.module.css';
interface PlayersTabProps {
  windowMins: number;
  didAnimate: boolean;
}

export const PlayersTab = ({
  windowMins,
}: PlayersTabProps) => {
  return (
    <div
      className={styles.stack}
    >
      <PlayerOverview windowMins={windowMins} />
      <TopPlayersTable windowMins={windowMins} />
      <PlayerSegments windowMins={windowMins} />
      <PlayerProfitability windowMins={windowMins * 24} />
    </div>
  );
};

