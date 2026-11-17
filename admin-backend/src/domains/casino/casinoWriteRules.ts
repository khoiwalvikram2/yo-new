/**
 * Input rules for casino admin writes, kept out of the resolvers so they can be
 * tested without a database.
 */

export interface BetSettingsValues {
  minStake?: number | null
  maxStake?: number | null
  maxWin?: number | null
}

const MONEY_FIELDS: Array<[keyof BetSettingsValues, string]> = [
  ['minStake', 'Minimum stake'],
  ['maxStake', 'Maximum stake'],
  ['maxWin', 'Max win'],
]

/**
 * Why a bet-settings row cannot be saved, or null when it can.
 *
 * Nothing checked these before: a minimum of 100 over a maximum of 10 was
 * stored with "Bet setting added successfully!", and the player side then
 * refused every stake on that game with only "Bet limit" to go on. Negative
 * amounts were stored as well; only the admin form's number field clamped them.
 */
export function betSettingsProblem(values: BetSettingsValues | null | undefined): string | null {
  if (!values) return null
  for (const [field, label] of MONEY_FIELDS) {
    const value = values[field]
    if (value == null) continue
    if (!Number.isFinite(Number(value))) return `${label} must be a number`
    if (Number(value) < 0) return `${label} cannot be negative`
  }
  const { minStake, maxStake } = values
  if (minStake != null && maxStake != null && Number(minStake) > Number(maxStake)) {
    return `Minimum stake (${Number(minStake)}) cannot be above the maximum stake (${Number(maxStake)})`
  }
  return null
}

const MAIN_CATEGORY_LABELS: Record<string, string> = {
  LIVE_CASINO: 'Live Casino',
  CASINO: 'Casino',
  SLOTS: 'Slots',
  live_casino: 'Live Casino',
  casino: 'Casino',
  slots: 'Slots',
}

const CATEGORY_SLUG_INDEX = 'casino_categories_tenant_main_slug_unique'

/**
 * The message for a category write that hit the (tenant, main category, slug)
 * unique index, or null for any other error.
 *
 * The driver's own message is the failed statement with its parameters, which
 * reached the admin's toast verbatim.
 */
export function duplicateCategorySlugMessage(
  error: unknown,
  slug: string | null | undefined,
  mainCategory: string | null | undefined,
): string | null {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null
  const code = e?.code ?? e?.cause?.code
  const constraint = e?.constraint ?? e?.cause?.constraint
  if (code !== '23505') return null
  if (constraint && constraint !== CATEGORY_SLUG_INDEX) return null
  const where = mainCategory && MAIN_CATEGORY_LABELS[mainCategory] ? ` in ${MAIN_CATEGORY_LABELS[mainCategory]}` : ''
  return slug
    ? `A category with slug "${slug}" already exists${where}`
    : `A category with this slug already exists${where}`
}
