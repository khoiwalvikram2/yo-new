import type ExcelJS from 'exceljs'
import { loadExcelWriter } from '@/shared/utils/lazyExcel'
import { formatInTimeZone, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import type { Player } from '@/shared/types/player'
import type { ChipAccount } from '@/lib/graphql/chips'

/** A list row; a credit player carries its chips account (spec 2026-11-02 §7). */
type PlayerWithStats = Player & { stats?: any; chips?: ChipAccount | null }

const isCreditRow = (p: PlayerWithStats) => p.playerType === 'AGENT_CREDIT' || p.playerType === 'WHITELABEL_CREDIT'

const COLORS = {
  titleBg: '4F46E5',
  titleFont: 'FFFFFF',
  subtitleFont: '6B7280',
  headerBg: '1F2937',
  headerFont: 'FFFFFF',
  altRowBg: 'F9FAFB',
  borderColor: 'E5E7EB',
  activeBg: 'DCFCE7',
  activeFont: '16A34A',
  suspendedBg: 'FEE2E2',
  suspendedFont: 'DC2626',
  inactiveBg: 'F3F4F6',
  inactiveFont: '6B7280',
  positiveFont: '059669',
  negativeFont: 'DC2626',
  purpleFont: '7C3AED',
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try {
    return formatInTimeZone(dateStr, 'dd MMM yyyy, HH:mm', DEFAULT_ADMIN_TZ)
  } catch {
    return dateStr
  }
}

function statusLabel(status: string | undefined): string {
  if (!status) return 'Inactive'
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()
}

function playerTypeLabel(playerType: string | undefined): string {
  const map: Record<string, string> = {
    REGULAR: 'Regular',
    AGENT_CREDIT: 'Agent Credit',
    WHITELABEL_CREDIT: 'WL Credit',
    SHARING_AGENT_PLAYER: 'Sharing',
    COMMISSION_AGENT_PLAYER: 'Commission',
  }
  return playerType ? (map[playerType] ?? playerType) : 'Regular'
}

function applyBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: COLORS.borderColor } },
    bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
    left: { style: 'thin', color: { argb: COLORS.borderColor } },
    right: { style: 'thin', color: { argb: COLORS.borderColor } },
  }
}

interface ColDef {
  header: string
  key: string
  width: number
  getter: (p: PlayerWithStats) => string | number | null
}

const COLUMNS: ColDef[] = [
  { header: 'Name', key: 'name', width: 20, getter: (p) => p.name || '' },
  { header: 'Username', key: 'username', width: 16, getter: (p) => p.username || '' },
  { header: 'Email', key: 'email', width: 26, getter: (p) => p.email || '' },
  { header: 'Phone', key: 'phone', width: 15, getter: (p) => p.phone || '' },
  { header: 'Status', key: 'status', width: 12, getter: (p) => statusLabel(p.status) },
  { header: 'Player Type', key: 'playerType', width: 16, getter: (p) => playerTypeLabel(p.playerType) },
  { header: 'Agent', key: 'agent', width: 16, getter: (p) => (p as any).parentAgent?.username || '' },
  { header: 'VIP Tier', key: 'vip', width: 14, getter: (p) => (p as any).vipTierName || '' },
  { header: 'Balance', key: 'balance', width: 14, getter: (p) => p.wallet?.balance != null ? Number(p.wallet.balance) : null },
  { header: 'Bonus', key: 'bonus', width: 14, getter: (p) => p.wallet?.bonus != null ? Number(p.wallet.bonus) : null },
  { header: 'Exposure', key: 'exposure', width: 14, getter: (p) => p.wallet?.exposure != null ? Number(p.wallet.exposure) : null },
  // Credit players are on chips: their Balance and Exposure above are their chips; these two are theirs only.
  { header: 'Credit Reference', key: 'creditReference', width: 16, getter: (p) => !isCreditRow(p) ? null : p.chips ? Number(p.chips.creditReference) : p.creditLimit != null ? Number(p.creditLimit) : null },
  { header: 'Ref P/L', key: 'refPnl', width: 14, getter: (p) => isCreditRow(p) && p.chips ? Number(p.chips.refPnl) : null },
  { header: 'Total Deposits', key: 'deposits', width: 16, getter: (p) => p.stats?.totalDeposits != null ? Number(p.stats.totalDeposits) : null },
  { header: 'Total Withdrawals', key: 'withdrawals', width: 18, getter: (p) => p.stats?.totalWithdrawals != null ? Number(p.stats.totalWithdrawals) : null },
  { header: 'GGR', key: 'ggr', width: 14, getter: (p) => p.stats?.ggr != null ? Number(p.stats.ggr) : null },
  { header: 'P/L', key: 'pl', width: 14, getter: (p) => p.stats?.profitLoss != null ? Number(p.stats.profitLoss) : null },
  { header: 'Bets', key: 'betCount', width: 10, getter: (p) => p.stats?.betCount != null ? Number(p.stats.betCount) : null },
  { header: 'Turnover', key: 'turnover', width: 14, getter: (p) => p.stats?.turnover != null ? Number(p.stats.turnover) : null },
  { header: 'Commission Earned', key: 'commission', width: 18, getter: (p) => p.stats?.commissionEarned != null ? Number(p.stats.commissionEarned) : null },
  { header: 'Last Activity', key: 'lastActivity', width: 22, getter: (p) => fmtDate(p.stats?.lastActivityAt ?? p.stats?.lastLogin) },
  { header: 'Last Bet', key: 'lastBet', width: 22, getter: (p) => fmtDate(p.stats?.lastBetAt) },
]

