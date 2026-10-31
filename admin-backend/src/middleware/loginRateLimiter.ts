/**
 * Brute-force protection for every login in this backend: admin, agent and CRM.
 *
 * Two budgets, because one guess and one spray are different attacks:
 *
 *   - per (address, identifier): a few tries at one account, which is what
 *     someone working a single password list looks like;
 *   - per address: many failures across *different* identifiers, which is what
 *     password spraying looks like and which the first budget cannot see,
 *     because every new username starts with a fresh allowance.
 *
 * State is per process and deliberately in memory. Behind several instances an
 * attacker gets one allowance per instance — a real limitation, but this sits in
 * front of per-account lockout in the database, which is shared, so it narrows
 * the window rather than being the only thing standing there.
 */

/** Failures allowed against one identifier from one address. */
const MAX_PER_IDENTIFIER = 5
/**
 * Failures allowed from one address across all identifiers.
 *
 * Generous on purpose: an office behind one NAT shares an address, and locking
 * a whole office out of the admin panel is its own outage. Thirty failures in
 * fifteen minutes is far beyond ordinary mistyping and far below a useful spray.
 */
const MAX_PER_ADDRESS = 30
const WINDOW_MS = 15 * 60 * 1000

/** Sweep expired entries at most this often, however busy the endpoint is. */
const SWEEP_INTERVAL_MS = 60 * 1000

interface AttemptRecord {
  count: number
  firstAttemptAt: number
}

const attempts = new Map<string, AttemptRecord>()
let lastSweptAt = 0

function key(ip: string, identifier: string): string {
  return `login:${ip}:${identifier}`
}

function addressKey(ip: string): string {
  return `addr:${ip}`
}

/**
 * Drops entries whose window has closed.
 *
 * Without this the map only ever grew: an entry expired "on the next check" of
 * that exact key, and an attacker trying each username once from each address
 * never checks the same key twice. That made unbounded memory growth reachable
 * by an unauthenticated caller — the very traffic this file exists to survive.
 */
function sweep(now: number): void {
  if (now - lastSweptAt < SWEEP_INTERVAL_MS) return
  lastSweptAt = now
  for (const [k, record] of attempts) {
    if (now >= record.firstAttemptAt + WINDOW_MS) attempts.delete(k)
  }
}

function retryMinutes(record: AttemptRecord, now: number): number {
  return Math.max(1, Math.ceil((record.firstAttemptAt + WINDOW_MS - now) / 60_000))
}

/** Reads a live record, clearing it first if its window has closed. */
function current(k: string, now: number): AttemptRecord | null {
  const record = attempts.get(k)
  if (!record) return null
  if (now >= record.firstAttemptAt + WINDOW_MS) {
    attempts.delete(k)
    return null
  }
  return record
}

/**
 * Throws if this caller has failed too often. Call at the start of any login
 * resolver, before the password is checked.
 */
export function checkLoginRateLimit(ip: string, identifier: string): void {
  const now = Date.now()
  sweep(now)

  const perIdentifier = current(key(ip, identifier), now)
  if (perIdentifier && perIdentifier.count >= MAX_PER_IDENTIFIER) {
    throw new Error(`Too many login attempts. Try again in ${retryMinutes(perIdentifier, now)} minutes.`)
  }

  const perAddress = current(addressKey(ip), now)
  if (perAddress && perAddress.count >= MAX_PER_ADDRESS) {
    throw new Error(`Too many login attempts. Try again in ${retryMinutes(perAddress, now)} minutes.`)
  }
}

function bump(k: string, now: number): void {
  const existing = attempts.get(k)
  if (!existing || now >= existing.firstAttemptAt + WINDOW_MS) {
    attempts.set(k, { count: 1, firstAttemptAt: now })
    return
  }
  existing.count++
}

/** Records a failure. Call after the credentials have been rejected. */
export function recordFailedLoginAttempt(ip: string, identifier: string): void {
  const now = Date.now()
  sweep(now)
  bump(key(ip, identifier), now)
  bump(addressKey(ip), now)
}

/**
 * Clears the identifier's budget after a successful sign-in.
 *
 * The address budget is deliberately left alone: one success does not explain
 * away failures against other accounts from the same place, and clearing it
 * would let an attacker reset the spray counter with any account they do hold.
 */
export function clearLoginAttempts(ip: string, identifier: string): void {
  attempts.delete(key(ip, identifier))
}

/** Number of live entries. Exported for tests. */
export function loginRateLimiterSize(): number {
  return attempts.size
}

/** Forgets everything. Exported for tests. */
export function resetLoginRateLimiter(): void {
  attempts.clear()
  lastSweptAt = 0
}

/** The limits, exported so tests assert against the real numbers. */
export const LOGIN_RATE_LIMITS = {
  maxPerIdentifier: MAX_PER_IDENTIFIER,
  maxPerAddress: MAX_PER_ADDRESS,
  windowMs: WINDOW_MS,
  sweepIntervalMs: SWEEP_INTERVAL_MS,
} as const
