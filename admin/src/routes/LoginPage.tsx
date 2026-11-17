import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import { clearSignOutReason, readSignOutNotice, type SignOutNotice } from '@/shared/core/signOutReason'
import { getAdminDefaultHomePath } from '@/shared/core/adminDefaultHome'
import { ROUTES } from '@/shared/core/constants'
import { useUIStore } from '@/shared/core/uiStore'
import { useMutation } from '@apollo/client'
import { gql } from '@apollo/client'
import { AGENT_LOGIN_MUTATION } from '@/lib/graphql/agents'
import { IconLogin2, IconShieldCheck } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { TextField } from '@/ui/components/TextField'
import { PasswordField } from '@/ui/components/PasswordField'
import { toast } from '@/ui/components/toast'
import { ThemeToggle } from '@/shell/topbar/ThemeToggle'
import { ChangePasswordModal } from '@/shared/ui/ChangePasswordModal'
import styles from './LoginPage.module.css'

const LOGIN_MUTATION = gql`
mutation Login($input: LoginInput!) {
  login(input: $input) {
    token
    user { id name }
    roles
    permissions { domain actions }
    tenant
    requirePasswordReset
  }
}
`

const PASSWORD_CHANGED_NOTICE = 'Password changed. Sign in with your new password.'
const PASSWORD_CHANGE_REQUIRED_NOTICE = 'You must choose a new password before you can continue. Sign in again to set it.'

/** Store the tenant from the login response (authoritative, from the backend) under both keys, so the auth link
 *  and any consumer resolve it after a refresh. Bypasses uiStore's security check, as the initial login does. */
