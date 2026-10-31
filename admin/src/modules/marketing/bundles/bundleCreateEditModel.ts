import { z } from 'zod'

/** Pure form and mutation contract for the bundle editor routes (W6 Task 174). */
export const BUNDLE_DOMAINS = ['casino', 'sports', 'matka'] as const
export type BundleDomain = (typeof BUNDLE_DOMAINS)[number]

export interface BundleRecord {
  id: string
  name: string
  description?: string | null
  domain: string
  gameIds?: readonly string[] | null
  gameWeights?: Readonly<Record<string, number>> | null
  gameCount?: number | null
}

export interface BundleFormValues {
  name: string
  description: string
  domain: BundleDomain
}

export interface CasinoGameBundleInput {
  name: string
  description?: string | null
  domain: BundleDomain
  gameIds: string[]
  gameWeights: Record<string, number>
}

export const EMPTY_BUNDLE_VALUES: BundleFormValues = {
  name: '',
  description: '',
  domain: 'casino',
}

export const bundleSchema = z.object({
  name: z
    .string()
    .min(1, 'Bundle name is required')
    .max(256, 'Bundle name must be between 1 and 256 characters'),
  description: z.string().max(1000, 'Description must be less than 1000 characters'),
  domain: z.enum(BUNDLE_DOMAINS),
})

export function bundleFormValues(record?: BundleRecord | null): BundleFormValues {
  if (!record) return { ...EMPTY_BUNDLE_VALUES }
  const domain = BUNDLE_DOMAINS.includes(record.domain as BundleDomain)
    ? record.domain as BundleDomain
    : 'casino'
  return {
    name: record.name ?? '',
    description: record.description ?? '',
    domain,
  }
}

export function selectedBundleGameIds(record?: BundleRecord | null): string[] {
  return (record?.gameIds ?? []).map(String)
}

/**
 * The legacy editor gave every selected game a weight of one, even when an edited bundle had
 * stored weights. Description keeps an untouched null/undefined, while an intentionally cleared
 * field sends the empty string the old antd control produced.
 */
export function buildBundleInput(
  values: BundleFormValues,
  selectedGameIds: readonly string[],
  originalDescription: string | null | undefined,
  descriptionTouched: boolean,
): CasinoGameBundleInput {
  const gameIds = selectedGameIds.map(String)
  const gameWeights = Object.fromEntries(gameIds.map((gameId) => [gameId, 1]))
  const description = values.description === '' && !descriptionTouched
    ? originalDescription
    : values.description
  return {
    name: values.name,
    description,
    domain: values.domain,
    gameIds,
    gameWeights,
  }
}

export interface BundleSaveResult {
  success?: boolean | null
  message?: string | null
}

export interface BundleToast {
  title: string
  message: string
  tone: 'ok' | 'error'
  duration: number
}

const NOTIFICATION_DURATION_MS = 4500

export function bundleSaveToast(result: BundleSaveResult | null | undefined, mode: 'create' | 'edit'): BundleToast {
  if (result?.success) {
    return {
      title: 'Success',
      message: result.message || (mode === 'edit' ? 'Bundle updated successfully' : 'Bundle created successfully'),
      tone: 'ok',
      duration: NOTIFICATION_DURATION_MS,
    }
  }
  return {
    title: 'Error',
    message: result?.message || (mode === 'edit' ? 'Failed to update bundle' : 'Failed to create bundle'),
    tone: 'error',
    duration: NOTIFICATION_DURATION_MS,
  }
}

export function bundleErrorToast(error: unknown): BundleToast {
  return {
    title: 'Error',
    message: error instanceof Error && error.message ? error.message : 'Failed to save bundle',
    tone: 'error',
    duration: NOTIFICATION_DURATION_MS,
  }
}

export const bundleSelectionToast = (): BundleToast => ({
  title: 'Error',
  message: 'Please select at least one game',
  tone: 'error',
  duration: NOTIFICATION_DURATION_MS,
})

