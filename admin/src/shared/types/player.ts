export interface Player {
  id: string;
  name: string;
  email?: string;
  phone: string;
  username?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  bonusAllowed: boolean;
  requirePasswordReset?: boolean;
  sportsVisible?: boolean;
  sportsBetAllowed?: boolean;
  casinoVisible?: boolean;
  casinoBetAllowed?: boolean;
  matkaVisible?: boolean;
  matkaBetAllowed?: boolean;
  withdrawalLock?: boolean;
  riskType?: 'LOW' | 'MEDIUM' | 'HIGH';
  vipTierId?: string;
  vipTierName?: string;
  vipTierMode?: string;
  vipDepositAccess?: { eligible: boolean; message?: string; tierId?: string; tierName?: string; mode?: string; programStartedAt?: string; monthlyDeposits?: number };
  dailyStakeLimit?: number | null;
  weeklyStakeLimit?: number | null;
  exposureCapOverride?: number | null;
  cooldownSeconds?: number | null;
  maxBetSports?: number | null;
  maxBetCasino?: number | null;
  maxBetMatka?: number | null;
  wallet?: {
    userId: string;
    currency: string;
    balance: number;
    bonus: number;
    exposure: number;
    updatedAt: string;
  } | null;
  createdAt?: string;
  lastLogin?: string;
  agentId?: string;
  playerType?: string;
  creditLimit?: number;
  creditUsed?: number;
  creditAvailable?: number;
  settlementBalance?: number;
  settlementBalanceSports?: number;
  settlementBalanceCasino?: number;
  settlementBalanceMatka?: number;
  parentAgent?: {
    id: string;
    username?: string;
    schemeType?: string;
  };
  referredBy?: {
    id: string;
    username?: string | null;
    name?: string;
    phone?: string | null;
  } | null;
  remark?: string | null;
  stats?: PlayerListStats;
}

export interface PlayerListStats {
  // For REGULAR and SHARING_AGENT_PLAYER
  totalDeposits?: number | null;
  totalWithdrawals?: number | null;
  depositCount?: number | null;
  withdrawalCount?: number | null;
  
  // For all player types (except commission)
  ggr?: number | null;
  profitLoss?: number | null;
  plTrend?: 'up' | 'down' | 'neutral' | null;
  betCount?: number | null;
  totalExposure?: number | null;
  lastLogin?: string | null;
  lastActivityAt?: string | null;
  lastBetAt?: string | null;
  daysSinceLastBet?: number | null;
  
  // For COMMISSION_AGENT_PLAYER
  turnover?: number | null;
  commissionEarned?: number | null;
  commissionTrend?: 'up' | 'down' | 'neutral' | null;
}

export interface PlayerWallet {
  userId: string;
  currency: string;
  balance: number;
  exposure: number;
  available: number;
  updatedAt: string;
}

export interface PlayerStats {
  totalBets: number;
  totalWinnings: number;
  totalDeposits: number;
  totalWithdrawals: number;
  winRate: number;
  averageBet: number;
  lastActivity: string;
}

export interface CreatePlayerData {
  name: string;
  email: string;
  phone: string;
  initialBalance?: number;
  currency?: string;
}

export interface PlayerFilters {
  query?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  balanceMin?: number;
  balanceMax?: number;
  registeredFrom?: string;
  registeredTo?: string;
}

export interface PlayerTableColumn {
  key: string;
  title: string;
  dataIndex: string;
  render?: (value: any, record: Player) => React.ReactNode;
  sorter?: boolean;
  filters?: Array<{ text: string; value: string }>;
  onFilter?: (value: any, record: Player) => boolean;
}
