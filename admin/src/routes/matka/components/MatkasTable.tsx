import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import {
  IconClock,
  IconDice,
  IconDotsVertical,
  IconEdit,
  IconGripVertical,
  IconInfoCircle,
  IconMessage,
  IconNotes,
  IconSettings,
  IconAdjustmentsHorizontal,
} from '@tabler/icons-react'
import type { Matka } from '@/modules/matka/types'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Checkbox } from '@/ui/components/Checkbox'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { LoadingState } from '@/ui/components/LoadingState'
import { Menu, MenuItem } from '@/ui/components/Menu'
import { Popover } from '@/ui/components/Popover'
import { StatusPill } from '@/ui/components/StatusPill'
import { Table, TBody, TD, TH, THead, TR } from '@/ui/components/Table'
import { Textarea } from '@/ui/components/Textarea'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import {
  reorderMatkaRows,
  scheduleSummary,
  scheduleTimeRange,
  scheduleWeekdays,
  statusLabel,
  statusTone,
  subtractMinutes,
  type MatkaRecord,
} from '../matkaManagementModel'
import styles from '../ManagementPage.module.css'

interface MatkasTableProps {
  matkas: Matka[]
  fetching: boolean
  onOpenActions: (matka: Matka) => void
  onOpenDetails?: (matka: Matka) => void
  onEdit: (matka: Matka) => void
  onOpenRules?: (matka: Matka) => void
  onReorder?: (matkas: Matka[]) => void
  onSaveMessage?: (matka: Matka, message: string) => Promise<void> | void
  footer?: ReactNode
  selectedKeys?: Set<string>
  onToggleSelect?: (id: string) => void
  onToggleSelectAll?: () => void
  headerActions?: ReactNode
}

function formattedDate(
  value: string | Date | number | null | undefined,
  formatDateTime: (value: string | Date, pattern?: string) => string,
): string {
  if (value === null || value === undefined || value === '') return '—'
  try {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return formatDateTime(date, 'MMM d, yyyy HH:mm')
  } catch {
    return '—'
  }
}

function TimeChip({
  kind,
  time,
  cutoff,
}: {
  kind: 'open' | 'close'
  time: string
  cutoff?: number
}) {
  const cutoffTime = cutoff && cutoff > 0 ? subtractMinutes(time, cutoff) : ''
  return (
    <span className={kind === 'open' ? styles.timeChip : clsx(styles.timeChip, styles.timeChipClose)}>
      <IconClock size={12} stroke={strokeFor(12)} aria-hidden="true" />
      {time}{cutoffTime ? ` | ${cutoffTime}` : ''}
    </span>
  )
}

