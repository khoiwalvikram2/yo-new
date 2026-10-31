/**
 * Single source of truth for "All Sports" section and left sidebar.
 * Same sports in the same order in both places.
 */
import type { Sport } from "@/types";
import { Trophy, Dice1, Compass, Flame, Rocket, Gamepad2 } from "lucide-react";
import cricketImg from "../../assets/images/cricket.png";
import TennisImg from "../../assets/images/tennis.png";
import FootballImg from "../../assets/images/football.png";
import BoxingImg from "../../assets/images/boxing.png";
import RugbyImg from "../../assets/images/rugby.png";
import MMAImg from "../../assets/images/mma.png";
import EsportsImg from "../../assets/images/esports.png";
import BasketballImg from "../../assets/images/basketball.png";
import BaseballImg from "../../assets/images/baseball.png";
import IceHockeyImg from "../../assets/images/ice-hockey.png";
import SnookerImg from "../../assets/images/snooker.png";
import VolleyballImg from "../../assets/images/volleyball.png";
import CyclingImg from "../../assets/images/cycling.png";
import GolfImg from "../../assets/images/golf.png";
import PoliticsImg from "../../assets/images/politics.png";
import DartsImg from "../../assets/images/darts.png";
import HorseRacingImg from "../../assets/images/horse-racing.png";
import GreyhoundRacingImg from "../../assets/images/greyhound-racing.png";
import LiveImg from "../../assets/images/live.png";

/** All sports in display order (includes Live for slider). */
export const ALL_SPORTS: Sport[] = [
  { key: "live", label: "Live", icon: Flame, count: 0, imageSrc: LiveImg },
  { key: "cricket", label: "Cricket", icon: Trophy, count: 0, imageSrc: cricketImg },
  { key: "football", label: "Football", icon: Gamepad2, count: 0, imageSrc: FootballImg },
  { key: "tennis", label: "Tennis", icon: Dice1, count: 0, imageSrc: TennisImg },
  { key: "basketball", label: "Basketball", icon: Compass, count: 0, imageSrc: BasketballImg },
  { key: "esports", label: "Esports", icon: Rocket, count: 0, imageSrc: EsportsImg },
  { key: "horseracing", label: "Horse Racing", icon: Rocket, count: 0, imageSrc: HorseRacingImg },
  { key: "greyhoundracing", label: "Greyhound Racing", icon: Dice1, count: 0, imageSrc: GreyhoundRacingImg },
  { key: "baseball", label: "Baseball", icon: Compass, count: 0, imageSrc: BaseballImg },
  { key: "ice-hockey", label: "Ice Hockey", icon: Trophy, count: 0, imageSrc: IceHockeyImg },
  { key: "volleyball", label: "Volleyball", icon: Compass, count: 0, imageSrc: VolleyballImg },
  { key: "boxing", label: "Boxing", icon: Trophy, count: 0, imageSrc: BoxingImg },
  { key: "mma", label: "MMA", icon: Rocket, count: 0, imageSrc: MMAImg },
  { key: "rugby", label: "Rugby", icon: Gamepad2, count: 0, imageSrc: RugbyImg },
  { key: "handball", label: "Handball", icon: Compass, count: 0, imageSrc: PoliticsImg },
  { key: "darts", label: "Darts", icon: Dice1, count: 0, imageSrc: DartsImg },
  { key: "snooker", label: "Snooker", icon: Trophy, count: 0, imageSrc: SnookerImg },
  { key: "cycling", label: "Cycling", icon: Compass, count: 0, imageSrc: CyclingImg },
  { key: "golf", label: "Golf", icon: Trophy, count: 0, imageSrc: GolfImg },
];

/** Same list without Live, for left sidebar. */
export const ALL_SPORTS_SIDEBAR = ALL_SPORTS.filter((s) => s.key !== "live");
