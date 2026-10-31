import type { NavItem } from "@/types";
import { Home, Trophy, Gift, Dice1, Compass, Gamepad2, Rocket, CreditCard, Wallet } from "lucide-react";

 

export const primary: NavItem[] = [
  { label: "Home", icon: Home },
  { label: "My Bets", icon: Trophy },
];

export const games: NavItem[] = [
  { label: "Jackpot", icon: Gift },
  { label: "Dice", icon: Dice1 },
  { label: "Mines", icon: Compass },
  { label: "Roulette", icon: Gamepad2 },
  { label: "Slots", icon: Rocket },
  { label: "Crash", icon: Rocket },
  { label: "Card", icon: CreditCard },
  { label: "Case", icon: Wallet },
  { label: "Plinko", icon: Dice1 },
];

export const sports: NavItem[] = [
  { label: "Live", icon: Trophy },
  { label: "Football", icon: Gamepad2 },
  { label: "Cricket", icon: Rocket },
  { label: "Tennis", icon: Dice1 },
  { label: "Esports", icon: Gamepad2 },
  { label: "Upcoming", icon: Compass },
  { label: "Top Leagues", icon: Trophy },
  { label: "Results", icon: Wallet },
];


