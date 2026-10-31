import type ExcelJS from 'exceljs'
import { loadExcelWriter } from '@/shared/utils/lazyExcel'
import { formatInTimeZone, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import type { WithdrawalRequest } from '../components/WithdrawalRequestsTable'

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
  processingBg: 'EFF6FF',
  processingFont: '1D4ED8',
  completedBg: 'DCFCE7',
  completedFont: '15803D',
  failedBg: 'FEE2E2',
  failedFont: 'B91C1C',
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
  { header: 'Account Holder', key: 'accountHolder', width: 22 },
  { header: 'Account Number', key: 'accountNumber', width: 20 },
  { header: 'IFSC Code', key: 'ifsc', width: 14 },
  { header: 'Bank Name', key: 'bankName', width: 20 },
  { header: 'Method', key: 'method', width: 10 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Note', key: 'note', width: 28 },
  { header: 'Reviewed At', key: 'reviewedAt', width: 22 },
  { header: 'Created At', key: 'createdAt', width: 22 },
]

const AMOUNT_COLS = new Set(['amount'])

export async function exportWithdrawalsToExcel(requests: WithdrawalRequest[], totalCount: number) {
  if (!requests.length) return

  const { Workbook, saveAs } = await loadExcelWriter()
  const workbook = new Workbook()
  workbook.creator = 'Admin Panel'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Withdrawal Requests', {
    views: [{ state: 'frozen', ySplit: 3 }],
  })

  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  // Title row
  const titleRow = sheet.addRow([`Withdrawal Requests Export — ${totalCount.toLocaleString()} requests`])
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
      req.account?.accountHolderName || '',
      req.account?.accountNumber || '',
      req.account?.ifscCode || '',
      req.account?.bankName || '',
      req.account?.method || '',
      statusLabel(req.status),
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
      }

      if (key === 'status') {
        const s = String(cell.value || '').toLowerCase()
        if (s === 'pending') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.pendingBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.pendingFont } }
        } else if (s === 'processing') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.processingBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.processingFont } }
        } else if (s === 'completed') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.completedBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.completedFont } }
        } else if (s === 'failed') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.failedBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.failedFont } }
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.cancelledBg } }
          cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.cancelledFont } }
        }
      }

      if (key === 'method') {
        const m = String(cell.value || '').toUpperCase()
        if (m === 'UPI') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '4338CA' } }
        } else if (m === 'BANK') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'ECFDF5' } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '065F46' } }
        }
      }
    })
  })

  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COLUMNS.length } }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const dateStr = formatInTimeZone(new Date(), 'yyyy-MM-dd_HHmm', DEFAULT_ADMIN_TZ)
  saveAs(blob, `Withdrawal-Requests_${dateStr}.xlsx`)
}
