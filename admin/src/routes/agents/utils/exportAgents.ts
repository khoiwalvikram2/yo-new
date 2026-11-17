import type ExcelJS from 'exceljs'
import type { ApolloClient } from '@apollo/client'
import { loadExcelWriter } from '@/shared/utils/lazyExcel'
import { formatInTimeZone, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import { AGENTS_PAGE_QUERY, AGENTS_STATS_QUERY } from '@/lib/graphql/agents'
import { AGENTS_CHIPS_QUERY, chipsById, type AgentsChipsData } from '../components/agentChips'
import type { AgentListRow, AgentsPageData } from '../components/agentsSearchModel'

type AgentItem = Record<string, any>

/** Agents read per request while an export gathers them: the stats read is the heavy one, so it goes page by page. */
export const AGENT_EXPORT_PAGE_SIZE = 100

/** The agents list's filters: its query variables without the page. */
export interface AgentExportFilters { query?: string; schemeType?: string; status?: string; parentAgentId?: string; directOnly?: boolean }

/**
 * Every agent the list's filters match, not only the page on screen, with the stats (and, for the CREDIT list,
 * the chips) its rows show. The list reads one page at a time; exporting that page under the filter's total
 * ("64 agents" over 10 rows) dropped the rest without a word.
 */
export async function loadAgentsForExport(
  client: Pick<ApolloClient<unknown>, 'query'>,
  filters: AgentExportFilters,
  options: { total: number; withChips: boolean },
): Promise<AgentListRow[]> {
  const rows: AgentListRow[] = []
  for (let offset = 0; offset < options.total; offset += AGENT_EXPORT_PAGE_SIZE) {
    const variables = { ...filters, offset, limit: AGENT_EXPORT_PAGE_SIZE }
    const [list, stats, chips] = await Promise.all([
      client.query<AgentsPageData>({ query: AGENTS_PAGE_QUERY, variables, fetchPolicy: 'network-only' }),
      client.query<AgentsPageData>({ query: AGENTS_STATS_QUERY, variables, fetchPolicy: 'network-only' }),
      options.withChips ? client.query<AgentsChipsData>({ query: AGENTS_CHIPS_QUERY, variables, fetchPolicy: 'no-cache' }) : null,
    ])
    const items = list.data?.agents?.agentsPage?.items ?? []
    const statsById = new Map((stats.data?.agents?.agentsPage?.itemsWithStats ?? []).map((entry) => [entry.agent.id, entry.stats]))
    const chipsByAgent = chipsById(chips?.data?.agents?.agentsPage?.items)
    for (const item of items) rows.push({ ...item, stats: statsById.get(item.id) ?? null, chips: chipsByAgent.get(item.id) ?? null })
    if (items.length < AGENT_EXPORT_PAGE_SIZE) break
  }
  return rows
}

/** The sheet's title: the filter's total, or "N of total" when fewer rows came back (the list changed meanwhile). */
export function agentsExportTitle(count: number, totalCount: number): string {
  const total = Math.max(totalCount, count)
  return count === total ? `Agents Export — ${total.toLocaleString()} agents` : `Agents Export — ${count.toLocaleString()} of ${total.toLocaleString()} agents`
}

const COLORS = {
  titleBg: '4F46E5',
  titleFont: 'FFFFFF',
  subtitleFont: '6B7280',
  headerBg: '1F2937',
  headerFont: 'FFFFFF',
  altRowBg: 'F9FAFB',
  borderColor: 'E5E7EB',
  activeBg: 'DCFCE7',
  activeFont: '15803D',
  suspendedBg: 'FEE2E2',
  suspendedFont: 'B91C1C',
  inactiveBg: 'F3F4F6',
  inactiveFont: '6B7280',
  sharingBg: 'DBEAFE',
  sharingFont: '1D4ED8',
  creditBg: 'D1FAE5',
  creditFont: '047857',
  commissionBg: 'EDE9FE',
  commissionFont: '6D28D9',
  positiveFont: '059669',
  negativeFont: 'DC2626',
  amberFont: 'D97706',
  purpleFont: '7C3AED',
}

const levelNames: Record<number, string> = {
  1: 'Super',
  2: 'Master',
  3: 'Agent',
  4: 'Sub-Agent',
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try { return formatInTimeZone(dateStr, 'dd MMM yyyy, HH:mm', DEFAULT_ADMIN_TZ) } catch { return dateStr }
}

function statusLabel(status: string | undefined): string {
  if (!status) return ''
  return status.charAt(0) + status.slice(1).toLowerCase()
}

function getRates(rates: Array<{ domain: string; rate: number }> | null | undefined): string {
  if (!rates || rates.length === 0) return ''
  return rates.map((r) => `${r.domain}: ${(r.rate * 100).toFixed(1)}%`).join(', ')
}

function applyBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: COLORS.borderColor } },
    bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
    left: { style: 'thin', color: { argb: COLORS.borderColor } },
    right: { style: 'thin', color: { argb: COLORS.borderColor } },
  }
}

