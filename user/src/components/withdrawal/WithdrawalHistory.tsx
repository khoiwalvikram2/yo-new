import { AlertCircle, Calendar, Filter, RefreshCw, Search } from 'lucide-react'
import { useState, useMemo } from 'react'
import WalletTable from '@/components/statements/WalletTable'
import type { WalletTxn } from '@/components/statements/types'
import { TransactionRowSkeleton } from '@/components/deposit/SkeletonLoader'
import { WithdrawalDetailsModal } from './WithdrawalDetailsModal'

interface WithdrawalHistoryProps {
  withdrawals: any[]
  loading?: boolean
  error?: string | null
  onRefresh?: () => void
}

export function WithdrawalHistory({ withdrawals, loading, error, onRefresh }: WithdrawalHistoryProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'pending' | 'processing' | 'failed'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '30d' | '90d'>('30d')
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<any | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Create a map to store original withdrawal data
  const withdrawalMap = useMemo(() => {
    const map = new Map<string, any>()
    withdrawals.forEach((w: any) => {
      const id = String(w?.id || w?._id || '')
      if (id) map.set(id, w)
    })
    return map
  }, [withdrawals])

  // Transform withdrawals to wallet rows
  const walletRows: WalletTxn[] = useMemo(() => {
    return withdrawals.map((row: any, idx: number) => {
      const dateISO = (() => {
        const candidates = [
          row?.createdAt,
          row?.created_at,
          row?.createdDate,
          row?.date,
          row?.timestamp,
          row?.updatedAt,
        ]
        for (const v of candidates) {
          if (!v) continue
          const d = new Date(v)
          if (!Number.isNaN(d.getTime())) return d.toISOString()
        }
        return ''
      })()

      const status = (() => {
        const raw = String(
          row?.status ?? row?.txnStatus ?? row?.paymentStatus ?? row?.state ?? ''
        )
          .trim()
          .toLowerCase()
        const successSet = new Set([
          'approved',
          'success',
          'successful',
          'settled',
          'completed',
          'done',
          'completed',
        ])
        const pendingSet = new Set([
          'pending',
          'inprogress',
          'processing',
          'initiated',
          'created',
        ])
        const processingSet = new Set(['processing'])
        const failedSet = new Set([
          'failed',
          'rejected',
          'declined',
          'cancelled',
          'canceled',
          'error',
        ])
        if (successSet.has(raw) || raw === '1' || raw === 'approved_by_admin')
          return 'Success' as const
        if (processingSet.has(raw)) return 'Processing' as const
        if (pendingSet.has(raw) || raw === '' || raw === '0') return 'Pending' as const
        if (failedSet.has(raw) || raw === '2' || raw === '3') return 'Failed' as const
        return 'Pending' as const
      })()

      return {
        id: String(row?.id || row?._id || idx + 1),
        dateISO,
        type: 'Withdraw' as const,
        amount: Number(row?.amount || 0),
        status,
      }
    })
  }, [withdrawals])

  // Apply filters
  const filteredRows = useMemo(() => {
    let filtered = [...walletRows]

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(
        (row) => row.status.toLowerCase() === statusFilter.toLowerCase()
      )
    }

    // Date filter
    if (dateFilter !== 'all') {
      const now = Date.now()
      const days = parseInt(dateFilter)
      const cutoff = now - days * 24 * 60 * 60 * 1000
      filtered = filtered.filter((row) => {
        if (!row.dateISO) return false
        return new Date(row.dateISO).getTime() >= cutoff
      })
    }

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter((row) => row.id.toLowerCase().includes(term))
    }

    // Sort by date descending
    return filtered.sort((a, b) => {
      const ta = a.dateISO ? new Date(a.dateISO).getTime() : 0
      const tb = b.dateISO ? new Date(b.dateISO).getTime() : 0
      return tb - ta
    })
  }, [walletRows, statusFilter, dateFilter, searchTerm])

  return (
    <div className="wd-history">

      {/* Filters */}
      <div className="wd-toolbar">
        {/* Search */}
        <div className="wd-control">
          <Search className="h-4 w-4" />
          <input
            type="text"
            placeholder="Search by transaction ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="wd-control-input"
          />
        </div>

        {/* Status Filter */}
        <div className="wd-control">
          <Filter className="h-4 w-4" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="wd-control-input"
          >
            <option value="all">All Status</option>
            <option value="success">Successful</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        {/* Date Filter */}
        <div className="wd-control">
          <Calendar className="h-4 w-4" />
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
            className="wd-control-input"
          >
            <option value="all">All Time</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
        </div>

        {/* Refresh Button */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh"
            className="wd-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline text-sm">Refresh</span>
          </button>
        )}
      </div>

      {/* Results Count */}
      <div className="wd-results">
        <span>
          Showing {filteredRows.length} of {walletRows.length} withdrawals
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="wd-table nova-stmt-table-wrap">
          <div className="nova-stmt-scroll">
            <table className="nova-stmt-table">
              <thead>
                <tr>
                  <th className="c-date">Date</th>
                  <th className="c-kind">Type</th>
                  <th className="c-amount is-num">Amount</th>
                  <th className="c-status is-center">Status</th>
                  <th className="c-id hidden sm:table-cell">Transaction ID</th>
                  <th className="c-actions is-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((i) => (
                  <TransactionRowSkeleton key={i} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : error ? (
        <div className="wd-empty is-error">
          <div className="wd-empty-icon">
            <AlertCircle className="h-6 w-6" />
          </div>
          <p className="wd-empty-title">{error}</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="wd-empty">
          <div className="wd-empty-icon">
            <Calendar className="h-6 w-6" />
          </div>
          <p className="wd-empty-title">
            {searchTerm || statusFilter !== 'all' || dateFilter !== 'all'
              ? 'No withdrawals match your filters'
              : 'No withdrawal history found'}
          </p>
        </div>
      ) : (
        <div className="wd-table">
          <WalletTable
            rows={filteredRows}
            showViewButton={true}
            theme="slate"
            onViewClick={(row) => {
              // Find original withdrawal data
              const originalWithdrawal = withdrawalMap.get(row.id) || withdrawals.find((w: any) => String(w?.id || w?._id) === row.id)
              if (originalWithdrawal) {
                setSelectedWithdrawal(originalWithdrawal)
                setIsModalOpen(true)
              }
            }}
          />
        </div>
      )}

      {/* Withdrawal Details Modal */}
      <WithdrawalDetailsModal
        withdrawal={selectedWithdrawal}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedWithdrawal(null)
        }}
      />
    </div>
  )
}

