import type ExcelJS from 'exceljs'
import { loadExcelWriter } from '@/shared/utils/lazyExcel'
import { formatInTimeZone, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'

type AgentItem = Record<string, any>

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
  { header: 'Credit Limit', key: 'creditLimit', width: 14 },
  { header: 'Credit Used', key: 'creditUsed', width: 14 },
  { header: 'Credit Available', key: 'creditAvailable', width: 16 },
  { header: 'Settlement', key: 'settlement', width: 14 },
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
  'creditLimit', 'creditUsed', 'creditAvailable', 'settlement',
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
  const titleRow = sheet.addRow([`Agents Export — ${totalCount.toLocaleString()} agents`])
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
      agent.creditLimit != null ? Number(agent.creditLimit) : null,
      agent.creditUsed != null ? Number(agent.creditUsed) : null,
      agent.creditAvailable != null ? Number(agent.creditAvailable) : null,
      agent.settlementBalance != null ? Number(agent.settlementBalance) : null,
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

      // P/L coloring
      if (key === 'pl' || key === 'ggr') {
        const val = typeof cell.value === 'number' ? cell.value : null
        if (val != null && val > 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.positiveFont } }
        else if (val != null && val < 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.negativeFont } }
      }

      // Credit used — amber
      if (key === 'creditUsed') {
        const val = typeof cell.value === 'number' ? cell.value : null
        if (val != null && val > 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.amberFont } }
      }

      // Credit available — green
      if (key === 'creditAvailable') {
        const val = typeof cell.value === 'number' ? cell.value : null
        if (val != null && val > 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.positiveFont } }
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