function rememberTenant(raw: unknown) {
  if (typeof raw !== 'string' || raw.trim() === '') return
  try {
    const tenant = raw.trim()
    useUIStore.getState().setTenant(tenant, true) // bypassSecurityCheck = true for initial login
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('X_WHITELABEL_ID', tenant)
      window.localStorage.setItem('TENANT', tenant)
    }
  } catch {
    // Tenant storage failed; continue with navigation
  }
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // Avoid subscribing the login page to the store to prevent hydration loops
  const loginStore = useAuthStore.getState().login
  const agentLoginStore = useAuthStore.getState().agentLogin
  
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  /** Why the panel signed this tab out, when it did (a forced session end reloads this page, dropping its toast). */
  const [signedOut, setSignedOut] = useState<SignOutNotice | null>(() => readSignOutNotice())
  /** The token of a sign-in whose password must change first (Reset Password), used for that change only. */
  const [resetToken, setResetToken] = useState<string | null>(null)
  const passwordChanged = useRef(false)

  // Shown once: read during the first render, forgotten after it, so a later visit to this page does not repeat it.
  useEffect(() => { clearSignOutReason() }, [])

  const [loginMutation, { loading: adminLoading }] = useMutation(LOGIN_MUTATION, {
    onCompleted: (data) => {
      const loginData = data?.login
      if (!loginData) {
        setError('Invalid response from server')
        return
      }

      if (loginData.requirePasswordReset === true) {
        /* An operator chose Reset Password. Until a new password is chosen the server lets this session do nothing
           else, so the shell is not entered (every page showed "Password change required") and the session is not
           kept: a reload or Cancel brings back this form. A session still kept in this browser is ended, so its
           token is not the one the change goes out with; the change ends this admin's sessions anyway. */
        if (typeof loginData.token !== 'string' || !loginData.token) {
          setError('Invalid response from server')
          return
        }
        if (useAuthStore.getState().token) useAuthStore.getState().logout()
        rememberTenant(loginData.tenant)
        passwordChanged.current = false
        setPassword('')
        setResetToken(loginData.token)
        return
      }

      // Set auth state FIRST so roles are available
      loginStore({ user: loginData.user, roles: loginData.roles, permissions: loginData.permissions, token: loginData.token })

      // Store tenant from login response (important for Whitelabel Admins)
      // Bypass security check during login since tenant comes from backend (authoritative source)
      rememberTenant(loginData.tenant)
      const fromRaw = (location.state as { from?: { pathname?: string } })?.from?.pathname
      const perms = loginData.permissions ?? []
      let target = fromRaw && fromRaw !== '/login' ? fromRaw : '/'
      if (target === '/' || target === ROUTES.OVERVIEW) {
        target = getAdminDefaultHomePath(perms)
      }
      navigate(target, { replace: true })
    },
    onError: (err) => {
      setError(err.message || 'Login failed')
    },
  })

  const [agentLoginMutation, { loading: agentLoading }] = useMutation(AGENT_LOGIN_MUTATION, {
    onCompleted: (data) => {
      const loginData = data?.agents?.agentLogin
      if (!loginData) {
        setError('Invalid response from server')
        return
      }
      
      // Store tenant for agent (from response or agent.tenantId)
      // Validate and normalize tenant before storing
      const tenantRaw = loginData.tenant || loginData.agent?.tenantId
      if (tenantRaw && typeof tenantRaw === 'string' && tenantRaw.trim() !== '') {
        try {
          const tenant = tenantRaw.trim()
          if (typeof window !== 'undefined') {
            // Store tenant (used for X-Tenant header)
            window.localStorage.setItem('TENANT', tenant)
            // Also store as X_WHITELABEL_ID (used for X-Whitelabel-ID header)
            window.localStorage.setItem('X_WHITELABEL_ID', tenant)
          }
        } catch {
          // Tenant storage failed
        }
      }
      
      // Store auth state AFTER tenant is stored (include isReadOnly for INACTIVE agents)
      agentLoginStore({
        agent: loginData.agent,
        permissions: loginData.permissions,
        token: loginData.token,
        isReadOnly: loginData.isReadOnly ?? loginData.agent?.status === 'INACTIVE',
      })

      // CRITICAL: Ensure _hasHydrated is set to true after login
      useAuthStore.getState().setHasHydrated(true)

      // Only SUSPENDED (and BLOCKED) cannot login; INACTIVE can login in read-only mode
      const status = loginData.agent?.status
      if (status === 'SUSPENDED' || status === 'BLOCKED') {
        const msg = status === 'SUSPENDED' ? 'Agent account is suspended.' : 'Agent account is blocked.'
        setError(msg)
        toast({
          title: status === 'SUSPENDED' ? 'Account Suspended' : 'Account Blocked',
          message: msg,
          tone: 'error',
          duration: 5000,
        })
        return
      }
      
      // Get target path - always use /agent for agents, ignore 'from' to prevent redirect to root
      // The root path (/) is for admin users, agents should go to /agent
      const targetPath = '/agent'
      
      
      // Use a small delay to ensure React has processed the state update
      // Then navigate using React Router
      setTimeout(() => {
        const finalState = useAuthStore.getState()
        if (finalState.token && finalState.agent) {
          navigate(targetPath, { replace: true })
        } else {
          setError('Failed to save session. Please try again.')
        }
      }, 100)
    },
    onError: (err) => {
      const msg = err.message || 'Login failed'
      setError(msg)
      const isSuspended = msg.toLowerCase().includes('suspend')
      const isBlocked = msg.toLowerCase().includes('block') || msg.toLowerCase().includes('inactive')
      toast({
        title: isSuspended ? 'Account Suspended' : isBlocked ? 'Account Blocked' : 'Login Failed',
        message: msg,
        tone: 'error',
        duration: 5000,
      })
    },
  })

  const loading = adminLoading || agentLoading

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(undefined)
    setNotice(undefined)
    setSignedOut(null)

    // Frontend validation
    const trimmedIdentifier = identifier.trim()
    const trimmedPassword = password.trim()
    
    if (!trimmedIdentifier) {
      setError('Username or email is required')
      return
    }
    
    if (!trimmedPassword) {
      setError('Password is required')
      return
    }
    
    try {
      // Detect if input is email (contains @) or username (no @)
      const isEmail = trimmedIdentifier.includes('@')
      
      if (isEmail) {
        // Admin login
        await loginMutation({ variables: { input: { email: trimmedIdentifier, password: trimmedPassword } } })
      } else {
        // Agent login
        await agentLoginMutation({ variables: { input: { username: trimmedIdentifier, password: trimmedPassword } } })
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.portal}>
        <div className={styles.toolbar}>
          <span className={styles.eyebrow}>Operations portal</span>
          <ThemeToggle />
        </div>
        <section className={styles.card} aria-labelledby="login-title">
          <div className={styles.brand}>
            <span className={styles.brandIcon} aria-hidden="true"><IconShieldCheck size={28} stroke={1.6} /></span>
            <h1 className={styles.title} id="login-title">Admin / Agent Portal</h1>
            <p className={styles.subtitle}>Sign in to access your dashboard</p>
          </div>
          {signedOut ? <Notice tone="warn" live="polite" title={signedOut.title}>{signedOut.text}</Notice> : null}
          {error ? <Notice tone="error" live="assertive">{error}</Notice> : null}
          {notice ? <Notice tone="ok" live="polite">{notice}</Notice> : null}
          <form onSubmit={onSubmit} className={styles.form} aria-busy={loading}>
            <TextField label="Email or Username" name="identifier" value={identifier}
              onChange={setIdentifier} required autoFocus autoComplete="username"
              placeholder="admin@company.com or agent_username" />
            <PasswordField label="Password" name="password" value={password}
              onChange={setPassword} required autoComplete="current-password"
              placeholder="Enter your password" />
            <Button type="submit" variant="primary" loading={loading} className={styles.submit}
              icon={<IconLogin2 size={18} />}>
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
          <p className={styles.security}>Secure admin access · Protected by enterprise authentication</p>
        </section>
        <p className={styles.help}>Need help? Contact your system administrator</p>
      </div>
      {/* Reset Password at sign-in: the new password first, then a fresh sign-in (the change ends this session). */}
      {resetToken ? (
        <ChangePasswordModal
          open
          sessionToken={resetToken}
          onChanged={() => { passwordChanged.current = true }}
          onClose={() => {
            setResetToken(null)
            if (passwordChanged.current) {
              setError(undefined)
              setNotice(PASSWORD_CHANGED_NOTICE)
            } else {
              setError(PASSWORD_CHANGE_REQUIRED_NOTICE)
            }
          }}
        />
      ) : null}
    </main>
  )
}

