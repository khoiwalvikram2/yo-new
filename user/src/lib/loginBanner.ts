/**
 * When the admin's User Panel Banners pop up (components/modals/LoginBannerModal.tsx); rules ported from gw.
 *
 * Pre-login: once per visit (this tab's session) to a visitor who is not signed in, once settings are loaded and the
 * saved session is restored, and never over the login/register dialog. What is remembered is a short fingerprint of
 * the banner, not the image (banners are data URIs of 60 KB and more), so a banner the admin changes shows again.
 *
 * Post-login: right after a sign-in made on this page (`signedInAt` from the auth context), once per sign-in; not for
 * a session restored on load and not while a forced password change is pending.
 */
export const PRE_LOGIN_BANNER_SEEN_KEY = 'mb_pre_login_banner_seen'

/** FNV-1a of the URL plus its length: enough to tell two banners apart, small enough to store. */
export function bannerFingerprint(url: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(36)}.${url.length}`
}

export function shouldShowPreLoginBanner(state: {
  url: string | null | undefined
  ready: boolean
  isAuthenticated: boolean
  authModalOpen: boolean
  /** The fingerprint of the banner already shown in this visit, if any. */
  seen: string | null
}): boolean {
  if (!state.url || !state.ready || state.isAuthenticated || state.authModalOpen) return false
  return state.seen !== bannerFingerprint(state.url)
}

export function shouldShowPostLoginBanner(state: {
  url: string | null | undefined
  signedInAt: number | null
  /** The sign-in the banner was last shown for. */
  handledSignInAt: number | null
  requirePasswordReset: boolean
}): boolean {
  return Boolean(state.url) && state.signedInAt !== null && state.signedInAt !== state.handledSignInAt && !state.requirePasswordReset
}

export function readSeenPreLoginBanner(storage: Pick<Storage, 'getItem'> | null): string | null {
  try {
    return storage?.getItem(PRE_LOGIN_BANNER_SEEN_KEY) ?? null
  } catch {
    return null
  }
}

export function rememberPreLoginBanner(url: string, storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(PRE_LOGIN_BANNER_SEEN_KEY, bannerFingerprint(url))
  } catch {
    // Blocked storage: the banner may show again on the next page load of this visit.
  }
}
