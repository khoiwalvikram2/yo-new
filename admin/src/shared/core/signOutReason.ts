/**
 * Why the panel signed this tab out, carried across the reload to the sign-in page (SCO-08 follow-up, N003).
 *
 * A forced session end (a suspended agent, a deleted or deactivated admin, any session-invalid refusal) toasted
 * "Session ended" and then reloaded /login; the reload dropped the toast, so the sign-in page gave no reason. The
 * error link now records the reason in this tab's sessionStorage before the reload, and the sign-in page shows it
 * once and clears it. Storage that cannot be used only loses the notice: the sign-out itself never depends on it.
 */
const KEY = 'gw-admin-sign-out-reason'
/** Older than this, a recorded reason belongs to a sign-out whose sign-in page never came, and is not shown. */
const MAX_AGE_MS = 5 * 60_000

export type SignOutReason = 'session-ended' | 'session-expired' | 'tenant-changed'

export interface SignOutNotice {
  title: string
  text: string
}

export const SIGN_OUT_NOTICES: Record<SignOutReason, SignOutNotice> = {
  'session-ended': {
    title: 'Session ended',
    text: 'Your session is no longer valid, so you were signed out. Please sign in again.',
  },
  // B009: the token ran out (the session guard's sign-out, auth.ts handleSessionTimeout).
  'session-expired': {
    title: 'Session expired',
    text: 'Your session has expired, so you were signed out. Please sign in again.',
  },
  // T029: the tenant stored in this browser was not this admin's (another session's sign-in), so the server refused
  // every request; the error link cleared it and signed out (api.ts).
  'tenant-changed': {
    title: 'Signed out',
    text: 'This browser held another whitelabel from an earlier sign-in, so you were signed out. Please sign in again.',
  },
}

export function rememberSignOutReason(reason: SignOutReason, now: number = Date.now()): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ reason, at: now }))
  } catch {
    // No storage (private mode, blocked): the toast before the reload is all the admin gets.
  }
}

/** The notice for the reason recorded in this tab, if there is a recent one. Reading leaves it in place. */
export function readSignOutNotice(now: number = Date.now()): SignOutNotice | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const { reason, at } = JSON.parse(raw) as { reason?: unknown; at?: unknown }
    if (typeof at !== 'number' || now - at > MAX_AGE_MS) return null
    return reason === 'session-ended' || reason === 'session-expired' || reason === 'tenant-changed' ? SIGN_OUT_NOTICES[reason] : null
  } catch {
    return null
  }
}

/**
 * Set in a document that has started a full load of /login (the error link's forced sign-out). Its route guard shows
 * the sign-in page client-side before that load lands, and that page must not use up the reason: with the sign-in
 * chunk already loaded and a real network round trip, it cleared the reason first and the reloaded page showed none.
 * The document the load brings starts without the flag, shows the reason and clears it.
 */
let reloadPending = false

/** This document is about to be replaced by a full load of the sign-in page: leave the reason for that page. */
export function keepSignOutReasonForReload(): void {
  reloadPending = true
}

/** Forgets the recorded reason: the sign-in page shows it once. */
export function clearSignOutReason(): void {
  if (reloadPending) return
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}
