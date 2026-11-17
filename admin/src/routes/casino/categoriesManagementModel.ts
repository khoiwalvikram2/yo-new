/* Casino Categories (/casino/categories): the page's logic, kept free of React so it can be tested on its own.
   Every rule here is the legacy page's (CategoriesManagementPage.tsx and its three components before Task 153),
   moved verbatim unless a comment says otherwise. */
import { z } from 'zod'

export type MainCategory = 'LIVE_CASINO' | 'CASINO' | 'SLOTS'
export type CategoryType = 'GENERAL' | 'TOP' | 'FEATURED' | 'LOUNGE'
export type TypeFilter = 'ALL' | CategoryType
export type DrawerMode = 'create' | 'edit'

export interface CasinoCategory {
  id: string
  mainCategory: MainCategory
  type: CategoryType
  subtitle?: string | null
  name: string
  slug: string
  iconData?: string | null
  order?: number | null
  isActive: boolean
  gameCount?: number
}

export interface CategoryGame {
  id: string
  name: string
  slug: string
  vendorName?: string
  thumbnailUrl?: string
  isActive?: boolean
  tenantEnabled?: boolean
}

export interface CasinoCustomCategoriesData {
  casinoCustomCategories?: CasinoCategory[] | null
}

export interface GamesInCategoryData {
  gamesInCategory?: string[] | null
}

export interface GamesByIdsData {
  gamesByIds?: CategoryGame[] | null
}

/** What the drawer opens with: a whole category when editing, only the current main category when creating. */
export interface CategoryDrawerInitial {
  id?: string
  mainCategory?: MainCategory
  type?: CategoryType
  subtitle?: string | null
  name?: string
  slug?: string
  iconData?: string | null
  isActive?: boolean
}

/** The drawer's onSubmit payload, in the legacy key order (it is the create mutation's input as it stands). */
export interface CategorySubmitValues {
  mainCategory: MainCategory
  type: CategoryType
  subtitle?: string | null
  name: string
  slug: string
  iconData?: string | null
  isActive: boolean
}

export const PAGE_TITLE = 'Casino Categories'
export const PAGE_SUB = 'Create and manage custom categories for casino games'
export const CREATE_CATEGORY_LABEL = 'Create Category'

/* The legacy page raised antd notifications (4.5 s by default) and antd messages (3 s by default); the kit
   toasts keep those timings, as shared/services/notification.ts does. */
export const NOTIFICATION_DURATION_MS = 4500
export const MESSAGE_DURATION_MS = 3000

export const DEFAULT_MAIN_CATEGORY: MainCategory = 'LIVE_CASINO'
export const DEFAULT_TYPE_FILTER: TypeFilter = 'ALL'

export const MAIN_CATEGORY_OPTIONS: ReadonlyArray<{ value: MainCategory; label: string }> = [
  { value: 'LIVE_CASINO', label: 'Live Casino' },
  { value: 'CASINO', label: 'Casino' },
  { value: 'SLOTS', label: 'Slots' },
]

export const TYPE_FILTER_OPTIONS: ReadonlyArray<{ value: TypeFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'GENERAL', label: 'General' },
  { value: 'TOP', label: 'Top' },
  { value: 'FEATURED', label: 'Featured' },
  { value: 'LOUNGE', label: 'Casino lounge' },
]

export const CATEGORY_TYPE_OPTIONS: ReadonlyArray<{ value: CategoryType; label: string }> = [
  { value: 'GENERAL', label: 'General' },
  { value: 'TOP', label: 'Top' },
  { value: 'FEATURED', label: 'Featured' },
  { value: 'LOUNGE', label: 'Casino lounge' },
]

/** The legacy Popconfirm's copy; the kit confirmation is danger-toned, as the legacy OK button was. */
export const DELETE_CONFIRM = {
  title: 'Delete category?',
  description: 'Are you sure you want to delete this category? This action cannot be undone.',
  confirmLabel: 'Delete',
  tone: 'danger',
} as const

export const SAVE_ERROR_FALLBACK = 'An error occurred while saving the category. Please try again.'