// Columns that contain numeric amounts (for right-align)
const AMOUNT_COL_KEYS = new Set([
  'balance', 'bonus', 'exposure', 'creditReference', 'refPnl',
  'deposits', 'withdrawals', 'ggr', 'pl', 'betCount', 'turnover', 'commission',
])

export async function exportPlayerListToExcel(players: PlayerWithStats[], totalCount: number) {
  if (!players || players.length === 0) return

  const { Workbook, saveAs } = await loadExcelWriter()
  const workbook = new Workbook()
  workbook.creator = 'Admin Panel'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Players', {
    views: [{ state: 'frozen', ySplit: 3 }],
  })

  sheet.columns = COLUMNS.map((col) => ({ key: col.key, width: col.width }))

  // Row 1: Title
  const titleRow = sheet.addRow([`Players Export — ${totalCount.toLocaleString()} players`])
  sheet.mergeCells(1, 1, 1, COLUMNS.length)
  const titleCell = titleRow.getCell(1)
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: COLORS.titleFont } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.titleBg } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' }
  titleRow.height = 36

  // Row 2: Subtitle
  const now = formatInTimeZone(new Date(), 'dd MMM yyyy, HH:mm:ss', DEFAULT_ADMIN_TZ)
  const subtitleRow = sheet.addRow([`Exported on ${now} (IST)`])
  sheet.mergeCells(2, 1, 2, COLUMNS.length)
  const subtitleCell = subtitleRow.getCell(1)
  subtitleCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: COLORS.subtitleFont } }
  subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' }
  subtitleRow.height = 22

  // Row 3: Header
  const headerRow = sheet.addRow(COLUMNS.map((c) => c.header))
  headerRow.height = 28
  headerRow.eachCell((cell, colNumber) => {
    const key = COLUMNS[colNumber - 1]?.key ?? ''
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.headerFont } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } }
    cell.alignment = { vertical: 'middle', horizontal: AMOUNT_COL_KEYS.has(key) ? 'right' : 'left' }
    applyBorder(cell)
  })

  // Data rows
  players.forEach((player, idx) => {
    const values = COLUMNS.map((col) => col.getter(player))
    const row = sheet.addRow(values)
    row.height = 22
    const bgColor = idx % 2 === 0 ? 'FFFFFF' : COLORS.altRowBg

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = COLUMNS[colNumber - 1]?.key ?? ''
      const isAmount = AMOUNT_COL_KEYS.has(key)

      cell.font = { name: 'Calibri', size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
      cell.alignment = { vertical: 'middle', horizontal: isAmount ? 'right' : 'left' }
      applyBorder(cell)

      // Status column coloring
      if (key === 'status') {
        const val = String(cell.value || '').toLowerCase()
        if (val === 'active') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.activeBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.activeFont } }
        } else if (val === 'suspended') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.suspendedBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.suspendedFont } }
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.inactiveBg } }
          cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.inactiveFont } }
        }
      }

      // P/L coloring
      if (key === 'pl') {
        const val = typeof cell.value === 'number' ? cell.value : null
        if (val != null && val > 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.positiveFont } }
        else if (val != null && val < 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.negativeFont } }
      }

      // GGR coloring
      if (key === 'ggr') {
        const val = typeof cell.value === 'number' ? cell.value : null
        if (val != null && val > 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.positiveFont } }
        else if (val != null && val < 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.negativeFont } }
      }

      // Ref P/L — green when the upline owes the player, red when the player owes the upline
      if (key === 'refPnl') {
        const val = typeof cell.value === 'number' ? cell.value : null
        if (val != null && val > 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.positiveFont } }
        else if (val != null && val < 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.negativeFont } }
      }

      // Commission — purple
      if (key === 'commission') {
        const val = typeof cell.value === 'number' ? cell.value : null
        if (val != null && val > 0) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.purpleFont } }
      }

      // Balance — bold
      if (key === 'balance') {
        cell.font = { name: 'Calibri', size: 10, bold: true }
      }

      // VIP tier — gold highlight
      if (key === 'vip' && cell.value) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } }
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'D97706' } }
      }
    })
  })

  // Auto-filter on header row
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: COLUMNS.length },
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const dateStr = formatInTimeZone(new Date(), 'yyyy-MM-dd_HHmm', DEFAULT_ADMIN_TZ)
  saveAs(blob, `Players_${dateStr}.xlsx`)
}
