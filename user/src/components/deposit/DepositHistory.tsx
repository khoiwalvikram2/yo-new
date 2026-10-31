import { AlertTriangle, Calendar, Eye, Filter, RefreshCw, Search } from 'lucide-react'
import { useState, useMemo } from 'react'
import { formatAmount } from '@/lib/currency'
import DateCell from '@/components/statements/DateCell'
import type { WalletTxn } from '@/components/statements/types'
import { DepositDetailsModal } from './DepositDetailsModal'

// Chip tone (nova-account.css) for each normalised history status.
const statusTone: Record<string, string> = {
  Success: 'is-success',
  Pending: 'is-pending',
  Processing: 'is-pending',
  Failed: 'is-failed',
}

interface DepositHistoryProps {
  deposits: any[]
  loading?: boolean
  error?: string | null
  onRefresh?: () => void
}

export function DepositHistory({ deposits, loading, error, onRefresh }: DepositHistoryProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'pending' | 'failed'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '30d' | '90d'>('30d')
  const [selectedDeposit, setSelectedDeposit] = useState<any | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Create a map to store original deposit data
  const depositMap = useMemo(() => {
    const map = new Map<string, any>()
    deposits.forEach((d: any) => {
      const id = String(d?.id || d?._id || '')
      if (id) map.set(id, d)
    })
    return map
  }, [deposits])

  // Transform deposits to wallet rows
  const walletRows: WalletTxn[] = useMemo(() => {
    return deposits.map((row: any, idx: number) => {
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
        ])
        const pendingSet = new Set([
          'pending',
          'inprogress',
          'processing',
          'initiated',
          'created',
        ])
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
        if (pendingSet.has(raw) || raw === '' || raw === '0') return 'Pending' as const
        if (failedSet.has(raw) || raw === '2' || raw === '3') return 'Failed' as const
        return 'Pending' as const
      })()

      return {
        id: String(row?.id || row?._id || idx + 1),
        dateISO,
        type: 'Deposit' as const,
        amount: Number(row?.amount || 0),
        status,
      }
    })
  }, [deposits])

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
    <div className="dep-history nova-acct-panel">

      {/* Filters */}
      <div className="dep-history-toolbar">
        {/* Search */}
        <div className="dep-search">
          <Search className="dep-tool-icon" />
          <input
            type="text"
            placeholder="Search by transaction ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="dep-search-input"
          />
        </div>

        {/* Status Filter */}
        <div className="dep-tool-select">
          <Filter className="dep-tool-icon" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="dep-filter-select"
          >
            <option value="all">All Status</option>
            <option value="success">Successful</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        {/* Date Filter */}
        <div className="dep-tool-select">
          <Calendar className="dep-tool-icon" />
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
            className="dep-filter-select"
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
            className="dep-refresh"
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        )}
      </div>

      {/* Results Count */}
      <div className="dep-history-count">
        <span>
          Showing {filteredRows.length} of {walletRows.length} deposits
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="dep-table-wrap">
          <table className="dep-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="dep-col-wide">Type</th>
                <th className="is-num">Amount</th>
                <th>Status</th>
                <th className="dep-col-wide">Transaction ID</th>
                <th className="is-action">Actions</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5].map((i) => (
                <tr key={i} className="animate-pulse">
                  <td><div className="dep-skel-bar is-date" /></td>
                  <td className="dep-col-wide"><div className="dep-skel-bar is-type" /></td>
                  <td className="is-num"><div className="dep-skel-bar is-amount" /></td>
                  <td><div className="dep-skel-bar is-status" /></td>
                  <td className="dep-col-wide"><div className="dep-skel-bar is-id" /></td>
                  <td className="is-action"><div className="dep-skel-bar is-action" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : error ? (
        <div className="dep-empty is-error">
          <div className="dep-empty-icon">
            <AlertTriangle />
          </div>
          <p className="dep-empty-title">{error}</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="dep-empty">
          <div className="dep-empty-icon">
            <Calendar />
          </div>
          <p className="dep-empty-title">
            {searchTerm || statusFilter !== 'all' || dateFilter !== 'all'
              ? 'No deposits match your filters'
              : 'No deposit history found'}
          </p>
        </div>
      ) : (
        <div className="dep-table-wrap">
          <table className="dep-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="dep-col-wide">Type</th>
                <th className="is-num">Amount</th>
                <th>Status</th>
                <th className="dep-col-wide">Transaction ID</th>
                <th className="is-action">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td className="dep-cell-date">
                    <DateCell iso={row.dateISO} />
                  </td>
                  <td className="dep-col-wide">
                    <span className="dep-type">{row.type || '—'}</span>
                  </td>
                  <td className="is-num dep-cell-amount">
                    {formatAmount(row.amount)}
                  </td>
                  <td>
                    <span className={`nova-acct-chip ${statusTone[row.status] || 'is-neutral'}`}>{row.status}</span>
                  </td>
                  <td className="dep-col-wide dep-cell-id">
                    {row.type} {row.id}
                  </td>
                  <td className="is-action">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        // Find original deposit data
                        const originalDeposit = depositMap.get(row.id) || deposits.find((d: any) => String(d?.id || d?._id) === row.id)
                        if (originalDeposit) {
                          setSelectedDeposit(originalDeposit)
                          setIsModalOpen(true)
                        }
                      }}
                      className="dep-view"
                      aria-label="View"
                    >
                      <Eye aria-hidden="true" />
                      <span className="hidden sm:inline">View</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Deposit Details Modal */}
      <DepositDetailsModal
        deposit={selectedDeposit}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedDeposit(null)
        }}
      />
    </div>
  )
}

