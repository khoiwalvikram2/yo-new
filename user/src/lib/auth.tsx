/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { AuthContextType, AuthProviderProps, User } from '@/types'
import { setUnauthorizedHandler, setAuthTokenGetter } from '@/lib/http'
import { setGraphqlAuthTokenGetter, setGraphqlUnauthorizedHandler } from '@/lib/graphqlClient'
import * as userBackend from '@/lib/api/userBackend'
import { getUserDetail } from '@/lib/api/user'
import { useSetAtom } from 'jotai'
import { userAtom as authUserAtom, tokenAtom as authTokenAtom, isAuthModalOpenAtom as authModalOpenAtom } from '@/state/authAtoms'
import { requestWithToast } from '@/lib/request'
import { notify } from '@/lib/notify'
import { tokenService } from '@/lib/tokenService'

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/** Must match Topbar: which wallet chip is shown; not the same as API walletType "1"|"2". */
const TOPBAR_SELECTED_WALLET_KEY = 'stakex_selected_wallet'
const TOPBAR_WALLET_VALUES = new Set(['balance', 'bonus', 'referralBonus'])

/** Set default from server only when there is no valid UI choice (first visit / legacy "1"|"2" in storage). */
function seedTopbarWalletFromServerIfUnset(walletType: string | undefined) {
  try {
    const cur = localStorage.getItem(TOPBAR_SELECTED_WALLET_KEY)
    if (cur && TOPBAR_WALLET_VALUES.has(cur)) return
    const mapped = walletType === '2' ? 'bonus' : 'balance'
    localStorage.setItem(TOPBAR_SELECTED_WALLET_KEY, mapped)
  } catch (_) {
    /* ignore */
  }
}

