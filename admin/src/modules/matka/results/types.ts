export interface MatkaResult {
  id: string
  tenant?: string
  matkaId: string
  date: string // ISO yyyy-mm-dd
  type: 'open' | 'close'
  result: string
  declaredBy: string
  declaredByName?: string | null // Resolved user name
  declaredAt: string
  rolledBackAt?: string | null
  rolledBackBy?: string | null
  rolledBackByName?: string | null // Resolved user name
  rollbackReason?: string | null
  rollbackTag?: string | null
  createdAt: string
  pendingBetsCount?: number // Number of pending bets waiting for this result
}

export interface MatkaResultImpact {
  betsSettled: number
  winners: number
  totalPayout: number
}

export interface MatkaResultPayload {
  success: boolean
  message: string
  result: MatkaResult | null
  impact: MatkaResultImpact | null
}

export interface MatkaResultPage {
  items: MatkaResult[]
  total: number
}

export interface MatkaResultBulkRow {
  matkaId: string
  date: string
  type: 'open' | 'close'
  result: string
}

export interface MatkaResultBulkDryRun {
  valid: MatkaResultBulkRow[]
  invalid: Array<{ line: number; error: string }>
  errors: Array<{ line: number; error: string }>
}

