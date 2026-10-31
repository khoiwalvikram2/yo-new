// Core interfaces for the application

// Base Entity Interface
export interface BaseEntity {
  id: string
  createdAt: string
  updatedAt: string
  createdBy?: string
  updatedBy?: string
}

// Pagination Interface
export interface PaginationParams {
  page: number
  limit: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

// API Response Interfaces
export interface ApiResponse<T = any> {
  data: T
  success: boolean
  message?: string
  errors?: string[]
  meta?: PaginationMeta
}

export interface ApiError {
  message: string
  code: string
  details?: any
  field?: string
}

// Filter Interfaces
export interface BaseFilter {
  search?: string
  status?: string
  dateRange?: {
    startDate: string
    endDate: string
  }
}

export interface SortOptions {
  field: string
  direction: 'asc' | 'desc'
}

// User Interfaces
export interface User extends BaseEntity {
  email: string
  name: string
  role: string
  permissions: string[]
  tenantId: string
  whitelabelId: string
  isActive: boolean
  lastLoginAt?: string
}

export interface UserFilter extends BaseFilter {
  role?: string
  tenantId?: string
  whitelabelId?: string
  isActive?: boolean
}

// Currency Interfaces
export interface Currency extends BaseEntity {
  code: string
  name: string
  symbol: string
  decimalPlaces: number
  isActive: boolean
  isBase: boolean
}

export interface ExchangeRate extends BaseEntity {
  fromCurrency: string
  toCurrency: string
  rate: number
  effectiveDate: string
  isActive: boolean
}

// Player Interfaces
export interface Player extends BaseEntity {
  userId: string
  username: string
  email: string
  phone?: string
  firstName: string
  lastName: string
  dateOfBirth?: string
  country: string
  currency: string
  status: string
  kycStatus: string
  totalDeposits: number
  totalWithdrawals: number
  currentBalance: number
  lastLoginAt?: string
  registeredAt: string
}

export interface PlayerFilter extends BaseFilter {
  status?: string
  kycStatus?: string
  currency?: string
  country?: string
  registrationDateRange?: {
    startDate: string
    endDate: string
  }
}

// Sports Interfaces
export interface SportsMarket extends BaseEntity {
  eventId: string
  eventName: string
  sport: string
  league: string
  startTime: string
  status: string
  markets: Market[]
}

export interface Market extends BaseEntity {
  marketId: string
  marketName: string
  marketType: string
  status: string
  selections: Selection[]
}

export interface Selection extends BaseEntity {
  selectionId: string
  selectionName: string
  odds: number
  status: string
  isActive: boolean
}

// Casino Interfaces
export interface CasinoGame extends BaseEntity {
  gameId: string
  gameName: string
  provider: string
  category: string
  rtp: number
  volatility: string
  isActive: boolean
  thumbnailUrl?: string
}

export interface CasinoProvider extends BaseEntity {
  providerId: string
  providerName: string
  isActive: boolean
  apiEndpoint?: string
  credentials?: Record<string, any>
}

// Matka Interfaces
export interface MatkaDraw extends BaseEntity {
  drawId: string
  drawName: string
  drawTime: string
  status: string
  results?: MatkaResult[]
}

export interface MatkaResult extends BaseEntity {
  resultId: string
  drawId: string
  number: string
  payout: number
  isDeclared: boolean
}

// Reporting Interfaces
export interface ReportData {
  period: string
  metrics: Record<string, number>
  breakdown?: Record<string, any>
}

export interface ReportFilter {
  dateRange: {
    startDate: string
    endDate: string
  }
  groupBy?: string
  filters?: Record<string, any>
}

// Audit Interfaces
export interface AuditEvent extends BaseEntity {
  eventType: string
  entityType: string
  entityId: string
  userId: string
  action: string
  changes?: Record<string, any>
  ipAddress?: string
  userAgent?: string
}

// Configuration Interfaces
export interface AppConfig {
  theme: 'light' | 'dark' | 'system'
  language: string
  timezone: string
  currency: string
  dateFormat: string
  notifications: {
    email: boolean
    push: boolean
    sms: boolean
  }
}

// Navigation Interfaces
export interface NavItem {
  key: string
  label: string
  icon?: string
  path?: string
  children?: NavItem[]
  permissions?: string[]
  badge?: string | number
  disabled?: boolean
}

export interface BreadcrumbItem {
  label: string
  path?: string
}

// Form Interfaces
export interface FormField {
  name: string
  label: string
  type: 'text' | 'email' | 'password' | 'number' | 'select' | 'date' | 'textarea' | 'checkbox' | 'radio'
  required?: boolean
  placeholder?: string
  options?: Array<{ label: string; value: any }>
  validation?: any
}

export interface FormConfig {
  fields: FormField[]
  submitText?: string
  resetText?: string
  layout?: 'vertical' | 'horizontal' | 'inline'
}

// Table Interfaces
export interface TableColumn {
  key: string
  title: string
  dataIndex: string
  sorter?: boolean
  filterable?: boolean
  render?: (value: any, record: any, index: number) => React.ReactNode
  width?: number | string
  align?: 'left' | 'center' | 'right'
}

export interface TableConfig {
  columns: TableColumn[]
  pagination?: boolean
  selection?: boolean
  expandable?: boolean
  scroll?: { x?: number; y?: number }
}

// Modal Interfaces
export interface ModalConfig {
  title: string
  width?: number | string
  closable?: boolean
  maskClosable?: boolean
  destroyOnClose?: boolean
  footer?: React.ReactNode
}

// Notification Interfaces
export interface NotificationConfig {
  type: 'success' | 'error' | 'warning' | 'info'
  title?: string
  message: string
  duration?: number
  placement?: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
}
