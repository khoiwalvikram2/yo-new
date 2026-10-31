import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import {
  IconAdjustmentsHorizontal,
  IconArrowLeft,
  IconArrowsExchange,
  IconBallFootball,
  IconBell,
  IconChartLine,
  IconChartPie,
  IconChecks,
  IconCircleCheckFilled,
  IconClipboardCheck,
  IconCoins,
  IconCreditCard,
  IconCrown,
  IconDice5,
  IconEraser,
  IconFilterOff,
  IconFolder,
  IconGauge,
  IconGift,
  IconHeartHandshake,
  IconKey,
  IconSearchOff,
  IconShare,
  IconShieldHalf,
  IconSpeakerphone,
  IconStack2,
  IconTie,
  IconUsers,
  type TablerIcon,
} from '@tabler/icons-react'
import clsx from 'clsx'
import type { Permission } from '@/state/rbacStore'
import { Button } from '@/ui/components/Button'
import { Checkbox } from '@/ui/components/Checkbox'
import { EmptyState } from '@/ui/components/EmptyState'
import { strokeFor } from '@/ui/components/icons'
import { Meter } from '@/ui/components/Meter'
import { SearchField } from '@/ui/components/SearchField'
import { Spinner } from '@/ui/components/Spinner'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { Tooltip } from '@/ui/components/Tooltip'
import {
  actionLabel,
  activeCategoryCount,
  buildCategories,
  categoryMeta,
  categoryStats,
  categoryToggleTooltip,
  fillPercent,
  filterCategoryKeys,
  filterResources,
  grantAll,
  isFull,
  matchedLabel,
  progressPercent,
  resolveActiveCategory,
  resourceDescription,
  resourceSelection,
  revokeAll,
  toggleAction,
  toggleCategory,
  toggleResource,
  totalStats,
  type CategoryHue,
  type ResourceItem,
  type SelectionStats,
} from './permissionsSelectorModel'
import styles from './PermissionsSelector.module.css'

interface PermissionsSelectorProps {
  permissionsByDomain: Record<string, string[]>
  loading: boolean
  value?: Permission[]
  onChange?: (permissions: Permission[]) => void
}

const NO_PERMISSIONS: Permission[] = []

/* The legacy Font Awesome category glyphs, mapped to Tabler. Decorative: the label carries the meaning. */
const CATEGORY_ICONS: Readonly<Record<string, TablerIcon>> = {
  overview: IconGauge,
  sports: IconBallFootball,
  casino: IconDice5,
  matka: IconChartLine,
  players: IconUsers,
  agents: IconTie,
  bonuses: IconGift,
  referrals: IconShare,
  vip: IconCrown,
  payments: IconCreditCard,
  settlements: IconHeartHandshake,
  reporting: IconChartPie,
  config: IconAdjustmentsHorizontal,
  currency: IconCoins,
  security: IconShieldHalf,
  audit: IconClipboardCheck,
  notifications: IconBell,
  credit: IconArrowsExchange,
  promotions: IconSpeakerphone,
}

const HUE_CLASS: Readonly<Record<CategoryHue, string>> = {
  ind: styles.hueInd,
  red: styles.hueRed,
  grn: styles.hueGrn,
  vio: styles.hueVio,
  blu: styles.hueBlu,
  amb: styles.hueAmb,
  neutral: styles.hueNeutral,
}

function categoryIcon(categoryKey: string): TablerIcon {
  return Object.hasOwn(CATEGORY_ICONS, categoryKey) ? CATEGORY_ICONS[categoryKey] : IconFolder
}