export function isMainCategory(value: unknown): value is MainCategory {
  return value === 'LIVE_CASINO' || value === 'CASINO' || value === 'SLOTS'
}

export function isCategoryType(value: unknown): value is CategoryType {
  return value === 'GENERAL' || value === 'TOP' || value === 'FEATURED' || value === 'LOUNGE'
}

export function isTypeFilter(value: unknown): value is TypeFilter {
  return value === 'ALL' || isCategoryType(value)
}

/* ---------- the categories list ---------- */

export function typeLabel(type: CategoryType): string {
  if (type === 'TOP') return 'Top'
  if (type === 'FEATURED') return 'Featured'
  if (type === 'LOUNGE') return 'Casino lounge'
  return 'General'
}

export function categoryStatusLabel(isActive: boolean): 'Active' | 'Inactive' {
  return isActive ? 'Active' : 'Inactive'
}

export function gamesCountLabel(gameCount: number | null | undefined): string {
  return `${gameCount ?? 0} games`
}

/** The type filter, then the legacy order: by `order`, a missing order counting as 999. */
export function filterCategories(categories: readonly CasinoCategory[], typeFilter: TypeFilter): CasinoCategory[] {
  const filtered = typeFilter === 'ALL' ? categories : categories.filter((c) => c.type === typeFilter)
  return [...filtered].sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
}

/** The rows in the order the drag list holds, dropping ids the latest data no longer has. */
export function rowsInOrder<T extends { id: string }>(ids: readonly string[], rows: readonly T[]): T[] {
  return ids.map((id) => rows.find((row) => row.id === id)).filter(Boolean) as T[]
}

