import type ExcelJS from 'exceljs'

/**
 * Loads the Excel writer and file-saver on demand.
 *
 * exceljs + file-saver are ~920 kB minified. Importing them statically pulled
 * them into the entry chunk, so every admin session downloaded the whole Excel
 * writer on first paint whether or not the user ever exported anything.
 * Loading them here keeps them in a separate chunk fetched on first export.
 */
export async function loadExcelWriter(): Promise<{
  Workbook: typeof ExcelJS.Workbook
  saveAs: (data: Blob, filename?: string) => void
}> {
  const [excel, fileSaver] = await Promise.all([
    import('exceljs'),
    import('file-saver'),
  ])
  return { Workbook: excel.default.Workbook, saveAs: fileSaver.saveAs }
}