function CategoryTab({
  categoryKey,
  idPrefix,
  active,
  stats,
  onSelect,
}: {
  categoryKey: string
  idPrefix: string
  active: boolean
  stats: SelectionStats
  onSelect: (categoryKey: string) => void
}) {
  const meta = categoryMeta(categoryKey)
  const Icon = categoryIcon(categoryKey)
  const hasSelections = stats.selected > 0
  const full = isFull(stats)

  return (
    <button
      type="button"
      role="tab"
      id={tabId(idPrefix, categoryKey)}
      aria-selected={active}
      aria-controls={active ? tabPanelId(idPrefix, categoryKey) : undefined}
      tabIndex={active ? 0 : -1}
      className={clsx(styles.tab, active && styles.tabActive)}
      onClick={() => onSelect(categoryKey)}
    >
      <span className={clsx(styles.tabIcon, (active || hasSelections) && HUE_CLASS[meta.hue])} aria-hidden="true">
        <Icon size={14} stroke={strokeFor(14)} />
      </span>
      <span className={styles.tabText}>
        <span className={styles.tabLabel}>{meta.label}</span>
        <Meter value={fillPercent(stats)} className={styles.tabMeter} />
      </span>
      <span className={styles.tabBadge}>
        {full ? <IconCircleCheckFilled size={14} className={styles.fullMark} aria-hidden="true" /> : null}
        {!full && hasSelections ? (
          <span className={styles.tabCount} aria-hidden="true">
            {stats.selected}
          </span>
        ) : null}
        <span className={styles.srOnly}>{`, ${stats.selected} of ${stats.total} selected`}</span>
      </span>
    </button>
  )
}

