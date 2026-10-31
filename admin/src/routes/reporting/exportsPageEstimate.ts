import type { ApolloClient, DocumentNode } from '@apollo/client'
import {
  AGENT_EXPORT_ROW_COUNT_QUERY,
  AGENTS_COUNT_QUERY,
  AGENTS_FOR_ESTIMATE_QUERY,
  AGENTS_FOR_PERFORMANCE_QUERY,
  ALL_SUB_AGENTS_QUERY,
  AUDIT_LOGS_COUNT_QUERY,
  BONUS_CAMPAIGNS_COUNT_QUERY,
  CASINO_BETS_COUNT_QUERY,
  DEPOSIT_REQUESTS_COUNT_QUERY,
  MATKA_BETS_COUNT_QUERY,
  PLAYERS_COUNT_QUERY,
  PLAYERS_FOR_TRANSACTION_ESTIMATE_QUERY,
  SPORTS_BETS_COUNT_QUERY,
  WITHDRAWAL_REQUESTS_COUNT_QUERY,
} from './exportsPageQueries'
import {
  formatEstimateSize,
  wholeDaysBetween,
  type ExportDateRange,
  type ExportEstimate,
} from './exportsPageModel'

/* The Export Center's row estimate for one export type (page migration C, W3 Task 128).
 *
 * Moved out of ExportsPage.tsx's calculateEstimate. For admins it asks the same documents, with the same
 * variables and fetch policies, the same rough per-row byte sizes and the same
 * heuristics (30% active players, 70% active agents, weekly settlements, a 100-row audit sample). Any
 * failed query counts as no rows; the function never rejects. The page owns the cache and the busy
 * flag, as before. */

/* An agent's estimate is one question, agentExportRowCount: the backend counts the very rows its export
 * would hold (agent features spec §4). The admin documents answer for the whole whitelabel, or refuse an
 * agent outright (deposits, withdrawals), so none of them is asked for an agent. */

type EstimateClient = Pick<ApolloClient<unknown>, 'query'>

export interface ExportEstimateRequest {
  /** buildEstimateFilters: the type filters plus dateFrom/dateTo and an agent's agentId. */
  filters: Record<string, unknown>
  dateRange?: ExportDateRange
  isAgent: boolean
  agentId?: string
}



const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** A filter that is set to something other than "all". */
function chosen(value: unknown): string | undefined {
  const raw = text(value)
  return raw && raw !== 'all' ? raw : undefined
}



async function queryData<T>(
  client: EstimateClient,
  query: DocumentNode,
  options: { variables?: Record<string, unknown>; fetchPolicy: 'network-only' | 'cache-first' },
): Promise<T | undefined> {
  const result = await client.query<T>({ query, ...options })
  return (result.data as T | null | undefined) ?? undefined
}

/* What one row of an agent's export weighs, by type: the admin estimates' rough sizes. */
const AGENT_ROW_BYTES: Readonly<Record<string, number>> = {
  players: 200,
  'sports-bets': 150,
  'casino-bets': 150,
  'matka-bets': 150,
  deposits: 300,
  withdrawals: 300,
  subagents: 400,
  commission: 300,
  settlement: 300,
}

async function estimateAgentExport(
  client: EstimateClient,
  exportTypeId: string,
  filters: Record<string, unknown>,
): Promise<ExportEstimate> {
  const bytes = AGENT_ROW_BYTES[exportTypeId]
  if (bytes === undefined) return { rows: 0, size: formatEstimateSize(0) }
  try {
    const data = await queryData<{ agentExportRowCount?: number | null }>(client, AGENT_EXPORT_ROW_COUNT_QUERY, {
      variables: { reportType: exportTypeId, filtersJson: filters },
      fetchPolicy: 'network-only',
    })
    const rows = Math.max(0, Math.trunc(Number(data?.agentExportRowCount ?? 0)) || 0)
    return { rows, size: formatEstimateSize(rows * bytes) }
  } catch {
    return { rows: 0, size: formatEstimateSize(0) }
  }
}

