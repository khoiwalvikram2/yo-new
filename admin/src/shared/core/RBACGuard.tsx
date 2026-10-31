import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { IconShieldLock } from '@tabler/icons-react'
import { Notice } from '@/ui/components/Notice'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { strokeFor } from '@/ui/components/icons'
import { useAuthStore } from './authStore'
import { hasPermissionWithNested } from './nestedPermissionMapping'
import { getAdminDefaultHomePath } from './adminDefaultHome'
import { deriveAgentPermissionsFromDomains } from './agentDerivedPermissions'
import styles from './RBACGuard.module.css'

type Requirement = { domain: string; actions: string[]; mode?: 'AND'|'OR' }

export function RBACGuard({
  required,
  children,
  fallback,
  bypassForAgents,
  requireAny,
}: {
  required: Requirement[]
  children: ReactNode
  fallback?: ReactNode
  bypassForAgents?: boolean
  /** When true, user needs at least one of the requirements (OR). Default: false (AND). */
  requireAny?: boolean
}) {
  const storedAdminPermissions = useAuthStore((s) => s.permissions)
  const isAgent = useAuthStore((s) => s.isAgent())
  const agent = useAuthStore((s) => s.agent)

  const permissions = useMemo(() => {
    if (!isAgent) return storedAdminPermissions ?? []
    return deriveAgentPermissionsFromDomains(agent?.allowedDomains)
  }, [isAgent, storedAdminPermissions, agent?.allowedDomains])

  if (bypassForAgents && isAgent) {
    return <>{children}</>
  }

  if (!required || !Array.isArray(required) || required.length === 0) {
    return fallback ?? null
  }

  const has = (req: Requirement) => {
    if (!req || !req.domain || !req.actions || !Array.isArray(req.actions)) return false
    const mode = req.mode ?? 'OR'
    if (mode === 'AND') {
      return req.actions.every(a => hasPermissionWithNested(permissions, req.domain, a))
    }
    return req.actions.some(a => hasPermissionWithNested(permissions, req.domain, a))
  }

  const ok = requireAny ? required.some(has) : required.every(has)
  if (!ok) {
    if (fallback !== undefined) return fallback
    const homePath = isAgent ? '/agent' : getAdminDefaultHomePath(storedAdminPermissions)
    /* The kit Notice replaces antd's Alert here: same wording, same tone, and it follows the theme
       instead of staying light inside a dark page. "Go to home" is the link itself wearing the
       button's classes; it used to be a <button> inside an <a>, which is invalid and loses
       middle-click. */
    return (
      <div className={styles.denied}>
        <Notice
          tone="warn"
          icon={<IconShieldLock size={18} stroke={strokeFor(18)} />}
          title="Access denied"
          action={
            <Link to={homePath} className={buttonClassName({ size: 'sm' })}>
              Go to home
            </Link>
          }
        >
          You don&apos;t have permission to view this section.
        </Notice>
      </div>
    )
  }
  return <>{children}</>
}
