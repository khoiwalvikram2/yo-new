import { IconChartBar, IconFileSearch, IconFileSpreadsheet, IconFileText } from '@tabler/icons-react'
import { strokeFor } from '@/ui/components/icons'
import type { ExportFormat, ExportGlyph } from '../exportsPageModel'

/* The Export Center's glyphs on Tabler (page migration C, W3 Task 128), mapped from the legacy antd
 * icons: FileTextOutlined → IconFileText, FileExcelOutlined → IconFileSpreadsheet, BarChartOutlined →
 * IconChartBar, FileSearchOutlined → IconFileSearch. Every one is decorative; the text beside it
 * carries the meaning. */

const GLYPHS = {
  file: IconFileText,
  sheet: IconFileSpreadsheet,
  chart: IconChartBar,
  search: IconFileSearch,
} as const

export function ExportsTypeGlyph({ glyph = 'file', size = 16 }: { glyph?: ExportGlyph; size?: number }) {
  const Glyph = GLYPHS[glyph]
  return <Glyph size={size} stroke={strokeFor(size)} aria-hidden="true" />
}

/** The format's glyph, as the legacy buttons and tags drew it: a document for CSV, a sheet otherwise. */
export function ExportsFormatGlyph({ format, size = 14 }: { format: ExportFormat | string; size?: number }) {
  const Glyph = String(format).toLowerCase() === 'csv' ? IconFileText : IconFileSpreadsheet
  return <Glyph size={size} stroke={strokeFor(size)} aria-hidden="true" />
}