export async function estimateExport(
  client: EstimateClient,
  exportTypeId: string,
  { filters, dateRange, isAgent }: ExportEstimateRequest,
): Promise<ExportEstimate> {
  if (isAgent) return estimateAgentExport(client, exportTypeId, filters)
  let estimatedRows = 0
  let estimatedSize = '0 KB'

  // Use actual queries to get real counts
  try {
    switch (exportTypeId) {
      case 'players': {
        // Use usersPage query to get actual player count
        const data = await queryData<{ usersPage?: { total?: number } }>(client, PLAYERS_COUNT_QUERY, {
          variables: {
            query: text(filters.query) || undefined,
            status: chosen(filters.status)?.toUpperCase(),
            offset: 0,
            limit: 1, // We only need the total count
          },
          fetchPolicy: 'network-only',
        })
        estimatedRows = data?.usersPage?.total || 0
        estimatedSize = formatEstimateSize(estimatedRows * 200) // ~200 bytes per player row
        break
      }

      case 'transactions': {
        // Estimate based on date range and player activity
        if (dateRange) {
          const days = wholeDaysBetween(dateRange.from, dateRange.to)
          // Get actual player count to estimate transactions
          try {
            const data = await queryData<{ usersPage?: { total?: number } }>(
              client,
              PLAYERS_FOR_TRANSACTION_ESTIMATE_QUERY,
              {
                variables: {
                  offset: 0,
                  limit: 1, // We only need total count
                },
                fetchPolicy: 'cache-first',
              },
            )
            const playerCount = data?.usersPage?.total || 0
            // Estimate: 2-5 transactions per active player per day
            const activePlayerEstimate = Math.floor(playerCount * 0.3) // Assume 30% active players
            estimatedRows = Math.max(0, activePlayerEstimate * days * 3) // 3 transactions per active player per day
            if (chosen(filters.type)) {
              estimatedRows = Math.floor(estimatedRows * 0.3) // Filter reduces count
            }
          } catch {
            estimatedRows = 0 // Cannot estimate without player count
          }
        } else {
          estimatedRows = 0 // Cannot estimate without date range
        }
        estimatedSize = formatEstimateSize(estimatedRows * 200)
        break
      }

      case 'sports-bets':
      case 'casino-bets':
      case 'matka-bets': {
        // Query actual bet counts from database
        if (dateRange) {
          try {
            const betQuery = exportTypeId === 'sports-bets'
              ? SPORTS_BETS_COUNT_QUERY
              : exportTypeId === 'casino-bets'
                ? CASINO_BETS_COUNT_QUERY
                : MATKA_BETS_COUNT_QUERY

            const betFilters: Record<string, string> = {}
            betFilters.dateFrom = dateRange.from
            betFilters.dateTo = dateRange.to
            const status = chosen(filters.status)
            if (status) {
              // Bet status enums are lowercase: matched, unmatched, cancelled, settled, won, lost, void (sports)
              // pending, active, won, lost, cancelled, void (casino/matka)
              betFilters.status = status.toLowerCase()
            }
            const sport = chosen(filters.sport)
            if (sport) betFilters.sport = sport
            const matkaType = chosen(filters.matkaType)
            if (matkaType) {
              // MatkaType enum values are lowercase: worli, starline, jackpot
              betFilters.matkaType = matkaType.toLowerCase()
            }

            const data = await queryData<{
              sportsBets?: unknown[]
              casinoBets?: unknown[]
              matkaBets?: unknown[]
            }>(client, betQuery, { variables: { query: betFilters }, fetchPolicy: 'network-only' })

            // Get count from array length (limited query). The backend has no COUNT query, so the
            // estimate is the number of bets the (limited) query returned.
            const betArray = data?.sportsBets || data?.casinoBets || data?.matkaBets || []
            estimatedRows = betArray.length > 0 ? betArray.length : 0
          } catch {
            // Fallback: cannot estimate without successful query
            estimatedRows = 0
          }
        } else {
          estimatedRows = 0 // No date range = cannot estimate
        }
        estimatedSize = formatEstimateSize(estimatedRows * 150)
        break
      }

      case 'agents': {
        // Query actual agent count using agentsPage query
        try {
          const data = await queryData<{ agents?: { agentsPage?: { total?: number } } }>(
            client,
            AGENTS_COUNT_QUERY,
            {
              variables: {
                query: text(filters.query) || undefined,
                schemeType: chosen(filters.schemeType)?.toUpperCase(),
                status: chosen(filters.status),
                offset: 0,
                limit: 1, // We only need total count
              },
              fetchPolicy: 'network-only',
            },
          )
          estimatedRows = data?.agents?.agentsPage?.total || 0
        } catch {
          estimatedRows = 0 // Return 0 if query fails
        }
        estimatedSize = formatEstimateSize(estimatedRows * 500)
        break
      }

      case 'subagents': {
        // Admins: agents with a parent. (An agent's own sub-agents are counted by the backend, above.)
        try {
          const data = await queryData<{
            agents?: { agentsPage?: { items?: Array<{ id: string; parentAgentId?: string | null }> } }
          }>(client, ALL_SUB_AGENTS_QUERY, {
            variables: {
              offset: 0,
              limit: 1000, // Get enough to count sub-agents
            },
            fetchPolicy: 'network-only',
          })
          // Count agents that have a parent (sub-agents)
          const agents = data?.agents?.agentsPage?.items || []
          estimatedRows = agents.filter((item) => item.parentAgentId).length
        } catch {
          estimatedRows = 0
        }
        estimatedSize = formatEstimateSize(estimatedRows * 400)
        break
      }

      case 'commission':
      case 'settlement': {
        // Estimate based on date range and actual agent count
        if (dateRange) {
          try {
            const data = await queryData<{ agents?: { agentsPage?: { total?: number } } }>(
              client,
              AGENTS_FOR_ESTIMATE_QUERY,
              {
                variables: {
                  offset: 0,
                  limit: 1, // We only need total count
                },
                fetchPolicy: 'cache-first',
              },
            )
            const agentCount = data?.agents?.agentsPage?.total || 0
            const days = wholeDaysBetween(dateRange.from, dateRange.to)
            if (exportTypeId === 'commission') {
              // Estimate: daily commission calculations for active agents
              const activeAgentEstimate = Math.floor(agentCount * 0.7) // 70% active agents
              estimatedRows = Math.max(0, activeAgentEstimate * days)
            } else {
              // Settlement: typically one per agent per settlement period (weekly/monthly)
              const settlementPeriods = Math.ceil(days / 7) // Weekly settlements
              estimatedRows = Math.max(0, agentCount * settlementPeriods)
            }
          } catch {
            estimatedRows = 0
          }
        } else {
          estimatedRows = 0 // Cannot estimate without date range
        }
        estimatedSize = formatEstimateSize(estimatedRows * 300)
        break
      }

      case 'ggr':
      case 'exposure':
      case 'pnl': {
        // These are aggregated reports - typically one row per day or per dimension
        if (dateRange) {
          const days = wholeDaysBetween(dateRange.from, dateRange.to)
          // Estimate: one row per day, or per domain if filtered
          estimatedRows = chosen(filters.domain)
            ? Math.max(0, days) // One row per day per domain
            : Math.max(0, days * 3) // One row per day per domain (sports, casino, matka)
        } else {
          estimatedRows = 0 // Cannot estimate without date range
        }
        estimatedSize = formatEstimateSize(estimatedRows * 400)
        break
      }

      case 'sports-kpis':
      case 'casino-kpis':
      case 'matka-kpis': {
        // KPI reports: typically aggregated data, one row per time period
        if (dateRange) {
          const days = wholeDaysBetween(dateRange.from, dateRange.to)
          // KPI reports usually have one row per day or per aggregation level
          estimatedRows = Math.max(0, days)
        } else {
          estimatedRows = 0 // Cannot estimate without date range
        }
        estimatedSize = formatEstimateSize(estimatedRows * 500)
        break
      }

      case 'agent-performance': {
        // Performance reports: one row per agent
        try {
          const data = await queryData<{ agents?: { agentsPage?: { total?: number } } }>(
            client,
            AGENTS_FOR_PERFORMANCE_QUERY,
            {
              variables: {
                offset: 0,
                limit: 1, // We only need total count
              },
              fetchPolicy: 'cache-first',
            },
          )
          estimatedRows = data?.agents?.agentsPage?.total || 0
        } catch {
          estimatedRows = 0
        }
        estimatedSize = formatEstimateSize(estimatedRows * 600)
        break
      }

      case 'bonus-campaigns': {
        // Query actual campaign count
        try {
          const data = await queryData<{ bonusCampaigns?: unknown[] }>(client, BONUS_CAMPAIGNS_COUNT_QUERY, {
            variables: {
              status: chosen(filters.status)?.toLowerCase(),
              domain: chosen(filters.domain)?.toLowerCase(),
            },
            fetchPolicy: 'network-only',
          })
          estimatedRows = data?.bonusCampaigns?.length || 0
        } catch {
          estimatedRows = 0
        }
        estimatedSize = formatEstimateSize(estimatedRows * 400)
        break
      }

      case 'audit-logs': {
        // Query actual audit log count
        if (dateRange) {
          try {
            const domain = chosen(filters.domain)
            const action = chosen(filters.action)
            const data = await queryData<{ audit?: unknown[] }>(client, AUDIT_LOGS_COUNT_QUERY, {
              variables: {
                domain,
                action,
                from: dateRange.from,
                to: dateRange.to,
                limit: 100, // Get sample to estimate
              },
              fetchPolicy: 'network-only',
            })
            // If we got results, estimate based on sample
            const auditArray = data?.audit || []
            if (auditArray.length > 0) {
              const days = wholeDaysBetween(dateRange.from, dateRange.to)
              // A full 100-row sample means there are likely more: ~50 logs per day.
              // Fewer than 100: use the actual count.
              estimatedRows = auditArray.length >= 100 ? Math.max(0, days * 50) : auditArray.length
              if (domain) {
                estimatedRows = Math.floor(estimatedRows * 0.3) // Domain filter reduces count
              }
              if (action) {
                estimatedRows = Math.floor(estimatedRows * 0.2) // Action filter further reduces
              }
            } else {
              estimatedRows = 0 // No audit logs found
            }
          } catch {
            estimatedRows = 0
          }
        } else {
          estimatedRows = 0 // Cannot estimate without date range
        }
        estimatedSize = formatEstimateSize(estimatedRows * 200)
        break
      }

      case 'deposits': {
        // Query actual deposit request count
        if (dateRange) {
          try {
            const data = await queryData<{ adminDepositRequests?: { total?: number } }>(
              client,
              DEPOSIT_REQUESTS_COUNT_QUERY,
              {
                variables: {
                  input: {
                    status: chosen(filters.status)?.toUpperCase(),
                    fromDate: dateRange.from,
                    toDate: dateRange.to,
                    offset: 0,
                    limit: 1, // We only need total count
                  },
                },
                fetchPolicy: 'network-only',
              },
            )
            estimatedRows = data?.adminDepositRequests?.total || 0
          } catch {
            estimatedRows = 0
          }
        } else {
          estimatedRows = 0 // Cannot estimate without date range
        }
        estimatedSize = formatEstimateSize(estimatedRows * 300)
        break
      }

      case 'withdrawals': {
        // Query actual withdrawal request count
        if (dateRange) {
          try {
            const data = await queryData<{ adminWithdrawalRequests?: { total?: number } }>(
              client,
              WITHDRAWAL_REQUESTS_COUNT_QUERY,
              {
                variables: {
                  input: {
                    status: chosen(filters.status)?.toUpperCase(),
                    fromDate: dateRange.from,
                    toDate: dateRange.to,
                    offset: 0,
                    limit: 1, // We only need total count
                  },
                },
                fetchPolicy: 'network-only',
              },
            )
            estimatedRows = data?.adminWithdrawalRequests?.total || 0
          } catch {
            estimatedRows = 0
          }
        } else {
          estimatedRows = 0 // Cannot estimate without date range
        }
        estimatedSize = formatEstimateSize(estimatedRows * 300)
        break
      }

      default:
        estimatedRows = 0
        estimatedSize = formatEstimateSize(0)
    }
  } catch {
    // Cannot estimate without successful query
    estimatedRows = 0
    estimatedSize = formatEstimateSize(0)
  }

  return { rows: estimatedRows, size: estimatedSize }
}