export function categoryCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'category' : 'categories'} · Click a category to see its games`
}

/** The legacy drag end: the next order of ids, or null when the drop changes nothing. */
export function moveId(ids: readonly string[], activeId: string, overId: string | null | undefined): string[] | null {
  if (!overId || activeId === overId) return null
  const oldIndex = ids.findIndex((id) => id === activeId)
  const newIndex = ids.findIndex((id) => id === overId)
  if (oldIndex < 0 || newIndex < 0) return null
  const next = [...ids]
  const [moved] = next.splice(oldIndex, 1)
  next.splice(newIndex, 0, moved)
  return next
}

/** ReorderCasinoCategories input: every id with its 1-based position. */
export function categoryReorderInputs(ids: readonly string[]): Array<{ id: string; order: number }> {
  return ids.map((id, idx) => ({ id, order: idx + 1 }))
}

/**
 * The main category's whole order after a drag in the list as shown, or null when the drop changes nothing.
 *
 * With a Type filter on, the list holds only some of the categories, and numbering those 1..n gave them the
 * numbers of the ones the filter hid (a General 6 beside Featured Games 6), so the lobby order between them was
 * no longer the admin's. The shown categories keep the slots they hold in the whole order, in the order shown;
 * the dragged one moves to its drop target's place there, and every category is numbered. Unfiltered, this is
 * the plain move.
 */
export function categoryOrderAfterMove(
  allIds: readonly string[],
  shownIds: readonly string[],
  activeId: string,
  overId: string | null | undefined,
): string[] | null {
  const shown = new Set(shownIds)
  const inShownOrder = shownIds.filter((id) => allIds.includes(id))
  let next = 0
  const whole = allIds.map((id) => (shown.has(id) ? inShownOrder[next++] : id))
  return moveId(whole, activeId, overId)
}

/** The category's game ids in their saved order, keeping only the games GamesByIds returned. */
export function orderedGameIds(orderedIds: readonly unknown[], games: readonly CategoryGame[]): string[] {
  const gameIdSet = new Set(games.map((g) => g.id))
  return orderedIds.map(String).filter((id) => gameIdSet.has(id))
}

export function gameStatusLabel(tenantEnabled: boolean | undefined): 'Enabled' | 'Disabled' {
  return tenantEnabled !== false ? 'Enabled' : 'Disabled'
}

/** BEYOND-LEGACY: the keyboard reorder (dnd-kit's keyboard sensor) speaks names, not ids. */
export function reorderAnnouncement(
  event: 'start' | 'over' | 'end' | 'cancel',
  activeName: string,
  overName?: string | null,
): string {
  if (event === 'start') return `Picked up ${activeName}.`
  if (event === 'cancel') return `Moving ${activeName} was cancelled.`
  if (event === 'over') return overName ? `${activeName} is over ${overName}.` : `${activeName} is no longer over a row.`
  return overName ? `${activeName} was dropped over ${overName}.` : `${activeName} was dropped.`
}

/* ---------- statistics ---------- */

export interface CategoryStats {
  totalCategories: number
  activeCategories: number
  inactiveCategories: number
  totalGames: number
  topCount: number
  featuredCount: number
  activeRate: number
}

type StatsInput = Pick<CasinoCategory, 'type' | 'isActive' | 'gameCount'>

export function categoryStats(categories: readonly Partial<StatsInput>[], typeFilter: TypeFilter): CategoryStats {
  const filtered = typeFilter === 'ALL' ? categories : categories.filter((c) => c.type === typeFilter)
  const totalCategories = filtered.length
  const activeCategories = filtered.filter((c) => c.isActive).length
  const inactiveCategories = totalCategories - activeCategories
  const totalGames = filtered.reduce((sum, cat) => sum + (cat.gameCount ?? 0), 0)
  const topCount = filtered.filter((c) => c.type === 'TOP').length
  const featuredCount = filtered.filter((c) => c.type === 'FEATURED').length
  const activeRate = totalCategories > 0 ? Math.round((activeCategories / totalCategories) * 100) : 0
  return { totalCategories, activeCategories, inactiveCategories, totalGames, topCount, featuredCount, activeRate }
}

/* ---------- the create / edit drawer ---------- */

export function mainCategoryLabel(category?: MainCategory): string {
  if (!category) return 'Category'
  const labels: Record<MainCategory, string> = { LIVE_CASINO: 'Live Casino', CASINO: 'Casino', SLOTS: 'Slots' }
  return labels[category]
}

export function drawerTitle(mode: DrawerMode, initial?: CategoryDrawerInitial): string {
  if (mode === 'create') {
    return initial?.mainCategory ? `New ${mainCategoryLabel(initial.mainCategory)} Category` : 'New Casino Category'
  }
  return initial?.name ? `Edit Category - ${initial.name}` : 'Edit Category'
}

export function drawerHint(mode: DrawerMode): string {
  return mode === 'create'
    ? 'Create a new custom category for casino games'
    : 'Update category configuration and settings'
}

export function submitLabel(mode: DrawerMode): string {
  return mode === 'create' ? 'Create Category' : 'Save Changes'
}

/** The legacy Name field's slug, written into Slug only while the drawer opened without one. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

export function autoSlugEnabled(initial?: CategoryDrawerInitial): boolean {
  return !initial?.slug
}

export interface CategoryFormValues {
  mainCategory: string
  type: string
  name: string
  slug: string
  subtitle: string
  iconData: string | null
  isActive: boolean
}

/** The values each opening starts from (the legacy setFieldsValue on open). */
export function categoryFormInitialValues(initial?: CategoryDrawerInitial): CategoryFormValues {
  return {
    mainCategory: initial?.mainCategory ?? 'LIVE_CASINO',
    type: initial?.type ?? 'GENERAL',
    name: initial?.name ?? '',
    slug: initial?.slug ?? '',
    subtitle: initial?.subtitle ?? '',
    iconData: initial?.iconData ?? null,
    isActive: initial?.isActive ?? true,
  }
}

/* The legacy rules, one message per field: antd skipped `min` on an empty value, so an empty name says
   only "Enter category name". Like antd's `required`, a value of spaces passes. */
export const categoryFormSchema: z.ZodType<CategoryFormValues> = z
  .object({
    mainCategory: z.string(),
    type: z.string(),
    name: z.string(),
    slug: z.string(),
    subtitle: z.string(),
    iconData: z.string().nullable(),
    isActive: z.boolean(),
  })
  .superRefine((values, context) => {
    if (!isMainCategory(values.mainCategory)) {
      context.addIssue({ code: 'custom', path: ['mainCategory'], message: 'Select a main category' })
    }
    if (!isCategoryType(values.type)) {
      context.addIssue({ code: 'custom', path: ['type'], message: 'Select a category type' })
    }
    if (values.name === '') {
      context.addIssue({ code: 'custom', path: ['name'], message: 'Enter category name' })
    } else if (values.name.length < 2) {
      context.addIssue({ code: 'custom', path: ['name'], message: 'Name must be at least 2 characters' })
    }
    if (values.slug === '') {
      context.addIssue({ code: 'custom', path: ['slug'], message: 'Enter category slug' })
    }
  })

export interface IconState {
  /** What the drawer can show: a data URI or an external URL. */
  preview: string | null
  /** A value that only the save can carry: a freshly compressed data URI. */
  value: string | null
}

/* Icons are stored as data URIs (2026-11-04: no external file store). The backend returns a stored icon as its data
   URI, or an external URL as it was saved, and null for a legacy value it can no longer serve. Anything else is not an
   image the drawer can show, and it is never sent back: an unchanged icon is left as stored. */
export function initialIconState(iconData: string | null | undefined): IconState {
  if (!iconData) return { preview: null, value: null }
  if (iconData.startsWith('http://') || iconData.startsWith('https://') || iconData.startsWith('data:')) {
    return { preview: iconData, value: null }
  }
  return { preview: null, value: null }
}

export function isImageType(type: string): boolean {
  return type.startsWith('image/')
}

/**
 * The drawer's values as the mutations take them. The icon goes only when it changed: the freshly compressed one,
 * or null when the admin removed it. A stored icon is only the drawer's preview, so an unchanged one is not sent.
 */
export function categorySubmitValues(
  values: CategoryFormValues,
  iconValue: string | null,
  iconRemoved = false,
): CategorySubmitValues {
  return {
    mainCategory: values.mainCategory as MainCategory,
    type: values.type as CategoryType,
    subtitle: values.subtitle || undefined,
    name: values.name,
    slug: values.slug,
    iconData: iconRemoved ? null : iconValue || undefined,
    isActive: !!values.isActive,
  }
}

/**
 * UpdateCasinoCategory input, in the legacy key order. An emptied subtitle is sent as null, which clears it: a
 * missing key leaves the stored one, so clearing the field used to save nothing and still say "Category Updated".
 * The icon is null when removed and absent when unchanged.
 */
export function categoryUpdatePatch(values: CategorySubmitValues): Record<string, unknown> {
  return {
    mainCategory: values.mainCategory,
    name: values.name,
    slug: values.slug,
    subtitle: values.subtitle?.trim() ? values.subtitle : null,
    iconData: values.iconData,
    isActive: values.isActive,
    type: values.type,
  }
}

export interface ToastCopy {
  title: string
  message: string
  tone: 'ok' | 'error'
  duration: number
}

export function saveSuccessToast(mode: DrawerMode, name: string): ToastCopy {
  return mode === 'create'
    ? {
        title: 'Category Created',
        message: `Category "${name}" has been created successfully.`,
        tone: 'ok',
        duration: NOTIFICATION_DURATION_MS,
      }
    : {
        title: 'Category Updated',
        message: `Category "${name}" has been updated successfully.`,
        tone: 'ok',
        duration: NOTIFICATION_DURATION_MS,
      }
}

export function saveErrorToast(mode: DrawerMode, error: unknown): ToastCopy {
  const message = (error as { message?: unknown } | null | undefined)?.message
  return {
    title: mode === 'create' ? 'Failed to Create Category' : 'Failed to Update Category',
    message: (typeof message === 'string' && message) || SAVE_ERROR_FALLBACK,
    tone: 'error',
    duration: NOTIFICATION_DURATION_MS,
  }
}

export function iconErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message
  return (typeof message === 'string' && message) || 'Failed to process icon'
}
