export function inCycleRange(at: Date, from: Date, to: Date): boolean {
  return at.getTime() >= from.getTime() && at.getTime() < to.getTime()
}
