import type { CSSProperties } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  IconClock,
  IconDeviceGamepad2,
  IconGripVertical,
  IconSettings,
  IconStar,
  IconVideo,
} from '@tabler/icons-react'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Checkbox } from '@/ui/components/Checkbox'
import { IconButton } from '@/ui/components/IconButton'
import { StatusPill } from '@/ui/components/StatusPill'
import { StoredImage } from '@/ui/components/StoredImage'
import { TD, TR } from '@/ui/components/Table'
import { strokeFor } from '@/ui/components/icons'
import { gameAccessStatus, type GameRow, type VipTier } from '../casinoManagementModel'
import { MasterControlToggle } from './MasterControlToggle'
import { VipTierBadges } from './VipTierBadges'
import styles from '../ManagementPage.module.css'

export type { GameRow } from '../casinoManagementModel'

interface SortableRowProps {
  row: GameRow
  isSelected: boolean
  onToggleSelect: () => void
  onOpenDrawer: () => void
  vipTiers: VipTier[]
  toggleMasterActive?: (gameId: string, isActive: boolean) => Promise<void>
  isWhitelabelAdmin?: boolean
  /** Super Admin core mode: no per-whitelabel column applies (priority, VIP tiers, bet rules, settings). */
  coreMode?: boolean
}

export function SortableRow({
  row,
  isSelected,
  onToggleSelect,
  onOpenDrawer,
  vipTiers,
  toggleMasterActive,
  isWhitelabelAdmin = false,
  coreMode = false,
}: SortableRowProps) {
  const { formatDateTime } = useFormatDate()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id, disabled: coreMode })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : row.isActive ? 1 : 0.68,
  }
  const access = gameAccessStatus(row, coreMode)

  return (
    <TR
      ref={setNodeRef}
      style={style}
      className={styles.gameRow}
      data-master-disabled={!row.isActive ? 'true' : undefined}
      data-selected={isSelected ? 'true' : undefined}
    >
      {!coreMode ? (
        <TD className={styles.checkCell}>
          <Checkbox
            checked={isSelected}
            onChange={onToggleSelect}
            label={`Select ${row.name}`}
            hideLabel
          />
        </TD>
      ) : null}
      {!coreMode ? (
        <TD>
          {/* The flex row lives inside the cell: display:flex on the <td> took it out of the row's height and border. */}
          <div className={styles.priorityCell}>
            <IconButton
              ref={setActivatorNodeRef}
              label={`Reorder ${row.name}`}
              size="sm"
              icon={<IconGripVertical size={15} stroke={strokeFor(15)} />}
              className={styles.dragHandle}
              {...attributes}
              {...listeners}
            />
            <span className={styles.orderBadge}>{row.order ?? '—'}</span>
          </div>
        </TD>
      ) : null}
      <TD>
        <div className={styles.gameIdentity}>
          <span className={styles.gameThumb} aria-hidden={!row.thumbnailUrl}>
            {/* No thumbnail, or one that will not load: the gamepad glyph, never a broken image (SYS-18). */}
            <StoredImage src={row.thumbnailUrl} alt="" fallback={<IconDeviceGamepad2 size={19} stroke={strokeFor(19)} />} />
          </span>
          <span className={styles.gameCopy}>
            {coreMode ? (
              <span className={`${styles.gameName} ${styles.gameNameStatic}`}>{row.name}</span>
            ) : (
              <button type="button" onClick={onOpenDrawer} className={styles.gameName}>
                {row.name}
              </button>
            )}
            <span className={styles.secondaryText}>{row.slug}</span>
            <span className={styles.inlineBadges}>
              {!row.isActive ? <StatusPill status="blocked">Platform Disabled</StatusPill> : null}
              {row.premiumOnly ? (
                <StatusPill tone="warn" icon={<IconStar size={11} stroke={strokeFor(11)} />}>Premium</StatusPill>
              ) : null}
            </span>
          </span>
        </div>
      </TD>
      {!isWhitelabelAdmin && toggleMasterActive ? (
        <TD>
          <MasterControlToggle gameId={row.id} isActive={row.isActive} onToggle={toggleMasterActive} />
        </TD>
      ) : null}
      <TD>
        <div className={styles.statusStack}>
          <StatusPill tone={access.tone}>{access.label}</StatusPill>
          {row.updatedAt ? (
            <span className={styles.timestamp}>
              <IconClock size={11} stroke={strokeFor(11)} aria-hidden="true" />
              {formatDateTime(row.updatedAt, 'MMM d, yyyy HH:mm')}
            </span>
          ) : null}
        </div>
      </TD>
      <TD>
        <span className={styles.vendorCell}>
          <span className={styles.vendorIcon} aria-hidden="true"><IconVideo size={13} stroke={strokeFor(13)} /></span>
          <span>{row.vendorName}</span>
        </span>
      </TD>
      {!coreMode ? (
        <>
          <TD><VipTierBadges gameId={row.id} vipTiers={vipTiers} onManage={onOpenDrawer} /></TD>
          <TD>
            {row.betSettingsCount && row.betSettingsCount > 0 ? (
              <StatusPill tone="info">{row.betSettingsCount.toLocaleString()} configured</StatusPill>
            ) : (
              <span className={styles.mutedDash}>—</span>
            )}
          </TD>
          <TD align="right" sticky="end">
            <IconButton
              label={`Edit settings for ${row.name}`}
              icon={<IconSettings size={15} stroke={strokeFor(15)} />}
              size="sm"
              onClick={onOpenDrawer}
            />
          </TD>
        </>
      ) : null}
    </TR>
  )
}
