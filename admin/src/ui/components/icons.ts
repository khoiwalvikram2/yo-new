/** One stroke width per rendered icon size, so a 12px icon and a 22px icon lay down the same optical
 * weight. The mockup sets the ramp in its own `strokeFor` (M:2014-2021) and never passes a stroke at
 * a call site; kit components and migrated pages do the same, so the weight cannot drift from one
 * page to the next.
 *
 * @tabler/icons-react takes it as `stroke`: `<IconUsers size={16} stroke={strokeFor(16)} />`.
 */
export function strokeFor(size: number): number {
  if (size <= 13) return 2
  if (size <= 16) return 1.75
  if (size <= 19) return 1.6
  return 1.45
}
