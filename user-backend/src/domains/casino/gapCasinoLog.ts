/**
 * Lightweight tracing for the GAP casino integration (game launch + seamless wallet
 * callbacks). Logs one line per event so every request/response is visible:
 *
 *   <prefix> <tag> <json>
 *   e.g.  [GapCasinoCallback] Debit:HandlerOut {"status":"OP_SUCCESS","balance":1400}
 *
 * Development-only and opt-in via GAP_DEBUG=1; production never emits it
 * (these callbacks can be high-volume — e.g. balance polls).
 */
const SENSITIVE_KEY =
  /token|secret|password|signature|authorization|credential|private.?key|api.?key|raw.?body|canonical|response.?str|response.?body|redirect.?url|launch.?url/i

function sanitize(value: unknown, key = '', seen = new WeakSet<object>()): unknown {
  if (SENSITIVE_KEY.test(key)) return '[redacted]'
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry, '', seen))
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      sanitize(entryValue, entryKey, seen),
    ])
  )
}

export function gapLog(prefix: string, tag: string, data: Record<string, unknown>): void {
  const enabled =
    process.env.NODE_ENV === 'development' &&
    /^(1|true|yes|on)$/i.test(process.env.GAP_DEBUG?.trim() ?? '')
  if (!enabled) return

  let payload: string
  try {
    payload = JSON.stringify(sanitize(data))
  } catch {
    payload = '[unserializable]'
  }
  console.log(`${prefix} ${tag} ${payload}`)
}
