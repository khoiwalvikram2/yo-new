import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
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
import styles from './LoginPage.module.css'

const LOGIN_MUTATION = gql`
mutation Login($input: LoginInput!) {
  login(input: $input) {
    token
    user { id name }
    roles
    permissions { domain actions }
    tenant
  }
}
`

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // Avoid subscribing the login page to the store to prevent hydration loops
  const loginStore = useAuthStore.getState().login
  const agentLoginStore = useAuthStore.getState().agentLogin
  
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  
  const [loginMutation, { loading: adminLoading }] = useMutation(LOGIN_MUTATION, {
    onCompleted: (data) => {
      const loginData = data?.login
      if (!loginData) {
        setError('Invalid response from server')
        return
      }
      
      // Set auth state FIRST so roles are available
      loginStore({ user: loginData.user, roles: loginData.roles, permissions: loginData.permissions, token: loginData.token })
      
      // Store tenant from login response (important for Whitelabel Admins)
      // Bypass security check during login since tenant comes from backend (authoritative source)
      if (loginData.tenant && typeof loginData.tenant === 'string' && loginData.tenant.trim() !== '') {
        try {
          const tenant = loginData.tenant.trim()
          useUIStore.getState().setTenant(tenant, true) // bypassSecurityCheck = true for initial login
          // Store in both keys so auth link and any consumer can resolve tenant after refresh
          if (typeof window !== 'undefined') {
            window.localStorage.setItem('X_WHITELABEL_ID', tenant)
            window.localStorage.setItem('TENANT', tenant)
          }
        } catch {
          // Tenant storage failed; continue with navigation
        }
      }
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
          {error ? <Notice tone="error" live="assertive">{error}</Notice> : null}
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
    </main>
  )
}