const COLUMNS = [
  { header: 'Username', key: 'username', width: 18 },
  { header: 'Phone', key: 'phone', width: 15 },
  { header: 'Scheme Type', key: 'schemeType', width: 14 },
  { header: 'Level', key: 'level', width: 14 },
  { header: 'Parent Agent', key: 'parentAgent', width: 16 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Allowed Domains', key: 'domains', width: 20 },
  { header: 'Commission Rates', key: 'commissionRates', width: 28 },
  { header: 'Sharing Rates', key: 'sharingRates', width: 28 },
  // A CREDIT agent's chips (spec 2026-11-02 §2), from the list's chips read; empty for the other schemes. The
  // old Settlement column (the retired settlement balance) is gone: Pending Settlement below covers SHARING.
  { header: 'Credit Reference', key: 'creditReference', width: 16 },
  { header: 'Chip Balance', key: 'chipBalance', width: 14 },
  { header: 'Downline Balance', key: 'downlineBalance', width: 16 },
  { header: 'Ref P/L', key: 'refPnl', width: 14 },
  { header: 'Active Players', key: 'activePlayers', width: 14 },
  { header: 'Total Deposits', key: 'deposits', width: 16 },
  { header: 'Total Withdrawals', key: 'withdrawals', width: 18 },
  { header: 'GGR', key: 'ggr', width: 14 },
  { header: 'P/L', key: 'pl', width: 14 },
  { header: 'Turnover', key: 'turnover', width: 14 },
  { header: 'Commission Earned', key: 'commissionEarned', width: 18 },
  { header: 'Pending Settlement', key: 'pendingSettlement', width: 18 },
  { header: 'Total Settled', key: 'totalSettled', width: 16 },
  { header: 'Bet Count', key: 'betCount', width: 12 },
  { header: 'Last Login', key: 'lastLogin', width: 22 },
  { header: 'Created At', key: 'createdAt', width: 22 },
]

const AMOUNT_COLS = new Set([
  'creditReference', 'chipBalance', 'downlineBalance', 'refPnl',
  'deposits', 'withdrawals', 'ggr', 'pl', 'turnover',
  'commissionEarned', 'pendingSettlement', 'totalSettled',
])

const NUM_COLS = new Set(['activePlayers', 'betCount'])

export async function exportAgentsToExcel(agents: AgentItem[], totalCount: number) {
  if (!agents.length) return

  const { Workbook, saveAs } = await loadExcelWriter()
  const workbook = new Workbook()
  workbook.creator = 'Admin Panel'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Agents', {
    views: [{ state: 'frozen', ySplit: 3 }],
  })

  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  // Title row
  const titleRow = sheet.addRow([agentsExportTitle(agents.length, totalCount)])
  sheet.mergeCells(1, 1, 1, COLUMNS.length)
  const tc = titleRow.getCell(1)
  tc.font = { name: 'Calibri', size: 14, bold: true, color: { argb: COLORS.titleFont } }
  tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.titleBg } }
  tc.alignment = { vertical: 'middle', horizontal: 'center' }
  titleRow.height = 36

  // Subtitle row
  const now = formatInTimeZone(new Date(), 'dd MMM yyyy, HH:mm:ss', DEFAULT_ADMIN_TZ)
  const subRow = sheet.addRow([`Exported on ${now} (IST)`])
  sheet.mergeCells(2, 1, 2, COLUMNS.length)
  const sc = subRow.getCell(1)
  sc.font = { name: 'Calibri', size: 10, italic: true, color: { argb: COLORS.subtitleFont } }
  sc.alignment = { vertical: 'middle', horizontal: 'center' }
  subRow.height = 22

  // Header row
  const headerRow = sheet.addRow(COLUMNS.map((c) => c.header))
  headerRow.height = 28
  headerRow.eachCell((cell, colNum) => {
    const key = COLUMNS[colNum - 1]?.key ?? ''
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.headerFont } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } }
    cell.alignment = {
      vertical: 'middle',
      horizontal: AMOUNT_COLS.has(key) || NUM_COLS.has(key) ? 'right' : 'left',
    }
    applyBorder(cell)
  })

  // Data rows
  agents.forEach((agent, idx) => {
    const stats = agent.stats || {}
    const chips = agent.chips || null
    const chipFigure = (value: unknown) => chips && value != null ? Number(value) : null
    const row = sheet.addRow([
      agent.username || '',
      agent.phone || '',
      agent.schemeType || '',
      agent.levelIndex != null ? (levelNames[agent.levelIndex] || `Level ${agent.levelIndex}`) : '',
      agent.parentAgent?.username || '',
      statusLabel(agent.status),
      Array.isArray(agent.allowedDomains) ? agent.allowedDomains.join(', ') : '',
      getRates(agent.commissionRates),
      getRates(agent.sharingRates),
      chipFigure(chips?.creditReference),
      chipFigure(chips?.balance),
      chipFigure(chips?.downlineBalance),
      chipFigure(chips?.refPnl),
      stats.activePlayers != null ? Number(stats.activePlayers) : null,
      stats.totalDeposits != null ? Number(stats.totalDeposits) : null,
      stats.totalWithdrawals != null ? Number(stats.totalWithdrawals) : null,
      stats.ggr != null ? Number(stats.ggr) : null,
      stats.profitLoss != null ? Number(stats.profitLoss) : null,
      stats.turnover != null ? Number(stats.turnover) : null,
      stats.commissionEarned != null ? Number(stats.commissionEarned) : null,
      stats.pendingSettlement != null ? Number(stats.pendingSettlement) : null,
      stats.totalSettled != null ? Number(stats.totalSettled) : null,
      stats.betCount != null ? Number(stats.betCount) : null,
      fmtDate(stats.lastLogin),
      fmtDate(agent.createdAt),
    ])
    row.height = 22
    const bg = idx % 2 === 0 ? 'FFFFFF' : COLORS.altRowBg

    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const key = COLUMNS[colNum - 1]?.key ?? ''
      const isRight = AMOUNT_COLS.has(key) || NUM_COLS.has(key)
      cell.font = { name: 'Calibri', size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      cell.alignment = { vertical: 'middle', horizontal: isRight ? 'right' : 'left' }
      applyBorder(cell)

      // Scheme type coloring
      if (key === 'schemeType') {
        const s = String(cell.value || '').toUpperCase()
        if (s === 'SHARING') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.sharingBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.sharingFont } }
        } else if (s === 'CREDIT') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.creditBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.creditFont } }
        } else if (s === 'COMMISSION') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.commissionBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.commissionFont } }
        }
      }

      // Status coloring
      if (key === 'status') {
        const s = String(cell.value || '').toLowerCase()
        if (s === 'active') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.activeBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.activeFont } }
        } else if (s === 'suspended') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.suspendedBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.suspendedFont } }
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.inactiveBg } }
          cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.inactiveFont } }
        }
      }

      // P/L and Ref P/L coloring (Ref P/L > 0: the upline owes the agent; < 0: the agent owes the upline)
      if (key === 'pl' || key === 'ggr' || key === 'refPnl') {
        const val = typeof cell.value === 'number' ? cell.value : null
        if (val != null && val > 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.positiveFont } }
        else if (val != null && val < 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.negativeFont } }
      }

      // Commission earned — purple
      if (key === 'commissionEarned') {
        const val = typeof cell.value === 'number' ? cell.value : null
        if (val != null && val > 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.purpleFont } }
      }

      // Pending settlement — amber if non-zero
      if (key === 'pendingSettlement') {
        const val = typeof cell.value === 'number' ? cell.value : null
        if (val != null && val !== 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.amberFont } }
      }

      // Amount formatting
      if (AMOUNT_COLS.has(key) && typeof cell.value === 'number') {
        cell.numFmt = '#,##0.00'
      }
    })
  })

  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COLUMNS.length } }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const dateStr = formatInTimeZone(new Date(), 'yyyy-MM-dd_HHmm', DEFAULT_ADMIN_TZ)
  saveAs(blob, `Agents_${dateStr}.xlsx`)
}
