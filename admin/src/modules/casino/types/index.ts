// Casino Module Types
export interface CasinoGame {
  id: string
  gameId: string
  gameName: string
  provider: string
  category: string
  subcategory?: string
  rtp: number
  volatility: 'low' | 'medium' | 'high'
  isActive: boolean
  isFeatured: boolean
  thumbnailUrl?: string
  bannerUrl?: string
  description?: string
  tags: string[]
  minBet: number
  maxBet: number
  currency: string
  createdAt: string
  updatedAt: string
}

export interface CasinoProvider {
  id: string
  providerId: string
  providerName: string
  isActive: boolean
  isFeatured: boolean
  logoUrl?: string
  description?: string
  apiEndpoint?: string
  credentials?: Record<string, unknown>
  supportedCurrencies: string[]
  supportedLanguages: string[]
  gameCount: number
  createdAt: string
  updatedAt: string
}

export interface CasinoCategory {
  id: string
  categoryId: string
  categoryName: string
  parentId?: string
  isActive: boolean
  sortOrder: number
  iconUrl?: string
  description?: string
  gameCount: number
  children?: CasinoCategory[]
  createdAt: string
  updatedAt: string
}

export interface GameLimit {
  id: string
  gameId: string
  limitType: 'bet' | 'win' | 'loss' | 'session'
  limitValue: number
  currency: string
  period: 'daily' | 'weekly' | 'monthly' | 'session'
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface Jackpot {
  id: string
  jackpotId: string
  jackpotName: string
  gameId?: string
  categoryId?: string
  currentAmount: number
  seedAmount: number
  contributionRate: number
  currency: string
  isActive: boolean
  lastWonAt?: string
  lastWonBy?: string
  lastWonAmount?: number
  createdAt: string
  updatedAt: string
}

export interface RTPConfig {
  id: string
  gameId: string
  rtp: number
  isActive: boolean
  effectiveDate: string
  createdAt: string
  updatedAt: string
}

export interface GameSession {
  id: string
  userId: string
  gameId: string
  sessionId: string
  startTime: string
  endTime?: string
  totalBet: number
  totalWin: number
  netResult: number
  currency: string
  status: 'active' | 'completed' | 'abandoned'
  createdAt: string
  updatedAt: string
}

export interface GameTransaction {
  id: string
  userId: string
  gameId: string
  sessionId: string
  transactionType: 'bet' | 'win' | 'bonus' | 'refund'
  amount: number
  currency: string
  balance: number
  gameData?: Record<string, unknown>
  createdAt: string
}

// Filter Types
export interface CasinoGameFilter {
  provider?: string
  category?: string
  subcategory?: string
  isActive?: boolean
  isFeatured?: boolean
  minRTP?: number
  maxRTP?: number
  volatility?: string
  currency?: string
  search?: string
}

export interface CasinoProviderFilter {
  isActive?: boolean
  isFeatured?: boolean
  supportedCurrency?: string
  supportedLanguage?: string
  search?: string
}

export interface CasinoCategoryFilter {
  parentId?: string
  isActive?: boolean
  search?: string
}

export interface GameLimitFilter {
  gameId?: string
  limitType?: string
  currency?: string
  period?: string
  isActive?: boolean
}

export interface JackpotFilter {
  gameId?: string
  categoryId?: string
  currency?: string
  isActive?: boolean
  minAmount?: number
  maxAmount?: number
}

// API Response Types
export interface CasinoGameResponse {
  data: CasinoGame[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

export interface CasinoProviderResponse {
  data: CasinoProvider[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

export interface CasinoCategoryResponse {
  data: CasinoCategory[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

export interface GameLimitResponse {
  data: GameLimit[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

export interface JackpotResponse {
  data: Jackpot[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

// Form Types
export interface CreateGameForm {
  gameId: string
  gameName: string
  provider: string
  category: string
  subcategory?: string
  rtp: number
  volatility: string
  isActive: boolean
  isFeatured: boolean
  thumbnailUrl?: string
  bannerUrl?: string
  description?: string
  tags: string[]
  minBet: number
  maxBet: number
  currency: string
}

export interface UpdateGameForm {
  gameName?: string
  category?: string
  subcategory?: string
  rtp?: number
  volatility?: string
  isActive?: boolean
  isFeatured?: boolean
  thumbnailUrl?: string
  bannerUrl?: string
  description?: string
  tags?: string[]
  minBet?: number
  maxBet?: number
}

export interface CreateProviderForm {
  providerId: string
  providerName: string
  isActive: boolean
  isFeatured: boolean
  logoUrl?: string
  description?: string
  apiEndpoint?: string
  credentials?: Record<string, unknown>
  supportedCurrencies: string[]
  supportedLanguages: string[]
}

export interface UpdateProviderForm {
  providerName?: string
  isActive?: boolean
  isFeatured?: boolean
  logoUrl?: string
  description?: string
  apiEndpoint?: string
  credentials?: Record<string, unknown>
  supportedCurrencies?: string[]
  supportedLanguages?: string[]
}

export interface CreateCategoryForm {
  categoryId: string
  categoryName: string
  parentId?: string
  isActive: boolean
  sortOrder: number
  iconUrl?: string
  description?: string
}

export interface UpdateCategoryForm {
  categoryName?: string
  parentId?: string
  isActive?: boolean
  sortOrder?: number
  iconUrl?: string
  description?: string
}

export interface CreateLimitForm {
  gameId: string
  limitType: string
  limitValue: number
  currency: string
  period: string
  isActive: boolean
}

export interface UpdateLimitForm {
  limitType?: string
  limitValue?: number
  currency?: string
  period?: string
  isActive?: boolean
}

export interface CreateJackpotForm {
  jackpotId: string
  jackpotName: string
  gameId?: string
  categoryId?: string
  seedAmount: number
  contributionRate: number
  currency: string
  isActive: boolean
}

export interface UpdateJackpotForm {
  jackpotName?: string
  gameId?: string
  categoryId?: string
  seedAmount?: number
  contributionRate?: number
  currency?: string
  isActive?: boolean
}

// Constants
export const VOLATILITY_LEVELS = ['low', 'medium', 'high'] as const
export const LIMIT_TYPES = ['bet', 'win', 'loss', 'session'] as const
export const LIMIT_PERIODS = ['daily', 'weekly', 'monthly', 'session'] as const
export const TRANSACTION_TYPES = ['bet', 'win', 'bonus', 'refund'] as const
export const SESSION_STATUSES = ['active', 'completed', 'abandoned'] as const

// Provider/Vendor Sharing & Analytics
export interface ProviderInput {
  key?: string
  name?: string
  status?: string
}

export interface VendorStats {
  vendorId: string
  vendorName: string
  totalGames: number
  activeGames: number
}

export interface ProviderWithVendors {
  id: string
  key: string
  name: string
  status: string
  lastSyncAt?: string | null
  vendors: Array<{ id: string; name: string; slug: string }>
  vendorStats?: VendorStats[]
  shares?: Array<{ vendorId: string; vendorName?: string | null; sharePercentage: number; updatedAt?: string | null }>
}

export interface CasinoProviderVendorShare {
  vendorId: string
  vendorName?: string | null
  sharePercentage: number
  updatedAt?: string | null
}

export interface ProviderAnalytics {
  providerId: string
  totalGGR: number
}

export interface VendorAnalytics {
  providerId: string
  vendorId: string
  ggr: number
  sharePercentage?: number
  shareAmount: number
}

// Casino Bet Types
export interface CasinoBet {
  id: string
  tenant?: string
  whitelabelId: string
  userId: string
  gameId: string
  gameName?: string
  providerId?: string
  sessionId?: string
  vendorId: string
  vendorName: string
  tableId?: string
  stake: number
  payout?: number
  winAmount?: number
  netAmount?: number
  status: 'pending' | 'active' | 'won' | 'lost' | 'cancelled' | 'void'
  gameRoundId?: string
  transactionId?: string
  settledAt?: string
  currency: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CasinoBetFilter {
  userId?: string
  gameId?: string
  vendorId?: string
  tableId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
  offset?: number
}

export interface CasinoBetResponse {
  data: CasinoBet[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}