function ResourceGroup({
  resource,
  value,
  onEmit,
}: {
  resource: ResourceItem
  value: Permission[]
  onEmit: (next: Permission[] | null) => void
}) {
  const labelId = useId()
  const { selected, allOn, partial } = resourceSelection(resource, value)
  const desc = resourceDescription(resource.domain)

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={clsx(styles.resource, allOn && styles.resourceFull, partial && styles.resourcePartial)}
    >
      <div className={styles.resourceHead}>
        <div className={styles.resourceText}>
          <span className={styles.resourceTitle}>
            <span id={labelId} className={styles.resourceLabel}>{resource.label}</span>
            {allOn ? <IconCircleCheckFilled size={13} className={styles.fullMark} aria-hidden="true" /> : null}
          </span>
          {desc ? <p className={styles.resourceDesc}>{desc}</p> : null}
        </div>
        <div className={styles.resourceTools}>
          <span className={styles.resourceCount}>
            {selected.length}/{resource.actions.length}
          </span>
          {/* The visible word starts the name, which adds the resource, so the many buttons are told apart. */}
          <Button
            size="xs"
            variant={allOn ? 'danger' : 'secondary'}
            aria-label={`${allOn ? 'Revoke' : 'Grant All'} ${resource.label}`}
            onClick={() => onEmit(toggleResource(value, resource.domain, resource.actions))}
          >
            {allOn ? 'Revoke' : 'Grant All'}
          </Button>
        </div>
      </div>

      <div className={styles.actions}>
        {resource.actions.map((action) => {
          const on = selected.includes(action)
          return (
            <Checkbox
              key={action}
              className={clsx(styles.action, on && styles.actionOn)}
              checked={on}
              label={actionLabel(action)}
              onChange={(checked) => onEmit(toggleAction(value, resource.domain, action, checked))}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * The role's permissions as a category list beside the shown category's resources, each resource a group of
 * native checkboxes (one per action) with its Grant All / Revoke, and the category's select-all a tri-state
 * checkbox. Every change goes through the model's toggles, so the list the form submits is built exactly as
 * before. The category list is a page-local vertical tablist: the kit Tabs is horizontal only.
 */
export function PermissionsSelector({
  permissionsByDomain,
  loading,
  value = NO_PERMISSIONS,
  onChange,
}: PermissionsSelectorProps) {
  const idPrefix = `role-permissions-${useId().replace(/:/g, '')}`
  const [chosenCategory, setChosenCategory] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')

  const categories = useMemo(() => buildCategories(permissionsByDomain), [permissionsByDomain])
  const { categoryMap, orderedKeys } = categories
  const filteredKeys = useMemo(() => filterCategoryKeys(searchText, categories), [searchText, categories])
  const activeCategory = resolveActiveCategory(chosenCategory, orderedKeys, filteredKeys)

  // A search that hides the shown category moves to its first match, and the choice sticks once the search is
  // cleared, as the legacy effects left it.
  const changeSearch = (text: string) => {
    setSearchText(text)
    setChosenCategory(resolveActiveCategory(activeCategory, orderedKeys, filterCategoryKeys(text, categories)))
  }

  // A toggle that changes nothing (turning off an action that is not granted) reports nothing, as before.
  const emit = (next: Permission[] | null) => {
    if (next) onChange?.(next)
  }

  const selectTab = (categoryKey: string, focus: boolean) => {
    setChosenCategory(categoryKey)
    if (focus) document.getElementById(tabId(idPrefix, categoryKey))?.focus()
  }

  // One tab stop for the list; the arrows, Home and End move the selection with the focus (as the kit Tabs).
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (activeCategory === null || filteredKeys.length === 0) return
    const index = Math.max(0, filteredKeys.indexOf(activeCategory))
    let next: number
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = (index + 1) % filteredKeys.length
        break
      case 'ArrowUp':
      case 'ArrowLeft':
        next = (index - 1 + filteredKeys.length) % filteredKeys.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = filteredKeys.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    selectTab(filteredKeys[next], true)
  }

  const activeResources: ResourceItem[] = activeCategory ? categoryMap.get(activeCategory) || [] : []
  const currentResources = activeCategory ? filterResources(activeResources, searchText) : []
  const currentMeta = activeCategory ? categoryMeta(activeCategory) : null
  const currentStats = categoryStats(activeResources, value)

  if (loading) {
    return (
      <div className={styles.loading} role="status">
        <Spinner size="lg" decorative />
        <p className={styles.loadingTitle}>Loading permissions</p>
        <p className={styles.loadingNote}>Fetching available actions...</p>
      </div>
    )
  }

  const overall = totalStats(categories, value)
  const progressPct = progressPercent(overall)
  const activeCatsCount = activeCategoryCount(categories, value)
  const tabsShown = activeCategory !== null && filteredKeys.includes(activeCategory)
  const panelProps = activeCategory === null
    ? {}
    : tabsShown
      ? {
          role: 'tabpanel' as const,
          id: tabPanelId(idPrefix, activeCategory),
          'aria-labelledby': tabId(idPrefix, activeCategory),
        }
      : { role: 'region' as const, 'aria-label': currentMeta?.label }

  return (
    <div className={styles.root}>
      <div className={styles.summary}>
        <div className={styles.figures}>
          <div className={styles.progress}>
            <Meter value={progressPct} className={styles.progressMeter} />
            <span className={styles.progressValue}>
              {progressPct}%<span className={styles.srOnly}> of the offered permissions granted</span>
            </span>
          </div>
          <div className={styles.figure}>
            <span className={clsx(styles.figureIcon, styles.hueBlu)} aria-hidden="true">
              <IconKey size={14} stroke={strokeFor(14)} />
            </span>
            <span className={styles.figureText}>
              <span className={styles.figureLabel}>Permissions</span>
              <span className={styles.figureValue}>
                {overall.selected}
                <span className={styles.figureOf}>/{overall.total}</span>
              </span>
            </span>
          </div>
          <span className={styles.figureDivider} aria-hidden="true" />
          <div className={styles.figure}>
            <span className={clsx(styles.figureIcon, styles.hueVio)} aria-hidden="true">
              <IconStack2 size={14} stroke={strokeFor(14)} />
            </span>
            <span className={styles.figureText}>
              <span className={styles.figureLabel}>Categories</span>
              <span className={styles.figureValue}>
                {activeCatsCount}
                <span className={styles.figureOf}>/{orderedKeys.length}</span>
              </span>
            </span>
          </div>
        </div>

        <div className={styles.bulk}>
          <Button size="sm" icon={<IconChecks size={14} stroke={strokeFor(14)} />} onClick={() => emit(grantAll(permissionsByDomain))}>
            Grant All
          </Button>
          <Button size="sm" variant="danger" icon={<IconEraser size={14} stroke={strokeFor(14)} />} onClick={() => emit(revokeAll())}>
            Revoke All
          </Button>
        </div>
      </div>

      <div className={styles.searchRow}>
        <SearchField
          className={styles.search}
          label="Search permissions"
          placeholder="Search permissions, categories, or actions..."
          value={searchText}
          onChange={changeSearch}
          // The picker sits inside the role form: Enter here must not submit the role (the legacy search did).
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault()
          }}
        />
        {searchText && <p className={styles.matched}>{matchedLabel(filteredKeys.length)}</p>}
      </div>

      {/* ━━━ Categories beside the shown category; a stacked strip when the card is narrow ━━━ */}
      <div className={styles.split}>
        <div className={styles.splitInner}>
          <div className={styles.sidebar}>
            {filteredKeys.length === 0 ? (
              <div className={styles.noCategories}>
                <IconFilterOff size={20} stroke={strokeFor(20)} aria-hidden="true" />
                <p className={styles.noCategoriesText}>No categories match</p>
              </div>
            ) : (
              <div
                role="tablist"
                aria-label="Permission categories"
                aria-orientation="vertical"
                className={styles.tablist}
                onKeyDown={onTabKeyDown}
              >
                {filteredKeys.map((catKey) => (
                  <CategoryTab
                    key={catKey}
                    categoryKey={catKey}
                    idPrefix={idPrefix}
                    active={catKey === activeCategory}
                    stats={categoryStats(categoryMap.get(catKey) || [], value)}
                    onSelect={(categoryKey) => selectTab(categoryKey, false)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className={styles.panel} {...panelProps}>
            {activeCategory && currentMeta ? (
              <PanelBody
                categoryKey={activeCategory}
                resources={activeResources}
                shown={currentResources}
                stats={currentStats}
                value={value}
                onEmit={emit}
              />
            ) : (
              <EmptyState
                title="Select a category"
                description="Choose a category from the sidebar to manage permissions"
                icon={<IconArrowLeft size={20} stroke={strokeFor(20)} />}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The shown category: its head with the figures and the select-all, then its (searched) resources. */
function PanelBody({
  categoryKey,
  resources,
  shown,
  stats,
  value,
  onEmit,
}: {
  categoryKey: string
  resources: ResourceItem[]
  shown: ResourceItem[]
  stats: SelectionStats
  value: Permission[]
  onEmit: (next: Permission[] | null) => void
}) {
  const meta = categoryMeta(categoryKey)
  const Icon = categoryIcon(categoryKey)
  const full = isFull(stats)

  return (
    <>
      <div className={styles.panelHead}>
        <div className={styles.panelTitleRow}>
          <span className={clsx(styles.panelIcon, HUE_CLASS[meta.hue])} aria-hidden="true">
            <Icon size={16} stroke={strokeFor(16)} />
          </span>
          <div className={styles.panelText}>
            <h3 className={styles.panelTitle}>{meta.label}</h3>
            <p className={styles.panelSub}>
              {meta.desc}
              <span className={styles.bullet} aria-hidden="true">•</span>
              {resources.length} resources
            </p>
          </div>
        </div>
        <div className={styles.panelTools}>
          <Meter value={fillPercent(stats)} className={styles.panelMeter} />
          <span className={styles.panelCount}>
            {stats.selected}/{stats.total}
          </span>
          <span className={styles.panelDivider} aria-hidden="true" />
          {/* The legacy Switch, now the category's tri-state select-all; its tooltip keeps the legacy copy. */}
          <Tooltip content={categoryToggleTooltip(stats)}>
            <Checkbox
              className={styles.selectAll}
              checked={full}
              indeterminate={stats.selected > 0 && !full}
              label={`All ${meta.label} permissions`}
              hideLabel
              onChange={() => onEmit(toggleCategory(value, resources))}
            />
          </Tooltip>
        </div>
      </div>

      <div className={styles.resources}>
        {shown.length === 0 ? (
          <EmptyState
            title="No matching permissions"
            description="Try adjusting your search terms"
            icon={<IconSearchOff size={20} stroke={strokeFor(20)} />}
          />
        ) : (
          shown.map((resource) => (
            <ResourceGroup key={resource.domain} resource={resource} value={value} onEmit={onEmit} />
          ))
        )}
      </div>
    </>
  )
}

