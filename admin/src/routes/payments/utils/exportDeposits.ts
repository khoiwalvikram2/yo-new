import type ExcelJS from 'exceljs'
import { loadExcelWriter } from '@/shared/utils/lazyExcel'
import { formatInTimeZone, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import type { DepositRequest } from '../DepositRequests'
import { depositMethodLabel, depositRowMethodLabel, depositRowStatusLabel } from '../depositRequestsModel'

const COLORS = {
  titleBg: '4F46E5',
  titleFont: 'FFFFFF',
  subtitleFont: '6B7280',
  headerBg: '1F2937',
  headerFont: 'FFFFFF',
  altRowBg: 'F9FAFB',
  borderColor: 'E5E7EB',
  pendingBg: 'FFF7ED',
  pendingFont: 'C2410C',
  approvedBg: 'DCFCE7',
  approvedFont: '15803D',
  rejectedBg: 'FEE2E2',
  rejectedFont: 'B91C1C',
  cancelledBg: 'F3F4F6',
  cancelledFont: '6B7280',
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try { return formatInTimeZone(dateStr, 'dd MMM yyyy, HH:mm:ss', DEFAULT_ADMIN_TZ) } catch { return dateStr }
}

function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase()
}

function methodLabel(method: string): string {
  return depositMethodLabel(method)
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
  { header: 'ID', key: 'id', width: 10 },
  { header: 'Player Name', key: 'name', width: 20 },
  { header: 'Phone', key: 'phone', width: 15 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'Amount', key: 'amount', width: 14 },
  { header: 'Currency', key: 'currency', width: 10 },
  { header: 'Method', key: 'method', width: 14 },
  { header: 'UTR / Reference', key: 'utr', width: 22 },
  // Crypto deposits only (blank for the rest): the quote the player was given, and the bonus paid.
  { header: 'USDT Amount', key: 'cryptoAmount', width: 14 },
  { header: 'USDT Rate', key: 'cryptoRate', width: 12 },
  { header: 'Network', key: 'cryptoNetwork', width: 12 },
  { header: 'Crypto Bonus', key: 'cryptoBonusAmount', width: 14 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Note', key: 'note', width: 28 },
  { header: 'Reviewed At', key: 'reviewedAt', width: 22 },
  { header: 'Created At', key: 'createdAt', width: 22 },
]

const AMOUNT_COLS = new Set(['amount', 'cryptoAmount', 'cryptoRate', 'cryptoBonusAmount'])

export async function exportDepositsToExcel(requests: DepositRequest[], totalCount: number) {
  if (!requests.length) return

  const { Workbook, saveAs } = await loadExcelWriter()
  const workbook = new Workbook()
  workbook.creator = 'Admin Panel'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Deposit Requests', {
    views: [{ state: 'frozen', ySplit: 3 }],
  })

  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  // Title row
  const titleRow = sheet.addRow([`Deposit Requests Export — ${totalCount.toLocaleString()} requests`])
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
    cell.alignment = { vertical: 'middle', horizontal: AMOUNT_COLS.has(key) ? 'right' : 'left' }
    applyBorder(cell)
  })

  // Data rows
  requests.forEach((req, idx) => {
    const row = sheet.addRow([
      req.id,
      req.user?.name || '',
      req.user?.phone || '',
      req.user?.email || '',
      req.amount,
      req.currency || '',
      req.gateway ? depositRowMethodLabel(req) : methodLabel(req.method),
      req.utr || req.referenceId || '',
      req.cryptoAmount ?? '',
      req.cryptoRate ?? '',
      req.cryptoNetwork || '',
      req.cryptoBonusAmount ?? '',
      req.gateway ? depositRowStatusLabel(req) : statusLabel(req.status),
      req.note || '',
      fmtDate(req.reviewedAt),
      fmtDate(req.createdAt),
    ])
    row.height = 22
    const bg = idx % 2 === 0 ? 'FFFFFF' : COLORS.altRowBg

    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const key = COLUMNS[colNum - 1]?.key ?? ''
      cell.font = { name: 'Calibri', size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      cell.alignment = { vertical: 'middle', horizontal: AMOUNT_COLS.has(key) ? 'right' : 'left' }
      applyBorder(cell)

      if (key === 'amount') {
        cell.font = { name: 'Calibri', size: 10, bold: true }
        cell.numFmt = '#,##0.00'
      } else if (AMOUNT_COLS.has(key) && typeof cell.value === 'number') {
        cell.numFmt = '#,##0.00'
      }

      if (key === 'status') {
        const s = String(cell.value || '').toLowerCase()
        if (s === 'pending') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.pendingBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.pendingFont } }
        } else if (s === 'approved') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.approvedBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.approvedFont } }
        } else if (s === 'rejected') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.rejectedBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.rejectedFont } }
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.cancelledBg } }
          cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.cancelledFont } }
        }
      }

      if (key === 'method') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } }
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '4338CA' } }
      }
    })
  })

  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COLUMNS.length } }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const dateStr = formatInTimeZone(new Date(), 'yyyy-MM-dd_HHmm', DEFAULT_ADMIN_TZ)
  saveAs(blob, `Deposit-Requests_${dateStr}.xlsx`)
}