function normalizeUser(data?: Partial<User> | null): User | null {
  if (!data) return null
  return {
    id: data.id || '',
    username: data.username || (data as any).name || 'User',
    phone: data.phone || '',
    level: data.level ?? 1,
    balance: Number(data.balance || 0),
    bonusBalance: Number(data.bonusBalance || 0),
    exposure: Number((data as any)?.exposure || 0),
    walletType: (data.walletType as any) === '2' ? '2' : '1',
    affiliateCode: data.affiliateCode,
    referralBalance: data.referralBalance != null ? Number(data.referralBalance) : undefined,
    referralBonusBalance: (data as any).referralBonusBalance != null ? Number((data as any).referralBonusBalance) : undefined,
    playerType: (data as any).playerType || 'REGULAR', // Preserve playerType for credit player detection
    creditAvailable: Number((data as any).creditAvailable ?? 0),
    creditLimit: Number((data as any).creditLimit ?? 0),
    creditUsed: Number((data as any).creditUsed ?? 0),
    requirePasswordReset: !!(data as any).requirePasswordReset,
  }
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [, setExposureState] = useState<number>(0)
  const [isHydrating, setIsHydrating] = useState(true)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login')
  const [_otpStore, setOtpStore] = useState<Record<string, string>>({})
  const [pendingRegistrations, setPendingRegistrations] = useState<
    Record<string, { username: string; password: string; confirmPassword: string; affiliateCode?: string }>
  >({})
  const setUserAtom = useSetAtom(authUserAtom)
  const setTokenAtom = useSetAtom(authTokenAtom)
  const setModalOpen = useSetAtom(authModalOpenAtom)

  // Setup HTTP hooks and hydrate session on mount
  useEffect(() => {
    let active = true

    const clearAuth = () => {
      setUser(null)
      try {
        localStorage.removeItem('stakex_user')
        localStorage.removeItem('token')
      } catch (_) {}
      setUserAtom(null)
      setTokenAtom(null)
    }

    setUnauthorizedHandler(clearAuth)
    setGraphqlUnauthorizedHandler(clearAuth)
    const tokenGetterFn = () => {
      try {
        return localStorage.getItem('token')
      } catch (_) {
        return null
      }
    }
    setAuthTokenGetter(tokenGetterFn)
    setGraphqlAuthTokenGetter(tokenGetterFn)

    const hydrateSession = async () => {
      try {
        const token = localStorage.getItem('token')

        // A cached profile is display data, not proof of authentication. Never
        // expose protected UI until a present, locally valid token has also
        // been accepted by the backend.
        if (!token || tokenService.isTokenExpired(token)) {
          clearAuth()
          return
        }

        const profile = await userBackend.getMe()
        const hydratedUser = normalizeUser(profile)
        if (!hydratedUser) {
          clearAuth()
          return
        }

        if (!active) return
        setUser(hydratedUser)
        setExposureState(Number(hydratedUser.exposure || 0))
        try {
          localStorage.setItem('stakex_user', JSON.stringify(hydratedUser))
        } catch (_) {}
        setUserAtom(hydratedUser)
        setTokenAtom(token)

        // Refresh the richer wallet/exposure data after the authenticated
        // profile has been established. These remain non-blocking.
        updateExposureFromUserData()
        syncWalletFromDetail()
      } catch (_) {
        // Initial session validation is deliberately fail-closed. A cached
        // user must never survive a rejected, revoked, or unreachable getMe.
        if (active) clearAuth()
      } finally {
        if (active) setIsHydrating(false)
      }
    }

    hydrateSession()
    return () => {
      active = false
    }
  }, [setTokenAtom, setUserAtom])

  // Auto-refresh balance on window focus/visibility regained
  useEffect(() => {
    const onFocus = () => { refreshUser() }
    const onVisibility = () => { if (document.visibilityState === 'visible') refreshUser() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // Listen for single-device enforcement: when the player logs in on another
  // device/browser, the backend invalidates the current token and the GraphQL
  // client dispatches a 'session-replaced' event so we can show a clear message.
  // Multiple in-flight requests may all fail at once, so debounce to show only once.
  useEffect(() => {
    let shown = false
    const handleSessionReplaced = () => {
      if (shown) return
      shown = true
      notify.warning('Your account has been logged in from another device. You have been logged out.')
      setTimeout(() => { shown = false }, 10000)
    }
    window.addEventListener('session-replaced', handleSessionReplaced)
    return () => window.removeEventListener('session-replaced', handleSessionReplaced)
  }, [])

  // Pull exposure specifically from getUserData (ibf-goa-user parity)
  const updateExposureFromUserData = async () => {
    try {
      const ud = await userBackend.getUserData()
      const exp = ud ? Number((ud as any)?.exposure || 0) : 0
      setExposureState(exp)
      setUser(prev => {
        if (!prev) return prev
        const next = { ...prev, exposure: exp }
        try { localStorage.setItem('stakex_user', JSON.stringify(next)) } catch (_) {}
        return next
      })
    } catch (_) {}
  }

  // Sync wallet/balance/bonus from richer userDetail (userApp domain) so topbar stays fresh after wallet actions
  const syncWalletFromDetail = async () => {
    try {
      const detailResp = await getUserDetail()
      const d = detailResp?.data
      if (!d) return
      let nextUser: User | null = null
      setUser(prev => {
        if (!prev) return prev
        const next: User = {
          ...prev,
          balance: Number(d.balance ?? prev.balance ?? 0),
          bonusBalance: Number(d.bonus ?? prev.bonusBalance ?? 0),
          walletType: (d.wallet as any) === '2' ? '2' : '1',
          affiliateCode: d.affiliateCode ?? prev.affiliateCode,
          referralBalance: (d as any).referralBalance != null ? Number((d as any).referralBalance) : d.refBonus != null ? Number(d.refBonus) : prev.referralBalance,
          referralBonusBalance: (d as any).referralBonusBalance != null ? Number((d as any).referralBonusBalance) : prev.referralBonusBalance,
          // Preserve playerType - don't overwrite it
          playerType: prev.playerType || (d as any).playerType || 'REGULAR',
          // Preserve credit fields - don't overwrite them (they come from UserProfile via getMe(), not userDetail)
          // getUserDetail doesn't return credit fields, so always preserve from prev
          // If prev has credit fields, use them; otherwise keep undefined (they'll be set by refreshUser/getMe)
          creditAvailable: prev.creditAvailable,
          creditLimit: prev.creditLimit,
          creditUsed: prev.creditUsed,
        }
        nextUser = next
        try { localStorage.setItem('stakex_user', JSON.stringify(next)) } catch (_) {}
        return next
      })
      if (nextUser) {
        setUserAtom(nextUser)
      }
    } catch (_) {
      // Non-blocking; fall back to base profile
    }
  }

  const refreshUser = async () => {
    try {
      const detail = await userBackend.getMe()
      const u = normalizeUser(detail)
      if (!u) return
        setUser(u)
      setExposureState(Number(u.exposure || 0))
        try { localStorage.setItem('stakex_user', JSON.stringify(u)) } catch (_) {}
        setUserAtom(u)
        // Also sync exposure from getUserData
        updateExposureFromUserData()
        // Sync wallet/bonus from userDetail (includes bonus/ref bonus)
        syncWalletFromDetail()
    } catch (_err) {
      // Error refreshing user
    }
  }

  const login = async (identifier: string, password: string) => {
    const res = await userBackend.loginWithPassword(identifier, password)
    if (res?.token) {
      localStorage.setItem('token', res.token)
      setTokenAtom(res.token)
      }
    const u = normalizeUser(res?.user)

    if (u) {
          setUser(u)
      setExposureState(Number(u.exposure || 0))
          localStorage.setItem('stakex_user', JSON.stringify(u))
          seedTopbarWalletFromServerIfUnset(u.walletType)
          setUserAtom(u)
          updateExposureFromUserData()
        }
      setIsAuthModalOpen(false)
      setModalOpen(false)
      // When requirePasswordReset, skip refreshUser so we never overwrite before force modal shows.
      // User must change password first; then we updateUser + refreshUser in the modal.
      if (u?.requirePasswordReset) {
        return
      }
      // Refresh user data immediately after login to ensure playerType and latest data is loaded
      try {
        await refreshUser()
      } catch {
        // Refresh failed; user state may be stale until next navigation
      }
  }

  const register = async (username: string, identifier: string, password: string, confirmPassword?: string) => {
    let affiliateCode: string | undefined
    try {
      // First, try to get from URL params (most reliable)
      const params = new URLSearchParams(window.location.search)
      affiliateCode = params.get('affiliateCode') || params.get('ref') || undefined
      
      // If not in URL, check localStorage (set by /r redirect page)
      if (!affiliateCode) {
        try {
          const stored = localStorage.getItem('referral_code')
          if (stored) {
            const referralData = JSON.parse(stored)
            // Check if referral code hasn't expired (30 days)
            if (referralData.expiresAt && Date.now() < referralData.expiresAt) {
              affiliateCode = referralData.code
            } else {
              // Expired, remove it
              localStorage.removeItem('referral_code')
            }
          }
        } catch (_) {
          // Ignore localStorage errors
        }
      }
    } catch (_) {}
    const payload = {
      username,
      phone: identifier,
      password,
      confirmPassword: confirmPassword ?? password,
      affiliateCode,
    }
    const res = await userBackend.registerUser(payload)
    if (res?.success) {
      // This step only sends the OTP; the account is not created yet. The referral code stays in the
      // URL and localStorage until registerWithOtp succeeds (it clears them there), so editing the
      // details, closing the modal or reloading before the OTP is entered still signs the player up
      // under the agent or referrer whose link they came from.
      setPendingRegistrations((prev) => ({
        ...prev,
        [identifier]: {
          username,
          password,
          confirmPassword: confirmPassword ?? password,
          affiliateCode,
        },
      }))
      setOtpStore(prev => ({ ...prev, [identifier]: 'PENDING' }))
    } else {
      throw new Error(res?.message || 'Registration failed')
    }
  }

  const requestOtp = async (identifier: string) => {
    const isPhone = /^\+?[0-9]{6,15}$/.test(identifier)
    if (!isPhone) throw new Error('OTP is supported for phone numbers only')
    const res = await userBackend.requestOtp(identifier)
    if (res?.success) {
      setOtpStore(prev => ({ ...prev, [identifier]: 'SENT' }))
      return
    }
    throw new Error(res?.message || 'Failed to send OTP')
  }

  const loginWithOtp = async (identifier: string, otp: string) => {
    const res = await userBackend.loginWithOtp(identifier, otp)
    if (res?.token) { localStorage.setItem('token', res.token); setTokenAtom(res.token) }
    const u = normalizeUser(res?.user)
    if (u) {
          setUser(u)
      setExposureState(Number(u.exposure || 0))
          localStorage.setItem('stakex_user', JSON.stringify(u))
          seedTopbarWalletFromServerIfUnset(u.walletType)
          setUserAtom(u)
          // Update exposure from getUserData in background
          updateExposureFromUserData()
        }
      setIsAuthModalOpen(false)
      setModalOpen(false)
      setOtpStore(prev => {
        const { [identifier]: _ignored, ...rest } = prev
        return rest
      })
      if (u?.requirePasswordReset) return
      try {
        await refreshUser()
      } catch (err) {
        console.error('[loginWithOtp] Failed to refresh user after login:', err)
      }
  }

  const registerWithOtp = async (_username: string, identifier: string, otp: string) => {
    const pending = pendingRegistrations[identifier]
    if (!pending) {
      throw new Error('Registration session expired. Please start again.')
    }
    
    // Get referral code from pending registration or URL/localStorage
    let affiliateCode = pending.affiliateCode
    if (!affiliateCode) {
      try {
        const params = new URLSearchParams(window.location.search)
        affiliateCode = params.get('affiliateCode') || params.get('ref') || undefined
        
        if (!affiliateCode) {
          try {
            const stored = localStorage.getItem('referral_code')
            if (stored) {
              const referralData = JSON.parse(stored)
              if (referralData.expiresAt && Date.now() < referralData.expiresAt) {
                affiliateCode = referralData.code
              } else {
                localStorage.removeItem('referral_code')
              }
            }
          } catch (_) {
            // Ignore localStorage errors
          }
        }
      } catch (_) {}
    }
    
    const res = await userBackend.registerUser({
      username: pending.username,
      phone: identifier,
      password: pending.password,
      confirmPassword: pending.confirmPassword,
      affiliateCode: affiliateCode || pending.affiliateCode,
      otp,
    })
    
    // Clear referral code and remove from URL after successful OTP registration
    if ((affiliateCode || pending.affiliateCode) && res?.success) {
      try {
        localStorage.removeItem('referral_code')
        // Remove ref/affiliateCode from URL
        const url = new URL(window.location.href)
        url.searchParams.delete('ref')
        url.searchParams.delete('affiliateCode')
        window.history.replaceState({}, '', url.pathname + url.search)
      } catch (_) {
        // Ignore errors
      }
    }
    
    if (!res?.success) {
      throw new Error(res?.message || 'OTP verification failed')
    }
    setPendingRegistrations((prev) => {
      const next = { ...prev }
      delete next[identifier]
      return next
    })
    setOtpStore((prev) => {
      const next = { ...prev }
      delete next[identifier]
      return next
    })
    await login(identifier, pending.password)
  }

  const logout = useCallback(async () => {
    try {
      notify.success('Signed out')
    } catch (_) {
      // ignore
    }
      setUser(null)
      try {
        localStorage.removeItem('stakex_user')
        localStorage.removeItem('token')
      } catch (_) {}
      setUserAtom(null)
      setTokenAtom(null)
  }, [setUserAtom, setTokenAtom])

  // Periodic token expiration check (every 1 minute)
  useEffect(() => {
    if (!user) return

    const checkTokenExpiration = async () => {
      const token = tokenService.getToken()
      if (!token) {
        // No token, logout
        await logout()
        return
      }

      if (tokenService.isTokenExpired(token)) {
        // Token expired, show message and logout
        notify.warning('Your session has expired. Please log in again.')
        await logout()
      }
    }

    // Check immediately
    checkTokenExpiration()

    // Check every 1 minute
    const interval = setInterval(checkTokenExpiration, 60 * 1000)

    return () => {
      clearInterval(interval)
    }
  }, [user, logout])

  const openAuthModal = (mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode)
    setIsAuthModalOpen(true)
  }

  const closeAuthModal = () => {
    setIsAuthModalOpen(false)
  }

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!user) throw new Error('Not authenticated')
    const trimmedNew = newPassword.trim()
    if (trimmedNew.length < 8) {
      throw new Error('Password must be at least 8 characters')
    }
    const hasLetter = /[A-Za-z]/.test(trimmedNew)
    const hasDigit = /\d/.test(trimmedNew)
    if (!hasLetter || !hasDigit) {
      throw new Error('Password must contain alphanumeric characters')
    }
    await requestWithToast(
      () => userBackend.changePassword(currentPassword, trimmedNew).then((r) => {
        if (!r?.success) {
          const msg = r?.message || 'Failed to update password'
          return Promise.reject(new Error(msg))
        }
        return r
      }),
      { loading: 'Updating password...', success: 'Password updated', error: 'Failed to update password' }
    )
  }

  const requestResetOtp = async (identifier: string) => {
    const isPhone = /^\+?[0-9]{6,15}$/.test(identifier)
    if (!isPhone) throw new Error('OTP is supported for phone numbers only')
    const res = await userBackend.requestResetOtp(identifier)
    if (!res?.success) {
      throw new Error(res?.message || 'Failed to send OTP')
    }
  }

  const resetPassword = async (identifier: string, otp: string, newPassword: string) => {
    const trimmedNew = newPassword.trim()
    if (trimmedNew.length < 8) {
      throw new Error('Password must be at least 8 characters')
    }
    const hasLetter = /[A-Za-z]/.test(trimmedNew)
    const hasDigit = /\d/.test(trimmedNew)
    if (!hasLetter || !hasDigit) {
      throw new Error('Password must contain alphanumeric characters')
    }
    const res = await userBackend.resetPassword(identifier, otp, trimmedNew)
    if (!res?.success) {
      throw new Error(res?.message || 'Failed to reset password')
    }
  }

  const adjustBalance = (delta: number) => {
    setUser(prev => {
      if (!prev) return prev
      
      // Check if user is a credit player
      const playerType = (prev as any)?.playerType || 'REGULAR'
      const isCreditPlayer = playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'
      
      // For credit players, adjust creditAvailable instead of balance
      // Note: This is optimistic update; server will reconcile with actual credit calculation
      if (isCreditPlayer) {
        const next = { 
          ...prev, 
          creditAvailable: Math.max(0, Number(prev.creditAvailable ?? 0) + Number(delta || 0))
        }
        try { localStorage.setItem('stakex_user', JSON.stringify(next)) } catch (_) {}
        return next
      }
      
      // For regular players, adjust balance as before
      const next = { ...prev, balance: Math.max(0, Number(prev.balance || 0) + Number(delta || 0)) }
      try { localStorage.setItem('stakex_user', JSON.stringify(next)) } catch (_) {}
      return next
    })
  }

  const updateUser = useCallback((partial: Partial<User>) => {
    setUser(prev => {
      if (!prev) return prev
      const next = { ...prev, ...partial }
      try { localStorage.setItem('stakex_user', JSON.stringify(next)) } catch (_) {}
      setUserAtom(next)
      return next
    })
  }, [setUserAtom])

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isHydrating,
    isAuthModalOpen,
    authModalMode,
    login,
    register,
    requestOtp,
    loginWithOtp,
    registerWithOtp,
    changePassword,
    requestResetOtp,
    resetPassword,
    logout,
    openAuthModal,
    closeAuthModal,
    refreshUser,
    syncWallet: syncWalletFromDetail,
    updateUser,
    adjustBalance,
    setExposure: (val: number) => {
      setExposureState(Number(val) || 0)
      setUser(prev => {
        if (!prev) return prev
        const next = { ...prev, exposure: Number(val) || 0 }
        try { localStorage.setItem('stakex_user', JSON.stringify(next)) } catch (_) {}
        return next
      })
    },
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

/* eslint-enable react-refresh/only-export-components */
