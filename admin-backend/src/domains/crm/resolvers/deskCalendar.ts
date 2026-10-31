import {
  requireCrmPermission,
  requireCrmUser,
  requireCrmWrite,
  type CrmContext,
} from '@src/domains/crm/guards.js'
import {
  getDeskCalendar,
  updateDeskCalendar,
  type CrmDeskCalendar,
} from '@src/repos/crm/CrmSettingsRepo.js'
import { getDeskHours, isDeskOpen } from '@src/repos/crm/CrmTasksRepo.js'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'

/**
 * The desk's working calendar.
 *
 * Owned by the whitelabel rather than by Super Admin. Super Admin's gate is
 * commercial — is there a CRM, and how many seats — while these are operational:
 * when does this team work. Session idle timeout and the IP allowlist stay with
 * Super Admin, because those are the settings a whitelabel has an incentive to
 * weaken.
 *
 * The values matter more than a settings screen usually suggests. Every task's
 * `dueAt` and `breachAt` are computed through `addWorkingMinutes` against this
 * calendar, and `runEscalationSweep` refuses to advance the ladder outside it.
 * A desk on the wrong hours does not merely display wrongly — it reports
 * breaches that were nobody's fault, which is exactly the noise Desk health
 * exists to cut through.
 */

/** Minutes in a day. A close of 1440 is midnight, and is allowed. */
const DAY_MINUTES = 1440

/**
 * Whether a string is a time zone this runtime actually knows.
 *
 * Not defensive tidying. `localParts` builds an `Intl.DateTimeFormat` with
 * whatever is stored and a bad identifier throws `RangeError` — inside
 * `addWorkingMinutes`, which is inside `createTask` and inside the escalation
 * sweep. One rejected string here is one tenant that keeps being able to create
 * tasks.
 */
function isKnownTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

type CalendarInput = {
  timezone: string
  openMinute: number
  closeMinute: number
  days: number[]
}

/**
 * Checks a calendar, returning the message to show or null when it is fine.
 *
 * Every rule here refuses rather than clamping, because each failure it catches
 * is silent: a desk whose hours are empty or inverted is never open, and a desk
 * that is never open escalates nothing and reports no reason.
 */
function validate(input: CalendarInput): { error: string } | { calendar: CrmDeskCalendar } {
  if (!isKnownTimezone(input.timezone)) {
    return { error: 'That is not a time zone this server recognises, e.g. Asia/Kolkata' }
  }

  const open = Number(input.openMinute)
  const close = Number(input.closeMinute)
  if (!Number.isInteger(open) || !Number.isInteger(close) || open < 0 || close > DAY_MINUTES) {
    return { error: 'Opening and closing times must fall within the day' }
  }
  if (open >= close) {
    return { error: 'The desk must open before it closes' }
  }

  const days = Array.from(new Set((input.days ?? []).map(Number))).sort((a, b) => a - b)
  if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    return { error: 'Choose at least one working day, Monday (1) to Sunday (7)' }
  }

  return { calendar: { timezone: input.timezone, openMinute: open, closeMinute: close, days } }
}

export const crmSettingsQueries = {
  crmDeskCalendar: async (_: unknown, __: unknown, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.settings', 'view')
    const user = requireCrmUser(ctx)

    // Falls back to the same defaults `getDeskHours` applies, so the screen
    // shows what the SLA engine is actually using rather than blanks.
    const stored = await getDeskCalendar(user.tenant)
    const hours = await getDeskHours(user.tenant)
    const calendar = stored ?? {
      timezone: hours.timezone,
      openMinute: hours.openMinute,
      closeMinute: hours.closeMinute,
      days: hours.days,
    }

    return {
      ...calendar,
      // Answered here rather than in the browser: "is the desk open" depends on
      // the desk's timezone, not the viewer's, and a supervisor checking from
      // another country would otherwise be told about their own clock.
      isOpenNow: isDeskOpen(new Date(), hours),
    }
  },
}

export const crmSettingsMutations = {
  crmSetDeskCalendar: async (_: unknown, args: CalendarInput, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.settings', 'manage')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    const checked = validate(args)
    if ('error' in checked) return { ok: false, error: checked.error }

    // No tenant argument anywhere in this file: the token decides, as it does
    // for every other CRM operation.
    const done = await updateDeskCalendar(user.tenant, checked.calendar, `crm:${user.id}`)
    if (!done) return { ok: false, error: 'The CRM is not enabled for this whitelabel' }

    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'set_desk_calendar',
      resourceType: 'crm_whitelabel_settings',
      resourceId: user.tenant,
      before: checked.calendar,
    }).catch(() => {})

    return { ok: true, error: null }
  },
}
