export interface VIPPerk {
  name: string
  description: string
  icon?: string
}

export interface VIPTier {
  depositPolicy?: VIPDepositPolicy
  id: string
  tenant?: string
  name: string
  level: number
  minMonthlyDeposit: number
  color: string
  benefits: string[]
  perks: VIPPerk[]
  status: string
  createdAt: string
  updatedAt: string
}

export interface VIPMemberStats {
  totalDeposits: number
  totalWithdrawals: number
  totalBets: number
  totalWins: number
  netGGR: number
  avgBetSize: number
  sessionsCount: number
  currency: string
}

export interface VIPDepositPolicy {
  enabled: boolean
  methods: Array<'BANK_TRANSFER' | 'UPI' | 'GATEWAY'>
  min: number | null
  max: number | null
  daily: number | null
  monthly: number | null
}

export interface VIPMember {
  id: string
  tenant?: string
  userId: string
  userName: string
  userEmail?: string
  tierId: string
  tierName: string
  tierLevel: number
  currentPoints: number
  lifetimePoints: number
  nextTierId?: string
  nextTierName?: string
  pointsToNextTier?: number
  joinedAt: string
  lastActivityAt?: string
  status: string
  stats?: VIPMemberStats
}

export interface VIPTransaction {
  id: string
  tenant?: string
  memberId: string
  type: string
  points: number
  description: string
  relatedEntityType?: string
  relatedEntityId?: string
  balanceBefore: number
  balanceAfter: number
  createdAt: string
}

export interface VIPHistory {
  id: string
  tenant?: string
  memberId: string
  fromTierId?: string
  fromTierName?: string
  toTierId: string
  toTierName: string
  reason: string
  pointsAtChange: number
  createdAt: string
}

export interface VIPTierDistribution {
  tierId: string
  tierName: string
  tierLevel: number
  memberCount: number
  percentage: number
}

export interface VIPStats {
  totalMembers: number
  activeMembers: number
  newMembersToday: number
  totalPointsAwarded: number
  tierDistribution: VIPTierDistribution[]
  topMembers: VIPMember[]
}

