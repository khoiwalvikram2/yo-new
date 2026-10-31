import bcrypt from 'bcryptjs'
import { hashPassword, signJwt, verifyPassword, verifyJwt } from '@src/domains/common/auth.js'
import { getCrmSettings } from '@src/repos/crm/CrmSettingsRepo.js'
import {
  findCrmUserByUsername,
  getCrmUserById,
  getCrmUserPermissions,
  recordCrmLoginFailure,
  recordCrmLoginSuccess,
  touchCrmUserSeen,
} from '@src/repos/crm/CrmUsersRepo.js'
import {
  isCrmIpAllowed,
  recordCrmLoginAttempt,
  type CrmLoginFailureReason,
} from '@src/repos/crm/CrmSecurityRepo.js'

/** Failures before the account is held shut, and for how long. */
const MAX_FAILED_ATTEMPTS = 8
const LOCK_MINUTES = 15

/**
 * A bcrypt hash of a value nobody knows, compared against when the username
 * matches nothing.
 *
 * Without it, an unknown username returns in about a millisecond and a known
 * one takes the ~200ms bcrypt costs, which tells anyone measuring which of
 * their guesses are real accounts. Doing the work anyway makes both paths cost
 * the same.
 */
const DUMMY_HASH = bcrypt.hashSync('crm-timing-equaliser', 10)

export type CrmLoginResult =
  | {
      ok: true
      token: string
      user: {
        id: string
        name: string
        email: string | null
        status: string
        requirePasswordReset: boolean
      }
      permissions: Array<{ domain: string; actions: string[] }>
      sessionIdleMinutes: number
    }
  | { ok: false; reason: CrmLoginFailureReason }

/**
 * Signs a CRM user in.
 *
 * Every rejection returns the same message to the caller. The `reason` is for
 * the audit trail, not for the sign-in screen: telling someone that a username
 * exists but the password is wrong hands them half the credential.
 */
export async function crmLogin(input: {
  tenant: string
  username: string
  password: string
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<CrmLoginResult> {
  const { tenant, username, password } = input
  const audit = (reason: CrmLoginFailureReason | null, success: boolean, crmUserId?: string | null) =>
    recordCrmLoginAttempt({
      tenant,
      crmUserId: crmUserId ?? null,
      username,
      success,
      reason,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    })

  // The whitelabel's gate comes first: a tenant whose CRM was never enabled has
  // no accounts to reason about.
  const settings = await getCrmSettings(tenant)
  if (!settings || !settings.enabled) {
    await bcrypt.compare(password, DUMMY_HASH)
    await audit('crm_disabled', false)
    return { ok: false, reason: 'crm_disabled' }
  }

  const found = await findCrmUserByUsername(tenant, username)
  if (!found) {
    await bcrypt.compare(password, DUMMY_HASH)
    await audit('unknown_user', false)
    return { ok: false, reason: 'unknown_user' }
  }

  const { user, credentials } = found

  if (credentials.lockedUntil && credentials.lockedUntil.getTime() > Date.now()) {
    await audit('locked', false, user.id)
    return { ok: false, reason: 'locked' }
  }

  if (user.status === 'SUSPENDED') {
    await audit('suspended', false, user.id)
    return { ok: false, reason: 'suspended' }
  }

  if (settings.enforceIpAllowlist) {
    const allowed = await isCrmIpAllowed(tenant, user.id, input.ipAddress)
    if (!allowed) {
      await audit('ip_blocked', false, user.id)
      return { ok: false, reason: 'ip_blocked' }
    }
  }

  const matches = await verifyPassword(password, credentials.passwordHash)
  if (!matches) {
    await recordCrmLoginFailure(user.id, {
      maxAttempts: MAX_FAILED_ATTEMPTS,
      lockMinutes: LOCK_MINUTES,
    })
    await audit('bad_password', false, user.id)
    return { ok: false, reason: 'bad_password' }
  }

  await recordCrmLoginSuccess(user.id)
  await audit(null, true, user.id)

  const permissions = await getCrmUserPermissions(user.id)
  const token = signJwt({
    sub: user.id,
    name: user.name,
    roles: [],
    type: 'crm',
    crmUserId: user.id,
    tenant,
    v: user.tokenVersion,
  })

  return {
    ok: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      requirePasswordReset: user.requirePasswordReset,
    },
    permissions,
    sessionIdleMinutes: settings.sessionIdleMinutes,
  }
}

/** The one message the sign-in screen ever shows, whatever actually went wrong. */
export const CRM_LOGIN_FAILED_MESSAGE = 'Invalid username or password'

export type CrmAuthContext = {
  crmUser?: {
    id: string
    name: string
    tenant: string
    status: string
    requirePasswordReset: boolean
  }
  permissions?: Array<{ domain: string; actions: string[] }>
}

/**
 * Rebuilds a CRM caller's identity from their token on every request.
 *
 * Nothing here trusts the token beyond the id it names. Status, token version
 * and permissions are all re-read, so suspending a user, changing their roles,
 * or turning the whitelabel's CRM off takes effect on their next request rather
 * than whenever the JWT expires.
 *
 * Returns `{}` for every failure. A caller with no `crmUser` is unauthenticated,
 * which is the correct outcome for a token that is expired, forged, revoked, or
 * belongs to a tenant other than the host being addressed.
 */
export async function buildCrmAuthContext(
  req: { headers?: Record<string, unknown> },
  tenant: string
): Promise<CrmAuthContext> {
  const header = req.headers?.authorization
  if (typeof header !== 'string') return {}
  const [scheme, value] = header.split(' ')
  if (scheme !== 'Bearer' || !value) return {}

  const payload = verifyJwt(value)
  if (!payload || payload.type !== 'crm' || !payload.sub) return {}

  // The token names its own tenant. If that disagrees with the host being
  // addressed, the token is not valid here — this is what stops a token minted
  // on one whitelabel's CRM from being replayed against another's.
  if (payload.tenant && payload.tenant !== tenant) return {}

  const user = await getCrmUserById(tenant, payload.sub)
  if (!user) return {}
  if (user.status === 'SUSPENDED') return {}

  const tokenVersion = Number(payload.v)
  if (Number.isFinite(tokenVersion) && tokenVersion !== user.tokenVersion) return {}

  // Super Admin can revoke a whole whitelabel's CRM; existing sessions end too.
  const settings = await getCrmSettings(tenant)
  if (!settings || !settings.enabled) return {}

  // Keep "last seen" meaning what it says. Throttled to once a minute:
  // without it this would be a write on every single request, and with nothing
  // at all the column only ever meant "last signed in".
  const seenAgo = user.lastSeenAt ? Date.now() - user.lastSeenAt.getTime() : Infinity
  if (seenAgo > 60_000) {
    touchCrmUserSeen(user.id).catch(() => {})
  }

  const permissions = await getCrmUserPermissions(user.id)
  return {
    crmUser: {
      id: user.id,
      name: user.name,
      tenant,
      status: user.status,
      requirePasswordReset: user.requirePasswordReset,
    },
    permissions,
  }
}

// The INACTIVE gate lives in `requireCrmWrite` (domains/crm/guards.ts), which
// every CRM mutation calls. A second copy of it used to sit here with no
// callers — two guards where one drifts is worse than one guard.

export { hashPassword as hashCrmPassword }
