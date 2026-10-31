import type ExcelJS from 'exceljs'
import { loadExcelWriter } from '@/shared/utils/lazyExcel'
import { formatInTimeZone, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import type { PayoutAccountItem } from '../components/PayoutAccountsTable'

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
  { header: 'Player Name', key: 'name', width: 20 },
  { header: 'Phone', key: 'phone', width: 15 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'Method', key: 'method', width: 10 },
  { header: 'Account Holder', key: 'accountHolder', width: 24 },
  { header: 'Account Number / UPI ID', key: 'accountNumber', width: 26 },
  { header: 'IFSC Code', key: 'ifsc', width: 14 },
  { header: 'Bank Name', key: 'bankName', width: 22 },
  { header: 'Approval Status', key: 'status', width: 16 },
  { header: 'Rejection Reason', key: 'rejectionReason', width: 30 },
  { header: 'Approved By', key: 'approvedBy', width: 18 },
  { header: 'Approved At', key: 'approvedAt', width: 22 },
  { header: 'Created At', key: 'createdAt', width: 22 },
]

export async function exportPayoutAccountsToExcel(items: PayoutAccountItem[], totalCount: number) {
  if (!items.length) return

  const { Workbook, saveAs } = await loadExcelWriter()
  const workbook = new Workbook()
  workbook.creator = 'Admin Panel'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Payout Accounts', {
    views: [{ state: 'frozen', ySplit: 3 }],
  })

  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  // Title row
  const titleRow = sheet.addRow([`Payout Account Approvals Export — ${totalCount.toLocaleString()} accounts`])
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
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.headerFont } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    applyBorder(cell)
  })

  // Data rows
  items.forEach((item, idx) => {
    const row = sheet.addRow([
      item.user?.name || '',
      item.user?.phone || '',
      item.user?.email || '',
      item.method === 'UPI' ? 'UPI' : 'Bank',
      item.accountHolderName || '',
      item.accountNumber || '',
      item.ifscCode || '',
      item.bankName || '',
      statusLabel(item.approvalStatus),
      item.rejectionReason || '',
      item.approvedBy || '',
      fmtDate(item.approvedAt),
      fmtDate(item.createdAt),
    ])
    row.height = 22
    const bg = idx % 2 === 0 ? 'FFFFFF' : COLORS.altRowBg

    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const key = COLUMNS[colNum - 1]?.key ?? ''
      cell.font = { name: 'Calibri', size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      cell.alignment = { vertical: 'middle', horizontal: 'left' }
      applyBorder(cell)

      if (key === 'status') {
        const s = String(cell.value || '').toLowerCase()
        if (s === 'pending') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.pendingBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.pendingFont } }
        } else if (s === 'approved') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.approvedBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.approvedFont } }
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.rejectedBg } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.rejectedFont } }
        }
      }

      if (key === 'method') {
        const m = String(cell.value || '').toUpperCase()
        if (m === 'UPI') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '4338CA' } }
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'ECFDF5' } }
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '065F46' } }
        }
      }

      if (key === 'rejectionReason' && cell.value) {
        cell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: COLORS.rejectedFont } }
      }
    })
  })

  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COLUMNS.length } }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const dateStr = formatInTimeZone(new Date(), 'yyyy-MM-dd_HHmm', DEFAULT_ADMIN_TZ)
  saveAs(blob, `Payout-Account-Approvals_${dateStr}.xlsx`)
}
