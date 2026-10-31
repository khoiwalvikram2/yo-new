import { useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useFeatureFlags } from '@/hooks/useAppSettings'
import { trackReferralClick } from '@/lib/api/user'

/**
 * Referral Redirect Page
 *
 * Handles referral links in the format: /r?ref=CODE
 *
 * This page:
 * 1. Tracks the click (trackReferralClick) for analytics
 * 2. Stores the referral code in localStorage for later use during registration
 * 3. Redirects to home page (which will open register modal if needed)
 */
export default function ReferralRedirect() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { openAuthModal } = useAuth()
  const features = useFeatureFlags()
  const registerEnabled = features.registerEnabled ?? true

  useEffect(() => {
    const refCode = searchParams.get('ref')
    const utmSource = searchParams.get('utm_source') ?? undefined
    const utmMedium = searchParams.get('utm_medium') ?? undefined
    const utmCampaign = searchParams.get('utm_campaign') ?? undefined

    if (refCode) {
      // Track click (best-effort, non-blocking)
      trackReferralClick({
        code: refCode.trim().toUpperCase(),
        utmSource,
        utmMedium,
        utmCampaign,
      }).catch(() => {})

      // Store referral code in localStorage for later use during registration
      try {
        const referralData = {
          code: refCode.trim().toUpperCase(),
          timestamp: Date.now(),
          expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
        }
        localStorage.setItem('referral_code', JSON.stringify(referralData))

        const newUrl = new URL(window.location.href)
        newUrl.pathname = '/'
        newUrl.searchParams.set('ref', refCode)

        navigate(newUrl.pathname + newUrl.search, { replace: true })

        // Only auto-open register when the whitelabel allows it; otherwise just land on home.
        if (registerEnabled) {
          setTimeout(() => {
            openAuthModal('register')
          }, 100)
        }
      } catch {
        navigate('/', { replace: true })
      }
    } else {
      navigate('/', { replace: true })
    }
  }, [searchParams, navigate, openAuthModal, registerEnabled])

  // Show loading state while redirecting
  return (
    <div className="flex items-center justify-center min-h-screen" aria-live="polite" aria-label={t('referral.redirecting')}>
      <div className="text-center">
        <div className="animate-spin rounded-[5px] h-12 w-12 border-b-2 border-[color:var(--primary)] mx-auto mb-4" aria-hidden />
        <p className="text-[color:var(--text)]">{t('referral.redirecting')}</p>
      </div>
    </div>
  )
}
