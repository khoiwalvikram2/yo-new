import { IconFolderOpen, IconLayoutGrid, IconList, IconTrash } from '@tabler/icons-react'
import { ReportingPeriodFilter } from '@/modules/reporting/ui/ReportingPeriodFilter'
import type { ReportingDatePreset } from '@/modules/reporting/reportingDateFilter'
import { Badge } from '@/ui/components/Badge'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { Notice } from '@/ui/components/Notice'
import { RadioGroup, type RadioOption } from '@/ui/components/RadioGroup'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { Spinner } from '@/ui/components/Spinner'
import { strokeFor } from '@/ui/components/icons'
import {
  EXPORT_CATEGORY_OPTIONS,
  exportTypeName,
  filterSelectOptions,
  filterSelectValue,
  formatEstimate,
  type ExportEstimate,
  type ExportFilterValues,
  type ExportFormat,
  type ExportType,
  type ExportTypeGroup,
  type ExportsViewMode,
  type SavedExportTemplate,
} from '../exportsPageModel'
import { ExportsFormatGlyph, ExportsTypeGlyph } from './ExportsTypeGlyph'
import styles from '../ExportsPage.module.css'

/* The Export Center's Create Export tab (page migration C, W3 Task 128): the filter bar, the saved
 * templates, the export-limit notice and the catalogue as category cards, in tiles or as tables. The
 * mockup draws none of this (its Export Center page is the generic job table, M:2531-2538); it is built
 * from the kit and the card, tile and table idioms cited in ExportsPage.module.css. */

const CATEGORY_SELECT_OPTIONS = [{ value: '', label: 'All categories' }, ...EXPORT_CATEGORY_OPTIONS]

const VIEW_OPTIONS: readonly RadioOption<ExportsViewMode>[] = [
  {
    value: 'grid',
    label: (
      <span className={styles.viewOption}>
        <IconLayoutGrid size={14} stroke={strokeFor(14)} aria-hidden="true" />
        Grid
      </span>
    ),
  },
  {
    value: 'list',
    label: (
      <span className={styles.viewOption}>
        <IconList size={14} stroke={strokeFor(14)} aria-hidden="true" />
        List
      </span>
    ),
  },
]

export interface ExportTypeEstimateState {
  loading: boolean
  estimate?: ExportEstimate
}

export interface ExportsCreatePanelProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  category: string | undefined
  onCategoryChange: (value: string | undefined) => void
  dateFrom: string
  dateTo: string
  preset: ReportingDatePreset
  onPeriodChange: (dateFrom: string, dateTo: string, preset: ReportingDatePreset) => void
  viewMode: ExportsViewMode
  onViewModeChange: (mode: ExportsViewMode) => void
  filterCount: number
  onClearAll: () => void
  templates: readonly SavedExportTemplate[]
  onLoadTemplate: (template: SavedExportTemplate) => void
  onDeleteTemplate: (template: SavedExportTemplate) => void
  groups: readonly ExportTypeGroup[]
  activeFilters: ExportFilterValues
  onFilterChange: (key: string, value: string) => void
  selectedExportType: string | null
  selectedFormat: ExportFormat
  creating: boolean
  onExport: (type: ExportType, format: ExportFormat) => void
  estimateFor: (type: ExportType) => ExportTypeEstimateState
  onRequestEstimate: (type: ExportType) => void
}

interface ExportControlsProps {
  type: ExportType
  selectedExportType: string | null
  selectedFormat: ExportFormat
  creating: boolean
  hasPeriod: boolean
  onExport: (type: ExportType, format: ExportFormat) => void
  /** `true` reads "Export CSV" (the list's wording), otherwise "CSV" (the tile's). */
  long?: boolean
}

/* The format buttons: the legacy primary look marks the last format chosen for this type; every
   button waits while any export is being created, and one that needs a period waits for one. */
function ExportButtons({ type, selectedExportType, selectedFormat, creating, hasPeriod, onExport, long = false }: ExportControlsProps) {
  const unavailable = (type.requiresDateRange && !hasPeriod) || creating
  return (
    <>
      {type.availableFormats.map((format) => {
        const label = format.toUpperCase()
        return (
          <Button
            key={format}
            size="sm"
            variant={selectedFormat === format && selectedExportType === type.id ? 'primary' : 'secondary'}
            icon={<ExportsFormatGlyph format={format} size={14} />}
            className={long ? undefined : styles.formatButton}
            loading={creating && selectedExportType === type.id}
            aria-disabled={unavailable || undefined}
            aria-label={`Export ${type.name} as ${label}`}
            onClick={() => onExport(type, format)}
          >
            {long ? `Export ${label}` : label}
          </Button>
        )
      })}
    </>
  )
}

function FormatTags({ formats }: { formats: readonly ExportFormat[] }) {
  return (
    <span className={styles.formatTags}>
      {formats.map((format) => (
        <span key={format} className={styles.formatTag}>
          {format.toUpperCase()}
        </span>
      ))}
    </span>
  )
}

function CategoryCount({ count }: { count: number }) {
  return (
    <span className={styles.categoryCount}>
      <Badge count={count} aria-hidden="true" />
      <span className={styles.srOnly}>{count === 1 ? '1 export type' : `${count} export types`}</span>
    </span>
  )
}

