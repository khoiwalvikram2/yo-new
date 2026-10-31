/**
 * Recharts passes tooltip/label values as `ValueType | undefined`
 * (number | string | Array<number | string> | undefined), not `number`.
 * Coerce defensively so formatters stay type-safe and never render NaN.
 */
export function toChartNumber(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value
  const n = Number(raw ?? 0)
  return Number.isFinite(n) ? n : 0
}
