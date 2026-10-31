import type ExcelJS from 'exceljs'
import { loadExcelWriter } from '@/shared/utils/lazyExcel'
import { formatInTimeZone, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'

const COLORS = {
  titleBg: '4F46E5',
  titleFont: 'FFFFFF',
  subtitleFont: '6B7280',
  headerBg: '1F2937',
  headerFont: 'FFFFFF',
  altRowBg: 'F9FAFB',
  borderColor: 'E5E7EB',
}

export interface TableExportColumn<T> {
  header: string
  key: string
  width?: number
  getter: (row: T) => string | number | null
}

export interface ExportTableToExcelOptions<T> {
  data: T[]
  columns: TableExportColumn<T>[]
  filename: string
  sheetName?: string
  title?: string
  totalCount?: number
}

function applyBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: COLORS.borderColor } },
    bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
    left: { style: 'thin', color: { argb: COLORS.borderColor } },
    right: { style: 'thin', color: { argb: COLORS.borderColor } },
  }
}

/**
 * Export table data to Excel (.xlsx) using a generic column definition.
 * Use this for any list/table that needs "Export Excel" without custom formatting.
 */
export async function exportTableToExcel<T>(options: ExportTableToExcelOptions<T>): Promise<void> {
  const {
    data,
    columns,
    filename,
    sheetName = 'Sheet1',
    title,
  } = options

  if (!data?.length) return

  const { Workbook, saveAs } = await loadExcelWriter()
  const workbook = new Workbook()
  workbook.creator = 'Admin Panel'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: title != null ? 3 : 2 }],
  })

  const colDefs = columns.map((col) => ({
    key: col.key,
    width: col.width ?? 14,
  }))
  sheet.columns = colDefs

  let headerRowIndex = 1

  if (title != null) {
    const titleRow = sheet.addRow([title])
    sheet.mergeCells(1, 1, 1, columns.length)
    const titleCell = titleRow.getCell(1)
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: COLORS.titleFont } }
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.titleBg } }
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' }
    titleRow.height = 36
    headerRowIndex = 2
  }

  const now = formatInTimeZone(new Date(), 'dd MMM yyyy, HH:mm:ss', DEFAULT_ADMIN_TZ)
  const subtitleRow = sheet.addRow([`Exported on ${now} (IST)`])
  sheet.mergeCells(headerRowIndex, 1, headerRowIndex, columns.length)
  const subtitleCell = subtitleRow.getCell(1)
  subtitleCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: COLORS.subtitleFont } }
  subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' }
  subtitleRow.height = 22
  headerRowIndex += 1

  const headerRow = sheet.addRow(columns.map((c) => c.header))
  headerRow.height = 28
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.headerFont } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    applyBorder(cell)
  })

  data.forEach((row, idx) => {
    const values = columns.map((col) => {
      const v = col.getter(row)
      return v === null || v === undefined ? '' : v
    })
    const dataRow = sheet.addRow(values)
    dataRow.height = 22
    const bgColor = idx % 2 === 0 ? 'FFFFFF' : COLORS.altRowBg

    dataRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Calibri', size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
      cell.alignment = { vertical: 'middle', horizontal: 'left' }
      applyBorder(cell)
    })
  })

  sheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex + data.length, column: columns.length },
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const dateStr = formatInTimeZone(new Date(), 'yyyy-MM-dd_HHmm', DEFAULT_ADMIN_TZ)
  const finalFilename = filename.includes('.') ? filename : `${filename}_${dateStr}.xlsx`
  saveAs(blob, finalFilename)
}

/**
 * Export table data to CSV. Good for simple lists when Excel is not needed.
 */
export function exportTableToCSV<T>(
  data: T[],
  columns: TableExportColumn<T>[],
  filename: string
): void {
  if (!data?.length) return

  const header = columns.map((c) => c.header).join(',')
  const escape = (v: string | number | null) => {
    if (v == null) return ''
    const s = String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const rows = data.map((row) => columns.map((c) => escape(c.getter(row))).join(','))
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.includes('.') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
