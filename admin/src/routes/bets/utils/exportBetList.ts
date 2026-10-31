import type ExcelJS from 'exceljs'
import { loadExcelWriter } from '@/shared/utils/lazyExcel'
import { formatInTimeZone, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'

type BetItemAny = Record<string, any>

interface ExportColumn {
  header: string
  key: string
  width: number
  getter: (row: BetItemAny) => string | number | null
  numFmt?: string
}

const COLORS = {
  headerBg: '1F2937',
  headerFont: 'FFFFFF',
  sportsBg: 'ECFDF5',
  sportsBorder: '6EE7B7',
  casinoBg: 'FFFBEB',
  casinoBorder: 'FCD34D',
  matkaBg: 'F5F3FF',
  matkaBorder: 'C4B5FD',
  wonFont: '16A34A',
  lostFont: 'DC2626',
  voidFont: '6B7280',
  positiveFont: '059669',
  negativeFont: 'DC2626',
  altRowBg: 'F9FAFB',
  borderColor: 'E5E7EB',
  titleBg: '4F46E5',
  titleFont: 'FFFFFF',
  subtitleFont: '6B7280',
}

function walletLabel(walletType?: string | null): string {
  if (!walletType) return 'Cash'
  const w = String(walletType).toLowerCase()
  if (w === 'bonus') return 'Bonus'
  if (w === 'referralbonus' || w === 'referral_bonus') return 'Referral'
  return 'Cash'
}

function statusText(status: string): string {
  const s = String(status).toLowerCase()
  if (s === 'matched') return 'Open'
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()
}

function domainLabel(typename: string): string {
  if (typename === 'SportsBet') return 'Sports'
  if (typename === 'CasinoBet') return 'Casino'
  if (typename === 'MatkaBet') return 'Matka'
  return typename
}

function fmtAmount(value: number | null | undefined): string {
  if (value == null) return ''
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(dateStr: string): string {
  try {
    return formatInTimeZone(dateStr, 'dd MMM yyyy HH:mm:ss', DEFAULT_ADMIN_TZ)
  } catch {
    return dateStr || ''
  }
}

function getStake(row: BetItemAny): number | null {
  if (row.__typename === 'MatkaBet') return row.betAmount ?? null
  return row.stake ?? null
}

function getPL(row: BetItemAny): number | null {
  if (row.__typename === 'SportsBet') return row.pl ?? null
  if (row.__typename === 'CasinoBet') return row.netAmount ?? null
  if (row.__typename === 'MatkaBet') {
    const s = String(row.status).toLowerCase()
    if (s === 'void' || s === 'cancelled') return 0
    if (row.actualWin != null) return Number(row.actualWin) - Number(row.betAmount)
  }
  return null
}

function getOdds(row: BetItemAny): string {
  if (row.__typename === 'SportsBet') {
    if (row.price == null) return ''
    if (row.oddsSize != null) return `${Number(row.oddsSize).toFixed(0)} / ${Number(row.price).toFixed(2)}`
    return Number(row.price).toFixed(2)
  }
  if (row.__typename === 'MatkaBet') {
    if (row.payoutMultiplier != null) return `${Number(row.payoutMultiplier).toFixed(1)}x`
  }
  return ''
}

function getLiability(row: BetItemAny): string {
  if (row.__typename === 'SportsBet') return fmtAmount(row.liability)
  if (row.__typename === 'CasinoBet') return fmtAmount(row.payout)
  if (row.__typename === 'MatkaBet') return fmtAmount(row.potentialWin)
  return ''
}

function getEventGame(row: BetItemAny): string {
  if (row.__typename === 'SportsBet') {
    return [row.sportName, row.leagueName, row.eventName].filter(Boolean).join(' > ')
  }
  if (row.__typename === 'CasinoBet') return row.gameName || ''
  if (row.__typename === 'MatkaBet') {
    const parts = [row.marketName]
    if (row.matkaType) parts.push(`(${row.matkaType})`)
    return parts.join(' ')
  }
  return ''
}

function getMarketVendor(row: BetItemAny): string {
  if (row.__typename === 'SportsBet') return row.marketName || ''
  if (row.__typename === 'CasinoBet') return row.vendorName || ''
  if (row.__typename === 'MatkaBet') return row.bidType || ''
  return ''
}

function getSelection(row: BetItemAny): string {
  if (row.__typename === 'SportsBet') return row.selectionName || ''
  if (row.__typename === 'MatkaBet') return row.betNumbers || ''
  return ''
}

function getType(row: BetItemAny): string {
  if (row.__typename === 'SportsBet') return row.side || ''
  return ''
}

function getResult(row: BetItemAny): string {
  const s = String(row.status).toLowerCase()
  if (row.__typename === 'SportsBet') {
    const parts: string[] = []
    if (row.eventResult) parts.push(row.eventResult)
    if (s === 'won') parts.push('Won')
    else if (s === 'lost') parts.push('Lost')
    else if (s === 'void') parts.push('Void')
    else if (s === 'cancelled') parts.push('Cancelled')
    return parts.join(' - ')
  }
  if (row.__typename === 'MatkaBet' && row.result) return row.result
  if (s === 'won') return 'Won'
  if (s === 'lost') return 'Lost'
  if (s === 'void') return 'Void'
  if (s === 'cancelled') return 'Cancelled'
  return ''
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Date & Time', key: 'time', width: 22, getter: (r) => fmtDate(r.createdAt) },
  { header: 'Domain', key: 'domain', width: 10, getter: (r) => domainLabel(r.__typename) },
  { header: 'Player Name', key: 'name', width: 18, getter: (r) => r.userName || r.userId || '' },
  { header: 'Phone', key: 'phone', width: 15, getter: (r) => r.userPhone || '' },
  { header: 'Wallet', key: 'wallet', width: 10, getter: (r) => walletLabel(r.walletType) },
  { header: 'Event / Game', key: 'event', width: 35, getter: (r) => getEventGame(r) },
  { header: 'Market / Vendor', key: 'market', width: 20, getter: (r) => getMarketVendor(r) },
  { header: 'Selection / Numbers', key: 'selection', width: 18, getter: (r) => getSelection(r) },
  { header: 'Type', key: 'type', width: 8, getter: (r) => getType(r) },
  { header: 'Stake', key: 'stake', width: 14, getter: (r) => getStake(r), numFmt: '#,##0.00' },
  { header: 'Odds', key: 'odds', width: 12, getter: (r) => getOdds(r) },
  { header: 'Liability / Payout', key: 'liability', width: 16, getter: (r) => getLiability(r) },
  { header: 'P/L', key: 'pl', width: 14, getter: (r) => getPL(r), numFmt: '#,##0.00' },
  { header: 'Result', key: 'result', width: 14, getter: (r) => getResult(r) },
  { header: 'Status', key: 'status', width: 12, getter: (r) => statusText(r.status) },
  { header: 'Campaign', key: 'campaign', width: 16, getter: (r) => r.campaign?.name || '' },
]

function applyBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: COLORS.borderColor } },
    bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
    left: { style: 'thin', color: { argb: COLORS.borderColor } },
    right: { style: 'thin', color: { argb: COLORS.borderColor } },
  }
}

