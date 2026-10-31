import { useState, useCallback, useRef, useEffect } from 'react'
import { toast } from '@/ui/components/toast'
import type { TableExportColumn, ExportTableToExcelOptions } from '@/shared/utils/tableExport'
import { exportTableToExcel } from '@/shared/utils/tableExport'

export interface UseTableExportOptions<T> {
  data: T[]
  columns: TableExportColumn<T>[]
  filename: string
  sheetName?: string
  title?: string
  totalCount?: number
}

/**
 * Hook for table export with loading state and notifications.
 * Returns { exporting, handleExport }.
 * Use handleExport as onClick for "Export Excel" button.
 * Always uses latest options when Export is clicked (no stale closure).
 */
export function useTableExport<T>(options: UseTableExportOptions<T>) {
  const [exporting, setExporting] = useState(false)
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const handleExport = useCallback(async () => {
    const { data, columns, filename, sheetName, title, totalCount } = optionsRef.current
    if (!data?.length) {
      toast({ title: 'No Data', message: 'There are no rows to export.', tone: 'warn', duration: 4500 })
      return
    }
    setExporting(true)
    try {
      const exportOptions: ExportTableToExcelOptions<T> = {
        data,
        columns,
        filename,
        sheetName,
        title,
        totalCount: totalCount ?? data.length,
      }
      await exportTableToExcel(exportOptions)
      toast({
        title: 'Export Complete',
        message: 'Table exported to Excel successfully.',
        tone: 'ok',
        duration: 4500,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong during export.'
      toast({ title: 'Export Failed', message, tone: 'error', duration: 4500 })
    } finally {
      setExporting(false)
    }
  }, [])

  return { exporting, handleExport }
}