export function ExportsCreatePanel({
  searchQuery,
  onSearchChange,
  category,
  onCategoryChange,
  dateFrom,
  dateTo,
  preset,
  onPeriodChange,
  viewMode,
  onViewModeChange,
  filterCount,
  onClearAll,
  templates,
  onLoadTemplate,
  onDeleteTemplate,
  groups,
  activeFilters,
  onFilterChange,
  selectedExportType,
  selectedFormat,
  creating,
  onExport,
  estimateFor,
  onRequestEstimate,
}: ExportsCreatePanelProps) {
  const hasPeriod = Boolean(dateFrom && dateTo)
  const controls = { selectedExportType, selectedFormat, creating, hasPeriod, onExport }

  const listColumns: DataTableColumn<ExportType>[] = [
    {
      key: 'type',
      header: 'Export Type',
      width: '40%',
      cell: (type) => (
        <span className={styles.typeCell}>
          <span className={styles.typeIcon} aria-hidden="true">
            <ExportsTypeGlyph glyph={type.glyph} size={16} />
          </span>
          <span className={styles.typeCellText}>
            <span className={styles.typeCellName}>{type.name}</span>
            <span className={styles.typeCellDescription}>{type.description}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'formats',
      header: 'Formats',
      width: '20%',
      cell: (type) => <FormatTags formats={type.availableFormats} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '40%',
      align: 'right',
      cell: (type) => (
        <span className={styles.rowActions}>
          <ExportButtons type={type} {...controls} long />
        </span>
      ),
    },
  ]

  return (
    <div className={styles.panel}>
      {/* Filter Section */}
      <FilterBar
        label="Filters"
        activeCount={filterCount}
        onClearAll={onClearAll}
        search={(
          <SearchField
            label="Search export types"
            placeholder="Search export types..."
            size="sm"
            value={searchQuery}
            onChange={onSearchChange}
          />
        )}
      >
        <Select
          label="Category"
          hideLabel
          size="sm"
          value={category ?? ''}
          options={CATEGORY_SELECT_OPTIONS}
          onChange={(value) => onCategoryChange(value || undefined)}
        />
        <ReportingPeriodFilter dateFrom={dateFrom} dateTo={dateTo} preset={preset} onChange={onPeriodChange} />
        <RadioGroup
          className={styles.viewMode}
          label="View"
          hideLabel
          variant="segmented"
          options={VIEW_OPTIONS}
          value={viewMode}
          onChange={onViewModeChange}
        />
      </FilterBar>

      {/* Saved templates */}
      {templates.length > 0 ? (
        <Card title="My templates">
          <ul className={styles.templates}>
            {templates.map((template) => (
              <li key={template.id} className={styles.template}>
                <span className={styles.templateText}>
                  <span className={styles.templateName}>{template.name}</span>
                  <span className={styles.templateType}>{exportTypeName(template.reportType)}</span>
                </span>
                <span className={styles.templateActions}>
                  <Button
                    size="xs"
                    variant="primary"
                    icon={<IconFolderOpen size={14} stroke={strokeFor(14)} />}
                    onClick={() => onLoadTemplate(template)}
                  >
                    Load
                  </Button>
                  <Button
                    size="xs"
                    variant="danger"
                    icon={<IconTrash size={14} stroke={strokeFor(14)} />}
                    aria-label={`Delete template ${template.name}`}
                    onClick={() => onDeleteTemplate(template)}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* 10k limit and format notes */}
      <Notice tone="info" title="Export limit">
        Exports are limited to 10,000 rows. Use filters and date range to narrow results.
        <span className={styles.noticeNote}>Excel (XLSX) format is currently delivered as CSV.</span>
      </Notice>

      {/* Export Types Grid/List - Grouped by Category */}
      {groups.map((group) => (
        <Card
          key={group.category}
          title={group.label}
          tools={<CategoryCount count={group.types.length} />}
          body={viewMode === 'grid' ? 'padded' : 'table'}
        >
          {viewMode === 'grid' ? (
            <ul className={styles.typeGrid}>
              {group.types.map((type) => {
                const { loading, estimate } = estimateFor(type)
                return (
                  <li
                    key={type.id}
                    className={styles.typeTile}
                    onMouseEnter={() => onRequestEstimate(type)}
                    onFocus={() => onRequestEstimate(type)}
                  >
                    <div className={styles.typeHead}>
                      <span className={styles.typeIcon} aria-hidden="true">
                        <ExportsTypeGlyph glyph={type.glyph} size={16} />
                      </span>
                      <div className={styles.typeText}>
                        <h3 className={styles.typeName}>{type.name}</h3>
                        <p className={styles.typeDescription}>{type.description}</p>
                      </div>
                    </div>

                    {/* Formats & Estimate */}
                    <div className={styles.typeMeta}>
                      <FormatTags formats={type.availableFormats} />
                      {loading ? (
                        <Spinner size="sm" className={styles.estimateSpinner} label={`Estimating ${type.name}`} />
                      ) : estimate ? (
                        <span className={styles.estimate}>{formatEstimate(estimate)}</span>
                      ) : null}
                    </div>

                    {/* Filters */}
                    {type.filters && type.filters.length > 0 ? (
                      <div className={styles.typeFilters}>
                        {type.filters.map((filter) => (
                          <Select
                            key={filter.key}
                            label={filter.label}
                            layout="stacked"
                            size="sm"
                            value={filterSelectValue(activeFilters[filter.key])}
                            options={filterSelectOptions(filter, activeFilters[filter.key])}
                            onChange={(value) => onFilterChange(filter.key, value)}
                          />
                        ))}
                      </div>
                    ) : null}

                    {/* Export Buttons */}
                    <div className={styles.typeActions}>
                      <ExportButtons type={type} {...controls} />
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <DataTable
              label={`${group.label} export types`}
              columns={listColumns}
              rows={group.types}
              rowKey={(type) => type.id}
            />
          )}
        </Card>
      ))}

      {groups.length === 0 ? (
        <Card as="div" body="flush">
          <EmptyState title="No export types found. Try adjusting your search." />
        </Card>
      ) : null}
    </div>
  )
}
