export function validBundleIds(ids: readonly unknown[] | undefined, domain: string): string[] {
  if (!Array.isArray(ids)) return []
  return ids.map((id) => {
    if (typeof id === 'number') return String(id)
    if (typeof id !== 'string') return null
    const value = id.trim()
    if (domain === 'matka') return value && value !== 'null' && value !== 'undefined' ? value : null
    return Number(value) > 0 ? value : null
  }).filter((value): value is string => value !== null && value !== '')
}

export function bundleWeightRecord(source: Record<string, unknown> | null | undefined, ids: readonly string[]) {
  const weights: Record<string, number> = {}
  for (const [id, value] of Object.entries(source || {})) {
    const number = Number(value)
    weights[id] = Number.isFinite(number) ? number : 1
  }
  for (const id of ids) if (!(id in weights)) weights[id] = 1
  return weights
}

export function bundleWeightsChanged(local: Record<string, number>, original: Record<string, number>) {
  const keys = Object.keys(local)
  return keys.length !== Object.keys(original).length || keys.some((id) => !(id in original) || Math.abs(local[id] - original[id]) > 0.001)
}

export function clampBundleWeight(value: number | null) {
  return value !== null && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
}
