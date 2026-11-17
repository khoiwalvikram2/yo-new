import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useAppSettings } from '@/lib/app-settings'
import { readSeenPreLoginBanner, rememberPreLoginBanner, shouldShowPostLoginBanner, shouldShowPreLoginBanner } from '@/lib/loginBanner'
import ModalSurface from './ModalSurface'
import './login-banner.css'

type Showing = { kind: 'pre' | 'post'; url: string } | null

const sessionStore = () => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** The admin's User Panel Banners as popups (App Configuration → Branding & Theme); rules in lib/loginBanner.ts. */
export default function LoginBannerModal() {
  const { t } = useTranslation()
  const { isAuthenticated, isHydrating, isAuthModalOpen, signedInAt, user } = useAuth()
  const { parsedSettings, isLoading } = useAppSettings()
  const [showing, setShowing] = useState<Showing>(null)
  const handledSignIn = useRef<number | null>(null)
  const pre = parsedSettings.preLoginBannerUrl ?? null
  const post = parsedSettings.postLoginBannerUrl ?? null
  const requirePasswordReset = Boolean(user?.requirePasswordReset)

  useEffect(() => {
    if (showing) return
    if (!post && signedInAt !== null && !requirePasswordReset) handledSignIn.current = signedInAt
    if (post && shouldShowPostLoginBanner({ url: post, signedInAt, handledSignInAt: handledSignIn.current, requirePasswordReset })) {
      handledSignIn.current = signedInAt
      setShowing({ kind: 'post', url: post })
      return
    }
    if (pre && shouldShowPreLoginBanner({ url: pre, ready: !isLoading && !isHydrating, isAuthenticated, authModalOpen: isAuthModalOpen, seen: readSeenPreLoginBanner(sessionStore()) })) {
      rememberPreLoginBanner(pre, sessionStore())
      setShowing({ kind: 'pre', url: pre })
    }
  }, [showing, pre, post, signedInAt, requirePasswordReset, isLoading, isHydrating, isAuthenticated, isAuthModalOpen])

  // A visitor who opens the login dialog or signs in while the pre-login banner is up no longer needs it.
  useEffect(() => {
    if (showing?.kind === 'pre' && (isAuthenticated || isAuthModalOpen)) setShowing(null)
    if (showing?.kind === 'post' && !isAuthenticated) setShowing(null)
  }, [showing, isAuthenticated, isAuthModalOpen])

  if (!showing) return null
  const title = showing.kind === 'pre'
    ? t('banner.preLogin', { defaultValue: 'Announcement' })
    : t('banner.postLogin', { defaultValue: 'Welcome' })
  const close = () => setShowing(null)
  return (
    <ModalSurface open onClose={close} title={title} titleId="mb-login-banner-title" hideHeader size="lg" className="mb-login-banner">
      <h2 id="mb-login-banner-title" className="sr-only">{title}</h2>
      <button type="button" className="mb-login-banner-close" aria-label={t('common.close')} onClick={close} autoFocus>
        <X size={20} aria-hidden="true" />
      </button>
      <img className="mb-login-banner-image" src={showing.url} alt={title} onError={close} />
    </ModalSurface>
  )
}
