export interface DiffEntry {
  key: string
  type: 'added' | 'removed' | 'modified' | 'unchanged'
  oldValue?: unknown
  newValue?: unknown
}

export interface ChangeCounts {
  added: number
  removed: number
  modified: number
}

/**
 * Safely parse JSON; returns empty object on invalid input.
 */
function safeParseJson(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return {}
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) return val as Record<string, unknown>
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * Computes a structured diff between two JSON objects.
 */
export function computeDiff(before: unknown, after: unknown): DiffEntry[] {
  const diff: DiffEntry[] = []

  if (!before && !after) return diff

  const beforeObj = safeParseJson(before)
  const afterObj = safeParseJson(after)

  const allKeys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])

  for (const key of allKeys) {
    const oldVal = beforeObj[key]
    const newVal = afterObj[key]

    if (oldVal === undefined && newVal !== undefined) {
      diff.push({ key, type: 'added', newValue: newVal })
    } else if (oldVal !== undefined && newVal === undefined) {
      diff.push({ key, type: 'removed', oldValue: oldVal })
    } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff.push({ key, type: 'modified', oldValue: oldVal, newValue: newVal })
    } else {
      diff.push({ key, type: 'unchanged', oldValue: oldVal, newValue: newVal })
    }
  }

  return diff
}

/**
 * Counts the number of added, removed, and modified entries in a diff.
 */
export function countChanges(diff: DiffEntry[]): ChangeCounts {
  return diff.reduce(
    (acc, entry) => {
      if (entry.type === 'added') acc.added++
      else if (entry.type === 'removed') acc.removed++
      else if (entry.type === 'modified') acc.modified++
      return acc
    },
    { added: 0, removed: 0, modified: 0 },
  )
}

/**
 * Returns a unified diff string showing the changes between two JSON objects.
 */
export function getUnifiedDiff(before: unknown, after: unknown): string {
  const diff = computeDiff(before, after)
  const lines: string[] = []

  for (const entry of diff) {
    switch (entry.type) {
      case 'added':
        lines.push(`+ ${entry.key}: ${formatValue(entry.newValue)}`)
        break
      case 'removed':
        lines.push(`- ${entry.key}: ${formatValue(entry.oldValue)}`)
        break
      case 'modified':
        lines.push(`- ${entry.key}: ${formatValue(entry.oldValue)}`)
        lines.push(`+ ${entry.key}: ${formatValue(entry.newValue)}`)
        break
      default:
        lines.push(`  ${entry.key}: ${formatValue(entry.oldValue)}`)
        break
    }
  }

  return lines.join('\n')
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
