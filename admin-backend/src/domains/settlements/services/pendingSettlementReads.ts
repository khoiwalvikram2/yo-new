type SettlementDateRow = { agentId: string; status: string; createdAt: Date | string | null }

/** Rows retain listBatch's createdAt-desc order. Match each old list(agentId):
 * choose its first POSTED row, otherwise its first row; do not skip an invalid
 * chosen date in favour of an older row. */
export function pendingLastSettlementDates(rows: readonly SettlementDateRow[]): Map<string, Date> {
  const selected = new Map<string, SettlementDateRow>()
  for (const row of rows) {
    const previous = selected.get(row.agentId)
    if (!previous || (previous.status !== 'POSTED' && row.status === 'POSTED')) selected.set(row.agentId, row)
  }
  const dates = new Map<string, Date>()
  for (const [id, row] of selected) {
    if (!row.createdAt) continue
    const date = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)
    if (!Number.isNaN(date.getTime())) dates.set(id, date)
  }
  return dates
}