function domainBgColor(typename: string): string {
  if (typename === 'SportsBet') return COLORS.sportsBg
  if (typename === 'CasinoBet') return COLORS.casinoBg
  return COLORS.matkaBg
}

export async function exportBetListToExcel(items: BetItemAny[], totalCount: number) {
  if (!items || items.length === 0) return

  const { Workbook, saveAs } = await loadExcelWriter()
  const workbook = new Workbook()
  workbook.creator = 'Admin Panel'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Bet List', {
    views: [{ state: 'frozen', ySplit: 3 }],
  })

  sheet.columns = EXPORT_COLUMNS.map((col) => ({
    key: col.key,
    width: col.width,
  }))

  // Row 1: Title
  const titleRow = sheet.addRow([`Bet List Export — ${totalCount.toLocaleString()} bets`])
  sheet.mergeCells(1, 1, 1, EXPORT_COLUMNS.length)
  const titleCell = titleRow.getCell(1)
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: COLORS.titleFont } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.titleBg } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' }
  titleRow.height = 36

  // Row 2: Subtitle with export timestamp
  const now = formatInTimeZone(new Date(), 'dd MMM yyyy, HH:mm:ss', DEFAULT_ADMIN_TZ)
  const subtitleRow = sheet.addRow([`Exported on ${now} (IST)`])
  sheet.mergeCells(2, 1, 2, EXPORT_COLUMNS.length)
  const subtitleCell = subtitleRow.getCell(1)
  subtitleCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: COLORS.subtitleFont } }
  subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' }
  subtitleRow.height = 22

  // Row 3: Header row
  const headerRow = sheet.addRow(EXPORT_COLUMNS.map((c) => c.header))
  headerRow.height = 28
  headerRow.eachCell((cell, colNumber) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.headerFont } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } }
    cell.alignment = { vertical: 'middle', horizontal: colNumber >= 10 && colNumber <= 13 ? 'right' : 'left' }
    applyBorder(cell)
  })

  // Data rows
  items.forEach((item, idx) => {
    const values = EXPORT_COLUMNS.map((col) => col.getter(item))
    const row = sheet.addRow(values)
    row.height = 22

    const bgColor = idx % 2 === 0 ? 'FFFFFF' : COLORS.altRowBg
    const typename = item.__typename

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
      cell.alignment = { vertical: 'middle', horizontal: colNumber >= 10 && colNumber <= 13 ? 'right' : 'left' }
      applyBorder(cell)

      // Domain column coloring
      if (colNumber === 2) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: domainBgColor(typename) } }
        cell.font = { name: 'Calibri', size: 10, bold: true }
      }

      // Stake column — bold
      if (colNumber === 10) {
        cell.font = { name: 'Calibri', size: 10, bold: true }
      }

      // P/L column coloring
      if (colNumber === 13) {
        const pl = getPL(item)
        if (pl != null && pl > 0) {
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.positiveFont } }
        } else if (pl != null && pl < 0) {
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.negativeFont } }
        }
      }

      // Result column coloring
      if (colNumber === 14) {
        const result = String(cell.value || '').toLowerCase()
        if (result.includes('won')) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.wonFont } }
        else if (result.includes('lost')) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.lostFont } }
        else if (result.includes('void') || result.includes('cancelled')) cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.voidFont } }
      }

      // Status column coloring
      if (colNumber === 15) {
        const status = String(cell.value || '').toLowerCase()
        if (status === 'open' || status === 'matched') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DBEAFE' } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '2563EB' } }
        } else if (status === 'won') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DCFCE7' } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.wonFont } }
        } else if (status === 'lost') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.lostFont } }
        } else if (status === 'void' || status === 'cancelled') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } }
          cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.voidFont } }
        } else if (status === 'settled') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'D97706' } }
        }
      }

      // Type (Back/Lay) column coloring
      if (colNumber === 9) {
        const side = String(cell.value || '').toLowerCase()
        if (side === 'back') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DBEAFE' } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '2563EB' } }
        } else if (side === 'lay') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7ED' } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'EA580C' } }
        }
      }

      // Wallet column
      if (colNumber === 5) {
        const wl = String(cell.value || '').toLowerCase()
        if (wl === 'bonus' || wl === 'referral') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'D97706' } }
        }
      }
    })
  })

  // Auto-filter on header row
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: EXPORT_COLUMNS.length },
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const dateStr = formatInTimeZone(new Date(), 'yyyy-MM-dd_HHmm', DEFAULT_ADMIN_TZ)
  saveAs(blob, `Bet-List_${dateStr}.xlsx`)
}
