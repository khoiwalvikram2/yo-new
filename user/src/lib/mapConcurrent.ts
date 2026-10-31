/** Preserve input order while keeping the number of active reads bounded. */
export async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, read: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, Math.trunc(concurrency) || 1)) }, async () => {
    while (next < items.length) {
      const index = next++
      result[index] = await read(items[index], index)
    }
  }))
  return result
}
