// Matka Module Types

export interface Matka {
  id: string
  tenant?: string
  name: string
  code: string
  description?: string
  timezone: string
  schedule: Record<string, any>
  status: 'active' | 'inactive' | 'suspend'
  limits: Record<string, any>
  visibility: Record<string, any>
  priority: number
  settings: Record<string, any>
  createdBy?: string
  updatedBy?: string
  reason?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface MatkaBet {
  id: string
  tenant?: string
  whitelabelId: string
  userId: string
  matkaId: string
  matkaType: 'worli' | 'starline' | 'jackpot' | 'sattaMatka'
  marketName: string
  marketSession?: string
  bidType: string
  betNumbers: string
  betAmount: number
  payoutMultiplier: number
  potentialWin?: number
  actualWin?: number
  status: 'pending' | 'active' | 'won' | 'lost' | 'cancelled' | 'void'
  result?: string
  settledAt?: string
  currency: string
  createdAt: string
  updatedAt: string
}

export interface MatkaBetFilter {
  userId?: string
  matkaId?: string
  matkaType?: 'worli' | 'starline' | 'jackpot' | 'sattaMatka'
  marketName?: string
  marketSession?: string
  bidType?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
  offset?: number
}

export interface MatkaBetResponse {
  data: MatkaBet[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}