function InlineMessageEditor({
  matka,
  onSave,
}: {
  matka: MatkaRecord
  onSave: (value: string) => Promise<void> | void
}) {
  const current = String(matka.settings?.message ?? '')
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(current)
  const [saving, setSaving] = useState(false)

  useEffect(() => setValue(current), [current])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setValue(current)
      }}
      label={`Message for ${matka.name}`}
      trigger={(
        <IconButton
          label={`Edit message for ${matka.name}`}
          size="sm"
          className={styles.messageTrigger}
          icon={<IconMessage size={16} stroke={strokeFor(16)} />}
        >
          {current.trim() ? <span className={styles.messageDot} aria-hidden="true" /> : null}
        </IconButton>
      )}
    >
      {({ close }) => (
        <div className={styles.popoverForm}>
          <Textarea
            label="User message"
            hideLabel
            rows={3}
            placeholder="Add a message for users..."
            value={value}
            onChange={setValue}
          />
          <div className={styles.inlineActions}>
            <Button size="sm" onClick={close}>Cancel</Button>
            <Button
              size="sm"
              variant="primary"
              loading={saving}
              onClick={async () => {
                setSaving(true)
                try {
                  await onSave(value.trim())
                  close()
                } finally {
                  setSaving(false)
                }
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </Popover>
  )
}

function InlineNoteViewer({ matka }: { matka: MatkaRecord }) {
  const note = String(matka.settings?.notes ?? '').trim()
  return (
    <Popover
      label={`Internal note for ${matka.name}`}
      trigger={(
        <IconButton
          label={`View internal note for ${matka.name}`}
          size="sm"
          icon={<IconInfoCircle size={16} stroke={strokeFor(16)} />}
        />
      )}
    >
      <p className={styles.popoverText}>{note || 'No internal note'}</p>
    </Popover>
  )
}

interface SortableRowProps {
  matka: MatkaRecord
  selected: boolean
  onToggleSelect: () => void
  onOpenSettings: () => void
  onOpenDetails?: () => void
  onOpenRules?: () => void
  onEdit: () => void
  onSaveMessage: (value: string) => Promise<void> | void
}

function SortableRow({
  matka,
  selected,
  onToggleSelect,
  onOpenSettings,
  onOpenDetails,
  onOpenRules,
  onEdit,
  onSaveMessage,
}: SortableRowProps) {
  const { formatAmount } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: matka.id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const schedule = (matka.schedule ?? {}) as Record<string, unknown>
  const limits = (matka.limits ?? {}) as Record<string, unknown>
  const settings = (matka.settings ?? {}) as Record<string, unknown>
  const openTime = schedule.openTime ? String(schedule.openTime) : ''
  const closeTime = schedule.closeTime ? String(schedule.closeTime) : ''

  return (
    <TR ref={setNodeRef} style={style} className={isDragging ? styles.dragging : styles.sortableRow}>
      <TD className={styles.selectCell}>
        <Checkbox
          checked={selected}
          onChange={onToggleSelect}
          label={`Select ${matka.name}`}
          hideLabel
        />
      </TD>
      <TD align="center" className={styles.priorityCell}>
        <span className={styles.priorityWrap}>
          <button
            ref={setActivatorNodeRef}
            type="button"
            className={styles.dragHandle}
            aria-label={`Reorder ${matka.name}`}
            {...attributes}
            {...listeners}
          >
            <IconGripVertical size={16} stroke={strokeFor(16)} aria-hidden="true" />
          </button>
          <span className={styles.priorityBadge}>{matka.priority ?? 0}</span>
        </span>
      </TD>
      <TD>
        <div className={styles.identity}>
          <span className={styles.identityTile} aria-hidden="true">
            <IconDice size={18} stroke={strokeFor(18)} />
          </span>
          <div className={styles.identityText}>
            <span className={styles.identityName}>{matka.name}</span>
            <span className={styles.identityCode}>{matka.code}</span>
            {openTime || closeTime ? (
              <span className={styles.timeList}>
                {openTime ? (
                  <TimeChip kind="open" time={openTime} cutoff={Number(settings.betWindowMinsBeforeOpen ?? 0)} />
                ) : null}
                {closeTime ? (
                  <TimeChip kind="close" time={closeTime} cutoff={Number(settings.betWindowMinsBeforeClose ?? 0)} />
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      </TD>
      <TD className={styles.scheduleColumn}>
        <div className={styles.cellStack}>
          <span className={styles.primaryText}>{scheduleSummary(schedule)}</span>
          <span className={styles.secondaryText}>{scheduleTimeRange(schedule)}</span>
          <span className={styles.timeMeta}>{scheduleWeekdays(schedule)}</span>
        </div>
      </TD>
      <TD className={styles.stakeColumn}>
        <div className={styles.cellStack}>
          <span className={styles.dataChip}>Min: {limits.minBet != null ? formatAmount(Number(limits.minBet)) : '—'}</span>
          <span className={styles.dataChip}>Max: {limits.maxBet != null ? formatAmount(Number(limits.maxBet)) : '—'}</span>
          <span className={styles.chipList}>
            {limits.exposureDaily != null ? (
              <span className={clsx(styles.dataChip, styles.exposureChip)}>Daily: {formatAmount(Number(limits.exposureDaily))}</span>
            ) : null}
            {limits.exposureWeekly != null ? (
              <span className={clsx(styles.dataChip, styles.exposureChip)}>Weekly: {formatAmount(Number(limits.exposureWeekly))}</span>
            ) : null}
            {limits.exposureCap != null ? (
              <span className={clsx(styles.dataChip, styles.exposureChip)}>Cap: {formatAmount(Number(limits.exposureCap))}</span>
            ) : null}
          </span>
          {settings.riskLevel ? (
            <span className={styles.riskChip}>
              Risk: {String(settings.riskLevel).toUpperCase()}
              {settings.riskThreshold != null ? ` • ${formatAmount(Number(settings.riskThreshold))}` : ''}
            </span>
          ) : null}
        </div>
      </TD>
      <TD>
        <div className={styles.cellStack}>
          <StatusPill status={statusLabel(matka.status)} tone={statusTone(matka.status)}>
            {statusLabel(matka.status)}
          </StatusPill>
          <span className={styles.updatedLine}>
            <IconClock size={12} stroke={strokeFor(12)} aria-hidden="true" />
            {formattedDate(matka.updatedAt, formatDateTime)}
          </span>
        </div>
      </TD>
      <TD align="right" className={clsx(styles.performanceColumn, styles.performance)}>
        <div className={styles.performanceValue}>—</div>
        <div>Bets: —</div>
        <div>Win rate: —</div>
        <div>Avg stake: —</div>
      </TD>
      <TD align="right" sticky="end" className={styles.actionsCell}>
        <div className={styles.actionStrip}>
          <Tooltip content="Bid Settings">
            <IconButton
              label={`Open bid settings for ${matka.name}`}
              size="sm"
              icon={<IconAdjustmentsHorizontal size={16} stroke={strokeFor(16)} />}
              onClick={onOpenRules}
            />
          </Tooltip>
          <InlineMessageEditor matka={matka} onSave={onSaveMessage} />
          <InlineNoteViewer matka={matka} />
          <Menu
            trigger={(
              <IconButton
                label={`More actions for ${matka.name}`}
                size="sm"
                icon={<IconDotsVertical size={16} stroke={strokeFor(16)} />}
              />
            )}
          >
            <MenuItem icon={<IconEdit size={15} stroke={strokeFor(15)} />} onSelect={onEdit}>Edit</MenuItem>
            <MenuItem icon={<IconSettings size={15} stroke={strokeFor(15)} />} onSelect={onOpenSettings}>Settings</MenuItem>
            {onOpenDetails ? (
              <MenuItem icon={<IconNotes size={15} stroke={strokeFor(15)} />} onSelect={onOpenDetails}>Manage actions</MenuItem>
            ) : null}
          </Menu>
        </div>
      </TD>
    </TR>
  )
}

export function MatkasTable({
  matkas,
  fetching,
  onOpenActions,
  onOpenDetails,
  onEdit,
  onOpenRules,
  onReorder,
  onSaveMessage,
  footer,
  selectedKeys = new Set(),
  onToggleSelect,
  onToggleSelectAll,
  headerActions,
}: MatkasTableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const pageSelected = matkas.length > 0 && matkas.every((matka) => selectedKeys.has(matka.id))
  const pagePartSelected = !pageSelected && matkas.some((matka) => selectedKeys.has(matka.id))

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || !onReorder) return
    onReorder(reorderMatkaRows(matkas, String(active.id), String(over.id)) as Matka[])
  }

  return (
    <Card
      title="Matkas List"
      sub="Manage matka catalog and schedules"
      tools={headerActions}
      body="table"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <Table caption="Matka catalog" width="wide">
          <THead>
            <TR>
              <TH className={styles.selectCell}>
                <Checkbox
                  checked={pageSelected}
                  indeterminate={pagePartSelected}
                  onChange={() => onToggleSelectAll?.()}
                  label="Select all matkas on this page"
                  hideLabel
                />
              </TH>
              <TH align="center" className={styles.priorityCell}>Priority</TH>
              <TH>Matka</TH>
              <TH className={styles.scheduleColumn}>Schedule</TH>
              <TH className={styles.stakeColumn}>Stake Limits</TH>
              <TH>Status</TH>
              <TH align="right" className={styles.performanceColumn}>Performance</TH>
              <TH align="right" sticky="end">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {fetching ? (
              <TR>
                <TD colSpan={8} className={styles.stateCell}>
                  <LoadingState label="Loading matkas" minHeight={192} />
                </TD>
              </TR>
            ) : matkas.length === 0 ? (
              <TR>
                <TD colSpan={8} className={styles.stateCell}>
                  <EmptyState
                    title="No matkas found"
                    description="Try clearing filters or create a new matka."
                    icon={<IconDice size={20} stroke={strokeFor(20)} />}
                  />
                </TD>
              </TR>
            ) : (
              <SortableContext items={matkas.map((matka) => matka.id)} strategy={verticalListSortingStrategy}>
                {matkas.map((matka) => (
                  <SortableRow
                    key={matka.id}
                    matka={matka as MatkaRecord}
                    selected={selectedKeys.has(matka.id)}
                    onToggleSelect={() => onToggleSelect?.(matka.id)}
                    onOpenSettings={() => onOpenActions(matka)}
                    onOpenDetails={onOpenDetails ? () => onOpenDetails(matka) : undefined}
                    onOpenRules={onOpenRules ? () => onOpenRules(matka) : undefined}
                    onEdit={() => onEdit(matka)}
                    onSaveMessage={(message) => onSaveMessage?.(matka, message)}
                  />
                ))}
              </SortableContext>
            )}
          </TBody>
        </Table>
      </DndContext>
      {footer}
    </Card>
  )
}
